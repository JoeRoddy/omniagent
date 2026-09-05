import type { Dirent, Stats } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { readJsonlLines } from "./jsonl.js";
import { type HistoryQuery, prefilterJsonLine } from "./query.js";
import type {
	HistoryContext,
	HistoryFile,
	HistoryResume,
	HistoryRole,
	SearchRecord,
	SearchScope,
	TranscriptEvent,
} from "./types.js";

const SUBAGENTS_DIR = "subagents";
const TRANSCRIPT_EXTENSION = ".jsonl";

const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const LEADING_TAG = /^<([a-zA-Z][\w-]*)>/;
const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
const BASH_INPUT = /<bash-input>([\s\S]*?)<\/bash-input>/;

/**
 * Wrapper tags Claude writes into user-role records that are not something the human typed.
 * Derived by scanning a real corpus, not guessed — `task-notification` alone accounts for more
 * noise than every other tag combined.
 */
const SUPPRESSED_TAGS = new Set([
	"bash-input",
	"bash-stderr",
	"bash-stdout",
	"command-args",
	"command-message",
	"command-name",
	"local-command-caveat",
	"local-command-stderr",
	"local-command-stdout",
	"user-prompt-submit-hook",
	"task-notification",
]);

export function resolveClaudeProjectsDir(
	homeDir: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	const override = env.CLAUDE_CONFIG_DIR?.trim();
	const base = override && override.length > 0 ? override : path.join(homeDir, ".claude");
	return path.join(base, "projects");
}

/**
 * Claude names each project directory after the session cwd with every non-alphanumeric
 * character replaced by a hyphen. Verified against every project directory in a real install.
 */
export function slugifyProjectPath(absolutePath: string): string {
	return absolutePath.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * Always slugify forward and compare; never try to reverse a slug, which is ambiguous
 * (`-a-b-c` could be `/a/b/c` or `/a/b-c`). The trailing-hyphen guard is what stops repo
 * `/a/b/foo` from swallowing `/a/b/foobar`, while still matching sessions started in a
 * subdirectory of the repo.
 */
export function projectSlugMatches(dirName: string, absolutePath: string): boolean {
	const slug = slugifyProjectPath(absolutePath);
	return dirName === slug || dirName.startsWith(`${slug}-`);
}

function projectDirAllowed(dirName: string, scope: SearchScope): boolean {
	if (scope.projectPath) {
		return projectSlugMatches(dirName, scope.projectPath);
	}
	if (scope.projectMatch) {
		// The filter is slugified too, so `open-source/omniagent` matches `-open-source-omniagent`.
		return dirName.toLowerCase().includes(slugifyProjectPath(scope.projectMatch).toLowerCase());
	}
	return true;
}

async function describeFile(
	filePath: string,
	sessionId: string,
	scope: SearchScope,
): Promise<HistoryFile | null> {
	let info: Stats;
	try {
		info = await stat(filePath);
	} catch {
		return null;
	}
	// One-directional prune only: a file last written before `since` cannot contain a newer
	// record, but a file written after it may still contain older ones.
	if (scope.since && info.mtimeMs < scope.since.getTime()) {
		return null;
	}
	return {
		path: filePath,
		// Claude records carry an exact cwd, so slug matching above is purely a pruning
		// optimization and the authoritative value is filled in per record.
		projectPath: null,
		sessionId,
		modifiedAt: new Date(info.mtimeMs).toISOString(),
		sizeBytes: info.size,
	};
}

export async function* listClaudeFiles(
	scope: SearchScope,
	context: HistoryContext,
): AsyncGenerator<HistoryFile> {
	const root = resolveClaudeProjectsDir(context.homeDir);
	let projects: Dirent[];
	try {
		projects = await readdir(root, { withFileTypes: true });
	} catch {
		return;
	}

	const wantAgent = context.roles.has("agent");
	const wantMain = context.roles.has("user") || context.roles.has("assistant");

	for (const project of projects) {
		if (context.signal.aborted) {
			return;
		}
		if (!project.isDirectory() || !projectDirAllowed(project.name, scope)) {
			continue;
		}
		const projectDir = path.join(root, project.name);
		let children: Dirent[];
		try {
			children = await readdir(projectDir, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const child of children) {
			if (context.signal.aborted) {
				return;
			}
			if (child.isFile() && child.name.endsWith(TRANSCRIPT_EXTENSION)) {
				if (!wantMain) {
					continue;
				}
				const file = await describeFile(
					path.join(projectDir, child.name),
					path.basename(child.name, TRANSCRIPT_EXTENSION),
					scope,
				);
				if (file) {
					yield file;
				}
				continue;
			}

			// Subagent transcripts live one level deeper, at <session-id>/subagents/agent-*.jsonl.
			// They are the majority of files on a busy install, so the walk must recurse.
			if (!child.isDirectory() || !wantAgent) {
				continue;
			}
			const subagentDir = path.join(projectDir, child.name, SUBAGENTS_DIR);
			let agents: Dirent[];
			try {
				agents = await readdir(subagentDir, { withFileTypes: true });
			} catch {
				continue;
			}
			for (const agent of agents) {
				if (!agent.isFile() || !agent.name.endsWith(TRANSCRIPT_EXTENSION)) {
					continue;
				}
				const file = await describeFile(path.join(subagentDir, agent.name), child.name, scope);
				if (file) {
					yield file;
				}
			}
		}
	}
}

function extractText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	// Only `text` blocks are message content. `tool_result` blocks are tool OUTPUT that happens
	// to be carried on a user-role record, and they outnumber real prompts roughly 20:1.
	const parts: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object") {
			const typed = block as { type?: unknown; text?: unknown };
			if (typed.type === "text" && typeof typed.text === "string") {
				parts.push(typed.text);
			}
		}
	}
	return parts.join("\n");
}

export function cleanClaudeText(raw: string): string {
	const stripped = raw.replace(SYSTEM_REMINDER, "").trim();
	if (stripped.length === 0) {
		return "";
	}
	const tag = LEADING_TAG.exec(stripped);
	if (tag?.[1] && SUPPRESSED_TAGS.has(tag[1])) {
		return "";
	}
	if (stripped.startsWith("Caveat:")) {
		return "";
	}
	return stripped;
}

export function prefilterClaudeLine(line: string, query: HistoryQuery): boolean {
	// Removing a reminder can join text that was not contiguous in the raw JSON line.
	return line.includes("<system-reminder>") || prefilterJsonLine(query, line);
}

export function normalizeClaudeLine(
	line: string,
	file: HistoryFile,
	index: number,
	context: HistoryContext,
): SearchRecord | null {
	let record: Record<string, unknown>;
	try {
		record = JSON.parse(line) as Record<string, unknown>;
	} catch {
		return null;
	}
	if (!record || typeof record !== "object") {
		return null;
	}

	const type = record.type;
	if (type !== "user" && type !== "assistant") {
		return null;
	}
	// isMeta records are skill payloads and image placeholders injected into the turn, never
	// something the human typed.
	if (record.isMeta === true) {
		return null;
	}

	// Subagent transcripts are flagged isSidechain. Their user-role records are dispatch prompts
	// written by the orchestrator, so classifying them as "agent" is what keeps --role user
	// limited to things the human actually wrote.
	const role: HistoryRole =
		record.isSidechain === true ? "agent" : type === "user" ? "user" : "assistant";
	if (!context.roles.has(role)) {
		return null;
	}

	const message = record.message as { content?: unknown } | undefined;
	const text = cleanClaudeText(extractText(message?.content));
	if (text.length === 0) {
		return null;
	}

	return {
		agentId: context.targetId,
		role,
		timestamp: typeof record.timestamp === "string" ? record.timestamp : null,
		text,
		sessionId: typeof record.sessionId === "string" ? record.sessionId : (file.sessionId ?? ""),
		cwd: typeof record.cwd === "string" ? record.cwd : file.projectPath,
		gitBranch: typeof record.gitBranch === "string" ? record.gitBranch : null,
		sourcePath: file.path,
		recordIndex: index,
	};
}

export function resumeClaudeSession(record: SearchRecord): HistoryResume | null {
	if (!record.sessionId) {
		return null;
	}
	// Claude keys its transcripts by project directory, so a resume launched from elsewhere
	// will not find the session. Reporting the cwd lets the renderer emit a `cd` prefix.
	return { command: "claude", args: ["--resume", record.sessionId], cwd: record.cwd };
}

/**
 * User-role text for a chat log. Search suppresses slash commands and `!` shell lines because
 * nobody wants to copy "/clear" back into a prompt, but in an export they are turns the human
 * took, so they are rendered the way they were typed. Everything else defers to the search cleaner.
 */
export function extractClaudeUserText(raw: string): string {
	const stripped = raw.replace(SYSTEM_REMINDER, "").trim();
	const command = COMMAND_NAME.exec(stripped);
	if (command) {
		const name = (command[1] ?? "").trim();
		const args = (COMMAND_ARGS.exec(stripped)?.[1] ?? "").trim();
		return args.length > 0 ? `${name} ${args}` : name;
	}
	const bash = BASH_INPUT.exec(stripped);
	if (bash) {
		return `! ${(bash[1] ?? "").trim()}`;
	}
	return cleanClaudeText(stripped);
}

function extractToolResultText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (content === undefined || content === null) {
		return "";
	}
	if (!Array.isArray(content)) {
		return JSON.stringify(content);
	}
	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") {
			continue;
		}
		const typed = block as { type?: unknown; text?: unknown; tool_name?: unknown };
		if (typed.type === "text" && typeof typed.text === "string") {
			parts.push(typed.text);
		} else if (typed.type === "tool_reference" && typeof typed.tool_name === "string") {
			parts.push(`[tool: ${typed.tool_name}]`);
		} else if (typeof typed.type === "string") {
			// Images and other binary blocks cannot be rendered as text; name them so the reader
			// knows something was there.
			parts.push(`[${typed.type}]`);
		}
	}
	return parts.join("\n");
}

type ClaudeBlock = {
	type?: unknown;
	text?: unknown;
	thinking?: unknown;
	id?: unknown;
	name?: unknown;
	input?: unknown;
	tool_use_id?: unknown;
	content?: unknown;
	is_error?: unknown;
};

type PendingAssistantText = { id: string | null; text: string; timestamp: string | null };

function flushPending(pending: PendingAssistantText | null): TranscriptEvent | null {
	if (!pending) {
		return null;
	}
	const text = pending.text.trim();
	if (text.length === 0) {
		return null;
	}
	return { kind: "message", role: "assistant", text, timestamp: pending.timestamp };
}

/**
 * Full-fidelity reader for `omniagent export`. Claude writes one JSONL record per content block,
 * so the text blocks of a single API response arrive as consecutive records sharing `message.id`;
 * they are merged back into one assistant message here. Every other block type is passed through
 * as its own event so tool calls stay where they happened in the conversation.
 */
export async function* readClaudeTranscript(
	file: HistoryFile,
	context: HistoryContext,
): AsyncGenerator<TranscriptEvent> {
	// Session facts are emitted as soon as a record supplies them, one meta event per discovery,
	// because the first record does not always carry every field.
	const known = { cwd: false, gitBranch: false, model: false };
	let pending: PendingAssistantText | null = null;

	for await (const line of readJsonlLines(file.path, { signal: context.signal })) {
		let record: Record<string, unknown>;
		try {
			record = JSON.parse(line.text) as Record<string, unknown>;
		} catch {
			continue;
		}
		if (!record || typeof record !== "object") {
			continue;
		}
		const type = record.type;
		if (type !== "user" && type !== "assistant") {
			continue;
		}
		// Skill payloads and image placeholders injected into the turn, never something the human
		// typed — the same rule search applies.
		if (record.isMeta === true) {
			continue;
		}
		const message = record.message as
			| { id?: unknown; model?: unknown; content?: unknown }
			| undefined;
		const timestamp = typeof record.timestamp === "string" ? record.timestamp : null;

		const meta: Extract<TranscriptEvent, { kind: "meta" }> = { kind: "meta" };
		let learned = false;
		const cwd = typeof record.cwd === "string" ? record.cwd : file.projectPath;
		if (!known.cwd && cwd) {
			known.cwd = true;
			learned = true;
			meta.cwd = cwd;
		}
		if (!known.gitBranch && typeof record.gitBranch === "string") {
			known.gitBranch = true;
			learned = true;
			meta.gitBranch = record.gitBranch;
		}
		if (!known.model && typeof message?.model === "string") {
			known.model = true;
			learned = true;
			meta.model = message.model;
		}
		if (learned) {
			yield meta;
		}

		const content = message?.content;

		if (type === "user") {
			const flushed = flushPending(pending);
			pending = null;
			if (flushed) {
				yield flushed;
			}
			if (typeof content === "string") {
				const text = extractClaudeUserText(content);
				if (text.length > 0) {
					yield { kind: "message", role: "user", text, timestamp };
				}
				continue;
			}
			if (!Array.isArray(content)) {
				continue;
			}
			const texts: string[] = [];
			for (const block of content as ClaudeBlock[]) {
				if (!block || typeof block !== "object") {
					continue;
				}
				if (block.type === "text" && typeof block.text === "string") {
					texts.push(block.text);
				} else if (block.type === "tool_result") {
					yield {
						kind: "tool_result",
						callId: typeof block.tool_use_id === "string" ? block.tool_use_id : null,
						output: extractToolResultText(block.content),
						isError: block.is_error === true,
						timestamp,
					};
				}
			}
			if (texts.length > 0) {
				const text = extractClaudeUserText(texts.join("\n"));
				if (text.length > 0) {
					yield { kind: "message", role: "user", text, timestamp };
				}
			}
			continue;
		}

		const messageId = typeof message?.id === "string" ? message.id : null;
		if (typeof content === "string") {
			const flushed = flushPending(pending);
			pending = null;
			if (flushed) {
				yield flushed;
			}
			const text = content.trim();
			if (text.length > 0) {
				yield { kind: "message", role: "assistant", text, timestamp };
			}
			continue;
		}
		if (!Array.isArray(content)) {
			continue;
		}
		for (const block of content as ClaudeBlock[]) {
			if (!block || typeof block !== "object") {
				continue;
			}
			if (block.type === "text" && typeof block.text === "string") {
				if (pending && pending.id !== null && pending.id === messageId) {
					pending.text = `${pending.text}\n\n${block.text}`;
				} else {
					const flushed = flushPending(pending);
					if (flushed) {
						yield flushed;
					}
					pending = { id: messageId, text: block.text, timestamp };
				}
				continue;
			}
			// Any non-text block ends the current run of assistant text, so a tool call that
			// follows a sentence is emitted after that sentence rather than before it.
			const flushed = flushPending(pending);
			pending = null;
			if (flushed) {
				yield flushed;
			}
			if (block.type === "tool_use") {
				yield {
					kind: "tool_call",
					callId: typeof block.id === "string" ? block.id : null,
					name: typeof block.name === "string" ? block.name : "unknown",
					input: block.input,
					timestamp,
				};
			} else if (block.type === "thinking" && typeof block.thinking === "string") {
				// Most thinking blocks on disk are empty shells carrying only a signature.
				const text = block.thinking.trim();
				if (text.length > 0) {
					yield { kind: "thinking", text, timestamp };
				}
			}
		}
	}

	const flushed = flushPending(pending);
	if (flushed) {
		yield flushed;
	}
}
