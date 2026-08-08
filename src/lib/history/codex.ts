import type { Dirent, Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
	HistoryContext,
	HistoryFile,
	HistoryResume,
	HistoryRole,
	SearchRecord,
	SearchScope,
} from "./types.js";

const TRANSCRIPT_EXTENSION = ".jsonl";
const DAY_MS = 86_400_000;
/** Enough to hold the session_meta line, which is always first and carries the cwd. */
const META_PROBE_BYTES = 64 * 1024;
const NEWLINE = 0x0a;

export function resolveCodexSessionsDir(
	homeDir: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	const override = env.CODEX_HOME?.trim();
	const base = override && override.length > 0 ? override : path.join(homeDir, ".codex");
	return path.join(base, "sessions");
}

export type CodexSessionMeta = {
	cwd: string | null;
	sessionId: string | null;
	timestamp: string | null;
};

/**
 * Reads only the first line of a rollout file. Codex writes `session_meta` there in every file,
 * so this recovers the session cwd for ~1/5000th of the cost of scanning the file — which is what
 * makes a path-scoped search fast despite Codex encoding no cwd in its paths.
 */
export async function readCodexSessionMeta(filePath: string): Promise<CodexSessionMeta | null> {
	let handle: FileHandle;
	try {
		handle = await open(filePath, "r");
	} catch {
		return null;
	}
	try {
		const buffer = Buffer.alloc(META_PROBE_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, META_PROBE_BYTES, 0);
		if (bytesRead === 0) {
			return null;
		}
		const newline = buffer.indexOf(NEWLINE);
		const end = newline === -1 || newline > bytesRead ? bytesRead : newline;
		const record = JSON.parse(buffer.toString("utf8", 0, end)) as Record<string, unknown>;
		if (record?.type !== "session_meta") {
			return null;
		}
		const payload = (record.payload ?? {}) as Record<string, unknown>;
		const id = payload.id ?? payload.session_id;
		return {
			cwd: typeof payload.cwd === "string" ? payload.cwd : null,
			// The rollout id (also in the filename) is the resumable one. `session_id` diverges on
			// forked sessions and does not resolve.
			sessionId: typeof id === "string" ? id : null,
			timestamp:
				typeof payload.timestamp === "string"
					? payload.timestamp
					: typeof record.timestamp === "string"
						? record.timestamp
						: null,
		};
	} catch {
		return null;
	} finally {
		await handle.close();
	}
}

/**
 * Date shards are local-time-ish while record timestamps are absolute, so pad a day on each side
 * and let the authoritative per-record filter make the exact cut.
 */
function shardAllowed(year: number, month: number, day: number, scope: SearchScope): boolean {
	if (!scope.since && !scope.until) {
		return true;
	}
	const start = Date.UTC(year, month - 1, day) - DAY_MS;
	const end = Date.UTC(year, month - 1, day) + 2 * DAY_MS;
	if (scope.since && end < scope.since.getTime()) {
		return false;
	}
	if (scope.until && start > scope.until.getTime()) {
		return false;
	}
	return true;
}

function projectAllowed(cwd: string | null, scope: SearchScope): boolean {
	if (!scope.projectPath && !scope.projectMatch) {
		return true;
	}
	// Fail open: a file with an unreadable or absent header still gets scanned, and its records
	// are filtered individually. Never silently drop data because a header was torn.
	if (cwd === null) {
		return true;
	}
	if (scope.projectPath) {
		const root = scope.projectPath;
		return cwd === root || cwd.startsWith(`${root}${path.sep}`);
	}
	return cwd.toLowerCase().includes((scope.projectMatch as string).toLowerCase());
}

async function numericDirs(parent: string): Promise<string[]> {
	try {
		const entries = await readdir(parent, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
			.map((entry) => entry.name)
			.sort();
	} catch {
		return [];
	}
}

export async function* listCodexFiles(
	scope: SearchScope,
	context: HistoryContext,
): AsyncGenerator<HistoryFile> {
	const root = resolveCodexSessionsDir(context.homeDir);
	// Codex records nothing that maps to a subagent transcript.
	if (!context.roles.has("user") && !context.roles.has("assistant")) {
		return;
	}

	for (const year of await numericDirs(root)) {
		for (const month of await numericDirs(path.join(root, year))) {
			for (const day of await numericDirs(path.join(root, year, month))) {
				if (context.signal.aborted) {
					return;
				}
				if (!shardAllowed(Number(year), Number(month), Number(day), scope)) {
					continue;
				}
				const dayDir = path.join(root, year, month, day);
				let entries: Dirent[];
				try {
					entries = await readdir(dayDir, { withFileTypes: true });
				} catch {
					continue;
				}
				for (const entry of entries) {
					if (context.signal.aborted) {
						return;
					}
					if (!entry.isFile() || !entry.name.endsWith(TRANSCRIPT_EXTENSION)) {
						continue;
					}
					const filePath = path.join(dayDir, entry.name);
					const meta = await readCodexSessionMeta(filePath);
					if (!projectAllowed(meta?.cwd ?? null, scope)) {
						continue;
					}
					let info: Stats;
					try {
						info = await stat(filePath);
					} catch {
						continue;
					}
					if (scope.since && info.mtimeMs < scope.since.getTime()) {
						continue;
					}
					yield {
						path: filePath,
						projectPath: meta?.cwd ?? null,
						sessionId: meta?.sessionId ?? path.basename(entry.name, TRANSCRIPT_EXTENSION),
						modifiedAt: new Date(info.mtimeMs).toISOString(),
						sizeBytes: info.size,
					};
				}
			}
		}
	}
}

/**
 * Pulls text out of a thread item's content blocks. Block `type` casing differs between item
 * kinds (`text` on user messages, `Text` on agent messages), so the presence of a string `text`
 * field is what counts rather than the label.
 */
function extractItemText(item: Record<string, unknown>): string {
	const content = item.content;
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	const parts: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object") {
			const text = (block as { text?: unknown }).text;
			if (typeof text === "string") {
				parts.push(text);
			}
		}
	}
	return parts.join("");
}

export function normalizeCodexLine(
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
	// Excludes the `response_item` copies of every turn. In older transcripts those carry the
	// user's text wrapped in injected <environment_context> blocks; in newer ones they simply
	// duplicate the item event below. Either way, accepting them doubles and pollutes results.
	if (record?.type !== "event_msg") {
		return null;
	}
	const payload = record.payload as Record<string, unknown> | undefined;
	if (!payload || typeof payload !== "object") {
		return null;
	}

	let role: HistoryRole | null = null;
	let text = "";

	if (payload.type === "user_message" || payload.type === "agent_message") {
		// Legacy shape, written by Codex through 2026-08-06.
		role = payload.type === "user_message" ? "user" : "assistant";
		text = typeof payload.message === "string" ? payload.message.trim() : "";
	} else if (payload.type === "item_completed") {
		// Current shape: messages arrive as completed thread items instead of bespoke events.
		const item = payload.item as Record<string, unknown> | undefined;
		const itemType = item?.type;
		if (itemType === "UserMessage") {
			role = "user";
		} else if (itemType === "AgentMessage") {
			role = "assistant";
		}
		if (role && item) {
			text = extractItemText(item).trim();
		}
	}

	if (role === null || !context.roles.has(role)) {
		return null;
	}
	if (text.length === 0) {
		return null;
	}

	return {
		agentId: context.targetId,
		role,
		timestamp: typeof record.timestamp === "string" ? record.timestamp : null,
		text,
		sessionId: file.sessionId ?? "",
		cwd: file.projectPath,
		gitBranch: null,
		sourcePath: file.path,
		recordIndex: index,
	};
}

export function resumeCodexSession(record: SearchRecord): HistoryResume | null {
	if (!record.sessionId) {
		return null;
	}
	// `codex resume` scopes to the current directory, so a hit from another project needs a cd.
	return { command: "codex", args: ["resume", record.sessionId], cwd: record.cwd };
}
