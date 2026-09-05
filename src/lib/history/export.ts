import type { ResolvedTarget } from "../targets/config-types.js";
import { formatResumeCommand } from "./format.js";
import { readJsonlLines } from "./jsonl.js";
import { isSearchRecord, toAsyncIterable } from "./search.js";
import type {
	HistoryContext,
	HistoryFile,
	HistoryRole,
	SearchNote,
	SearchRecord,
	SearchScope,
	TargetHistoryDefinition,
	TranscriptEvent,
} from "./types.js";

/**
 * A chat log is the conversation between the human and the agent. Subagent transcripts are
 * separate sessions that happen to share an id, so the `agent` role is never requested here;
 * what the main thread saw of them is already in the Task tool's input and result.
 */
const CONVERSATION_ROLES: readonly HistoryRole[] = ["user", "assistant"];
const UNSCOPED: SearchScope = { projectPath: null, projectMatch: null, since: null, until: null };
const EVENT_KINDS = new Set<string>(["meta", "message", "tool_call", "tool_result", "thinking"]);

export type ExportOptions = {
	targets: ResolvedTarget[];
	/** Full session id, or a prefix long enough to be unique. Case-insensitive. */
	sessionId: string;
	homeDir: string;
	cwd: string;
	signal: AbortSignal;
};

export type ExportCandidate = {
	agentId: string;
	displayName: string;
	sessionId: string;
	cwd: string | null;
	modifiedAt: string | null;
};

export type TranscriptCounts = {
	user: number;
	assistant: number;
	toolCalls: number;
	toolResults: number;
	failedToolCalls: number;
	thinking: number;
};

export type ExportedSession = {
	agentId: string;
	displayName: string;
	sessionId: string;
	cwd: string | null;
	gitBranch: string | null;
	model: string | null;
	startedAt: string | null;
	endedAt: string | null;
	sourcePaths: string[];
	resumeCommand: string | null;
	counts: TranscriptCounts;
	/** Tool name → number of calls, for the header summary. */
	toolCallsByName: Record<string, number>;
	/** Every non-meta event in file order. */
	events: TranscriptEvent[];
};

export type ExportResult = {
	/** Null when the id matched nothing or matched more than one session. */
	session: ExportedSession | null;
	/** Every session the id matched. Empty means not found; two or more means ambiguous. */
	candidates: ExportCandidate[];
	notes: SearchNote[];
	errors: SearchNote[];
};

type SessionGroup = {
	target: ResolvedTarget;
	history: TargetHistoryDefinition;
	context: HistoryContext;
	sessionId: string;
	files: HistoryFile[];
	exact: boolean;
};

function isOptionalString(value: unknown): boolean {
	return value === undefined || value === null || typeof value === "string";
}

/**
 * Runtime shape check for events handed back by a target reader. A custom target that emits
 * garbage should lose that event, not crash the export.
 */
export function isTranscriptEvent(value: unknown): value is TranscriptEvent {
	if (!value || typeof value !== "object") {
		return false;
	}
	const event = value as Record<string, unknown>;
	if (typeof event.kind !== "string" || !EVENT_KINDS.has(event.kind)) {
		return false;
	}
	const timestampOk = event.timestamp === null || typeof event.timestamp === "string";
	const callIdOk = event.callId === null || typeof event.callId === "string";
	switch (event.kind) {
		case "meta":
			return (
				isOptionalString(event.cwd) &&
				isOptionalString(event.gitBranch) &&
				isOptionalString(event.model)
			);
		case "message":
			return (
				(event.role === "user" || event.role === "assistant") &&
				typeof event.text === "string" &&
				event.text.length > 0 &&
				timestampOk
			);
		case "tool_call":
			return callIdOk && typeof event.name === "string" && event.name.length > 0 && timestampOk;
		case "tool_result":
			return (
				callIdOk &&
				typeof event.output === "string" &&
				typeof event.isError === "boolean" &&
				timestampOk
			);
		case "thinking":
			return typeof event.text === "string" && event.text.length > 0 && timestampOk;
		default:
			return false;
	}
}

/**
 * Messages-only fallback for a target that declares searchable history but no `transcript`
 * reader. Reuses whichever search reader the target defined, so any searchable agent is at least
 * exportable as a plain conversation.
 */
async function* readMessagesOnly(
	file: HistoryFile,
	history: TargetHistoryDefinition,
	context: HistoryContext,
): AsyncGenerator<TranscriptEvent> {
	const toEvent = (record: unknown): TranscriptEvent | null => {
		if (!isSearchRecord(record) || (record.role !== "user" && record.role !== "assistant")) {
			return null;
		}
		return { kind: "message", role: record.role, text: record.text, timestamp: record.timestamp };
	};

	if (history.scan?.kind === "custom") {
		for await (const record of toAsyncIterable<SearchRecord>(history.scan.read(file, context))) {
			const event = toEvent(record);
			if (event) {
				yield event;
			}
		}
		return;
	}
	const normalize = history.normalize;
	if (!normalize) {
		return;
	}
	for await (const line of readJsonlLines(file.path, { signal: context.signal })) {
		const event = toEvent(normalize(line.text, file, line.index, context));
		if (event) {
			yield event;
		}
	}
}

function compareFiles(a: HistoryFile, b: HistoryFile): number {
	return (a.modifiedAt ?? "").localeCompare(b.modifiedAt ?? "") || a.path.localeCompare(b.path);
}

/** Cheap look at the first meta event, so an ambiguity listing can show each session's project. */
async function peekCwd(group: SessionGroup): Promise<string | null> {
	const file = group.files[0];
	if (!file || !group.history.transcript) {
		return file?.projectPath ?? null;
	}
	try {
		for await (const event of toAsyncIterable<TranscriptEvent>(
			group.history.transcript(file, group.context),
		)) {
			if (isTranscriptEvent(event) && event.kind === "meta") {
				return event.cwd ?? file.projectPath;
			}
			// The first event should be meta. Anything else means this reader does not emit one.
			break;
		}
	} catch {
		// Fall through to the discovery-time value.
	}
	return file.projectPath;
}

async function describeCandidate(group: SessionGroup): Promise<ExportCandidate> {
	const newest = [...group.files].sort(compareFiles).at(-1);
	const fromDiscovery = group.files.find((file) => file.projectPath)?.projectPath ?? null;
	return {
		agentId: group.target.id,
		displayName: group.target.displayName,
		sessionId: group.sessionId,
		cwd: fromDiscovery ?? (await peekCwd(group)),
		modifiedAt: newest?.modifiedAt ?? null,
	};
}

function compareCandidates(a: ExportCandidate, b: ExportCandidate): number {
	return (
		(b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? "") ||
		a.agentId.localeCompare(b.agentId) ||
		a.sessionId.localeCompare(b.sessionId)
	);
}

async function readSession(
	group: SessionGroup,
	options: ExportOptions,
	notes: SearchNote[],
	errors: SearchNote[],
): Promise<ExportedSession> {
	const files = [...group.files].sort(compareFiles);
	const events: TranscriptEvent[] = [];
	const counts: TranscriptCounts = {
		user: 0,
		assistant: 0,
		toolCalls: 0,
		toolResults: 0,
		failedToolCalls: 0,
		thinking: 0,
	};
	const toolCallsByName: Record<string, number> = {};
	let cwd: string | null = null;
	let gitBranch: string | null = null;
	let model: string | null = null;
	let startedAt: string | null = null;
	let endedAt: string | null = null;
	let earliest = Number.NaN;
	let latest = Number.NaN;
	let malformed = 0;
	let usedFallback = false;

	for (const file of files) {
		if (options.signal.aborted) {
			break;
		}
		let source: AsyncIterable<TranscriptEvent>;
		if (group.history.transcript) {
			source = toAsyncIterable<TranscriptEvent>(group.history.transcript(file, group.context));
		} else {
			usedFallback = true;
			source = readMessagesOnly(file, group.history, group.context);
		}
		try {
			for await (const raw of source) {
				if (options.signal.aborted) {
					break;
				}
				if (!isTranscriptEvent(raw)) {
					malformed += 1;
					continue;
				}
				if (raw.kind === "meta") {
					cwd ??= raw.cwd ?? null;
					gitBranch ??= raw.gitBranch ?? null;
					model ??= raw.model ?? null;
					continue;
				}
				events.push(raw);
				switch (raw.kind) {
					case "message":
						counts[raw.role] += 1;
						break;
					case "tool_call":
						counts.toolCalls += 1;
						toolCallsByName[raw.name] = (toolCallsByName[raw.name] ?? 0) + 1;
						break;
					case "tool_result":
						counts.toolResults += 1;
						if (raw.isError) {
							counts.failedToolCalls += 1;
						}
						break;
					case "thinking":
						counts.thinking += 1;
						break;
				}
				const at = raw.timestamp ? Date.parse(raw.timestamp) : Number.NaN;
				if (!Number.isNaN(at)) {
					if (Number.isNaN(earliest) || at < earliest) {
						earliest = at;
						startedAt = raw.timestamp;
					}
					if (Number.isNaN(latest) || at > latest) {
						latest = at;
						endedAt = raw.timestamp;
					}
				}
			}
		} catch (error) {
			errors.push({
				targetId: group.target.id,
				displayName: group.target.displayName,
				code: "transcript_read_failed",
				message: `Could not read ${file.path}: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	cwd ??= files.find((file) => file.projectPath)?.projectPath ?? null;

	if (usedFallback) {
		notes.push({
			targetId: group.target.id,
			displayName: group.target.displayName,
			code: "transcript_unavailable",
			message: `${group.target.displayName} does not expose tool calls; the chat log contains messages only.`,
		});
	}
	if (malformed > 0) {
		notes.push({
			targetId: group.target.id,
			displayName: group.target.displayName,
			code: "malformed_events",
			message: `Skipped ${malformed} malformed transcript event(s).`,
		});
	}

	// `resume` is keyed on a search record, and the only fields a resume verb has ever needed
	// are the session id and cwd, so a minimal record standing for the session is enough.
	let resumeCommand: string | null = null;
	if (group.history.resume) {
		try {
			const resume = group.history.resume({
				agentId: group.target.id,
				role: "user",
				timestamp: startedAt,
				text: group.sessionId,
				sessionId: group.sessionId,
				cwd,
				gitBranch,
				sourcePath: files[0]?.path ?? "",
				recordIndex: 0,
			});
			resumeCommand = formatResumeCommand(resume ?? null, options.cwd, options.homeDir);
		} catch {
			resumeCommand = null;
		}
	}

	return {
		agentId: group.target.id,
		displayName: group.target.displayName,
		sessionId: group.sessionId,
		cwd,
		gitBranch,
		model,
		startedAt,
		endedAt,
		sourcePaths: files.map((file) => file.path),
		resumeCommand,
		counts,
		toolCallsByName,
		events,
	};
}

/**
 * Finds one session by id across every history-capable target and reads it in full. Discovery
 * goes through each target's own `listFiles`, so the engine never learns where any agent keeps
 * its transcripts. An exact id match wins outright; otherwise a unique prefix is accepted.
 */
export async function exportSession(options: ExportOptions): Promise<ExportResult> {
	const notes: SearchNote[] = [];
	const errors: SearchNote[] = [];
	const wanted = options.sessionId.trim().toLowerCase();
	if (wanted.length === 0) {
		return { session: null, candidates: [], notes, errors };
	}

	const groups = new Map<string, SessionGroup>();
	for (const target of options.targets) {
		const history = target.history;
		if (!history) {
			continue;
		}
		const supported = new Set(history.roles);
		const requested = new Set(CONVERSATION_ROLES.filter((role) => supported.has(role)));
		if (requested.size === 0) {
			notes.push({
				targetId: target.id,
				displayName: target.displayName,
				code: "role_unsupported",
				message: `${target.displayName} does not record conversation messages.`,
			});
			continue;
		}
		const context: HistoryContext = {
			targetId: target.id,
			displayName: target.displayName,
			homeDir: options.homeDir,
			cwd: options.cwd,
			roles: requested,
			signal: options.signal,
		};
		try {
			for await (const file of toAsyncIterable<HistoryFile>(history.listFiles(UNSCOPED, context))) {
				if (options.signal.aborted) {
					break;
				}
				const id = file.sessionId;
				if (!id) {
					continue;
				}
				const lowered = id.toLowerCase();
				const exact = lowered === wanted;
				if (!exact && !lowered.startsWith(wanted)) {
					continue;
				}
				const key = `${target.id}::${lowered}`;
				const group = groups.get(key);
				if (group) {
					group.files.push(file);
				} else {
					groups.set(key, { target, history, context, sessionId: id, files: [file], exact });
				}
			}
		} catch (error) {
			errors.push({
				targetId: target.id,
				displayName: target.displayName,
				code: "history_list_failed",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	const all = [...groups.values()];
	const exactMatches = all.filter((group) => group.exact);
	const chosen = exactMatches.length > 0 ? exactMatches : all;
	const candidates = (await Promise.all(chosen.map(describeCandidate))).sort(compareCandidates);

	const only = chosen.length === 1 ? chosen[0] : undefined;
	if (!only) {
		return { session: null, candidates, notes, errors };
	}
	const session = await readSession(only, options, notes, errors);
	return { session, candidates, notes, errors };
}
