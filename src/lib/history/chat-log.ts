import type { ExportedSession } from "./export.js";
import { formatTimestamp, sanitizeTerminalText, shortenHome } from "./format.js";
import type { SearchNote, TranscriptEvent } from "./types.js";

/**
 * A run of tool activity between two messages, folded into one line. This is the default view:
 * the conversation stays readable and each run still shows what happened and where.
 */
export type ToolCallGroup = {
	kind: "tool_calls";
	count: number;
	byName: Record<string, number>;
	failed: number;
	/** When the run started, so the group still sorts and displays in time order. */
	timestamp: string | null;
};

export type ChatLogEntry = TranscriptEvent | ToolCallGroup;

export type ExportEnvelope = {
	schemaVersion: 1;
	generatedAt: string;
	verbose: boolean;
	session: Omit<ExportedSession, "events"> | null;
	/** Raw events when verbose; messages plus collapsed tool-call groups otherwise. */
	events: ChatLogEntry[];
	errors: SearchNote[];
	notes: SearchNote[];
};

export function summarizeToolCounts(byName: Record<string, number>): string {
	return Object.entries(byName)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([name, count]) => `${name} ×${count}`)
		.join(", ");
}

/**
 * Replaces every maximal run of non-message events with a single group. Thinking blocks are
 * folded into the run they belong to, and a run that contains no tool call at all disappears.
 */
export function collapseToolCalls(events: TranscriptEvent[]): ChatLogEntry[] {
	const entries: ChatLogEntry[] = [];
	let group: ToolCallGroup | null = null;
	for (const event of events) {
		if (event.kind === "meta") {
			continue;
		}
		if (event.kind === "message") {
			if (group && group.count > 0) {
				entries.push(group);
			}
			group = null;
			entries.push(event);
			continue;
		}
		if (!group) {
			group = { kind: "tool_calls", count: 0, byName: {}, failed: 0, timestamp: event.timestamp };
		}
		if (event.kind === "tool_call") {
			group.count += 1;
			group.byName[event.name] = (group.byName[event.name] ?? 0) + 1;
		} else if (event.kind === "tool_result" && event.isError) {
			group.failed += 1;
		}
	}
	if (group && group.count > 0) {
		entries.push(group);
	}
	return entries;
}

/** Wraps content in a code fence longer than any backtick run inside it, so it cannot escape. */
function fence(content: string, lang = ""): string[] {
	const runs = content.match(/`{3,}/g);
	const longest = runs ? Math.max(...runs.map((run) => run.length)) : 0;
	const ticks = "`".repeat(Math.max(3, longest + 1));
	return [`${ticks}${lang}`, content, ticks];
}

function renderInput(input: unknown): string[] {
	if (input === undefined || input === null) {
		return ["(no input)"];
	}
	if (typeof input === "string") {
		return input.length > 0 ? fence(sanitizeTerminalText(input)) : ["(no input)"];
	}
	let json: string;
	try {
		json = JSON.stringify(input, null, 2) ?? String(input);
	} catch {
		json = String(input);
	}
	return fence(sanitizeTerminalText(json), "json");
}

function when(timestamp: string | null): string {
	return timestamp ? ` · ${formatTimestamp(timestamp)}` : "";
}

function callRef(callId: string | null): string {
	return callId ? ` · ${sanitizeTerminalText(callId)}` : "";
}

function describeGroup(group: ToolCallGroup): string {
	const noun = group.count === 1 ? "tool call" : "tool calls";
	const failed = group.failed > 0 ? `, ${group.failed} failed` : "";
	return `⋯ ${group.count} ${noun} (${sanitizeTerminalText(summarizeToolCounts(group.byName))})${failed}`;
}

/**
 * Renders a session as Markdown that also reads well as plain text. Everything that came from a
 * transcript passes through `sanitizeTerminalText`, since agents store raw terminal output and an
 * export is usually printed straight to a terminal.
 */
export function renderChatLog(
	session: ExportedSession,
	options: { verbose: boolean; homeDir: string },
): string {
	const clean = sanitizeTerminalText;
	const lines: string[] = [];
	lines.push(`# ${clean(session.displayName)} session ${clean(session.sessionId)}`, "");

	if (session.cwd) {
		const branch = session.gitBranch ? ` (${clean(session.gitBranch)})` : "";
		lines.push(`- Project: ${clean(shortenHome(session.cwd, options.homeDir))}${branch}`);
	}
	if (session.model) {
		lines.push(`- Model: ${clean(session.model)}`);
	}
	if (session.startedAt || session.endedAt) {
		lines.push(
			`- Started: ${formatTimestamp(session.startedAt)} · Ended: ${formatTimestamp(session.endedAt)}`,
		);
	}
	const { counts } = session;
	const tools = summarizeToolCounts(session.toolCallsByName);
	const failed = counts.failedToolCalls > 0 ? ` · ${counts.failedToolCalls} failed` : "";
	lines.push(
		`- Messages: ${counts.user} user, ${counts.assistant} assistant · Tool calls: ${counts.toolCalls}` +
			`${tools ? ` (${clean(tools)})` : ""}${failed}`,
	);
	if (session.resumeCommand) {
		lines.push(`- Resume: ${clean(session.resumeCommand)}`);
	}
	for (const sourcePath of session.sourcePaths) {
		lines.push(`- Source: ${clean(shortenHome(sourcePath, options.homeDir))}`);
	}
	lines.push("", "---");

	// tool_result records carry only the call id; the name comes from the matching call.
	const names = new Map<string, string>();
	const entries: ChatLogEntry[] = options.verbose
		? session.events
		: collapseToolCalls(session.events);

	for (const entry of entries) {
		switch (entry.kind) {
			case "message":
				lines.push("", `**${entry.role}**${when(entry.timestamp)}`, "", clean(entry.text));
				break;
			case "tool_calls":
				lines.push("", describeGroup(entry));
				break;
			case "tool_call":
				if (entry.callId) {
					names.set(entry.callId, entry.name);
				}
				lines.push(
					"",
					`**tool call** ${clean(entry.name)}${when(entry.timestamp)}${callRef(entry.callId)}`,
					"",
					...renderInput(entry.input),
				);
				break;
			case "tool_result": {
				const name = entry.callId ? names.get(entry.callId) : undefined;
				const label = name ? ` ${clean(name)}` : "";
				const status = entry.isError ? " · error" : "";
				lines.push(
					"",
					`**tool result**${label}${status}${when(entry.timestamp)}${callRef(entry.callId)}`,
					"",
					...(entry.output.length > 0 ? fence(clean(entry.output)) : ["(no output)"]),
				);
				break;
			}
			case "thinking":
				lines.push("", `**thinking**${when(entry.timestamp)}`, "", clean(entry.text));
				break;
			case "meta":
				break;
		}
	}

	lines.push("");
	return lines.join("\n");
}

export function buildExportEnvelope(options: {
	session: ExportedSession | null;
	verbose: boolean;
	errors: SearchNote[];
	notes: SearchNote[];
	generatedAt: string;
}): ExportEnvelope {
	let session: Omit<ExportedSession, "events"> | null = null;
	let events: ChatLogEntry[] = [];
	if (options.session) {
		const { events: raw, ...rest } = options.session;
		session = rest;
		events = options.verbose ? raw : collapseToolCalls(raw);
	}
	return {
		schemaVersion: 1,
		generatedAt: options.generatedAt,
		verbose: options.verbose,
		session,
		events,
		errors: options.errors,
		notes: options.notes,
	};
}
