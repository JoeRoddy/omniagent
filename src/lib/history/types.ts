import type { HistoryQuery } from "./query.js";

export const HISTORY_ROLES = ["user", "assistant", "agent"] as const;
export type HistoryRole = (typeof HISTORY_ROLES)[number];

export function isHistoryRole(value: string): value is HistoryRole {
	return (HISTORY_ROLES as readonly string[]).includes(value);
}

/**
 * What subset of history the caller wants. Targets MAY use this to prune files cheaply in
 * `listFiles`; the engine re-applies every predicate authoritatively afterwards, so a target
 * that prunes nothing is still correct — just slower.
 */
export type SearchScope = {
	/** Absolute path. Sessions whose cwd is at or below this path match. */
	projectPath: string | null;
	/** Case-insensitive substring match against the session cwd. */
	projectMatch: string | null;
	since: Date | null;
	until: Date | null;
};

export type HistoryContext = {
	targetId: string;
	displayName: string;
	homeDir: string;
	cwd: string;
	/** Roles the caller asked for. Readers may skip work for roles nobody wants. */
	roles: ReadonlySet<HistoryRole>;
	signal: AbortSignal;
};

/** A candidate transcript, discovered by `listFiles` before any content is parsed. */
export type HistoryFile = {
	path: string;
	/** Session cwd when derivable from the file's location or header; else null. */
	projectPath: string | null;
	/** Session id when derivable from the path or header; else null. */
	sessionId: string | null;
	/**
	 * ISO 8601. Enables safe cutoff pruning and newest-first ordering. Null or invalid values fail
	 * open and leave the file eligible for scanning.
	 */
	modifiedAt: string | null;
	/** Contributes to adaptive cutoff selection. Null or invalid values are ignored. */
	sizeBytes: number | null;
	/** Free-form payload carried from `listFiles` through to `normalize`. */
	meta?: Record<string, unknown>;
};

/**
 * The runtime-validated shape every target reader emits. `text` is cleaned and never empty;
 * `recordIndex` is a non-negative integer.
 */
export type SearchRecord = {
	agentId: string;
	role: HistoryRole;
	timestamp: string | null;
	text: string;
	sessionId: string;
	cwd: string | null;
	gitBranch?: string | null;
	sourcePath: string;
	recordIndex: number;
};

export type HistoryResume = {
	command: string;
	args: string[];
	/** Set when the agent's resume verb is directory-scoped, so the renderer emits a `cd` prefix. */
	cwd: string | null;
};

/**
 * The per-target history capability. Everything agent-specific lives here — directory layout,
 * record shapes, resume verb — so the search engine never branches on target id.
 */
export type TargetHistoryDefinition = {
	/** Roles this agent can produce. Declared, not inferred, so partial support is reportable. */
	roles: HistoryRole[];
	/** Enumerate candidate transcripts. Owns all discovery and pruning. readdir/stat only. */
	listFiles: (scope: SearchScope, context: HistoryContext) => AsyncIterable<HistoryFile>;
	/**
	 * Optional raw-line optimization. Omit unless returning false proves the normalized record could
	 * not match; the engine defaults to parsing every line so normalization cannot lose results.
	 */
	prefilter?: (line: string, query: HistoryQuery) => boolean;
	/**
	 * How the engine turns a file into records. Omit for the JSONL fast path, where the engine
	 * owns the read loop so it can prefilter raw lines before `JSON.parse`.
	 * Use `custom` for agents whose history is not line-oriented.
	 */
	scan?:
		| { kind: "jsonl" }
		| {
				kind: "custom";
				read: (file: HistoryFile, context: HistoryContext) => AsyncIterable<SearchRecord>;
		  };
	/** JSONL fast path: one raw line in, one record out, or null to discard. */
	normalize?: (
		line: string,
		file: HistoryFile,
		index: number,
		context: HistoryContext,
	) => SearchRecord | null;
	/** How to re-enter this session. Returning null means "not resumable". */
	resume?: (record: SearchRecord) => HistoryResume | null;
};

export type SearchHit = {
	record: SearchRecord;
	displayName: string;
	resume: HistoryResume | null;
};

export type SearchNote = {
	targetId: string;
	displayName: string;
	code: string;
	message: string;
};

export type SearchStats = {
	scannedFiles: number;
	skippedFiles: number;
	scannedBytes: number;
	malformedRecords: number;
	oversizedLines: number;
	matchedRecords: number;
	returnedMatches: number;
	truncated: boolean;
	elapsedMs: number;
};

export type SearchEnvelope = {
	schemaVersion: 1;
	generatedAt: string;
	query: {
		raw: string;
		terms: string[];
		mode: "literal" | "regex";
		caseSensitive: boolean;
	};
	scope: {
		kind: "all" | "path" | "substring";
		projectPath: string | null;
		projectMatch: string | null;
		roles: HistoryRole[];
		since: string | null;
		until: string | null;
		targets: string[];
	};
	matches: SearchMatch[];
	stats: SearchStats;
	errors: SearchNote[];
	notes: SearchNote[];
};

export type SearchMatch = {
	agentId: string;
	displayName: string;
	role: HistoryRole;
	timestamp: string | null;
	sessionId: string;
	cwd: string | null;
	project: string | null;
	gitBranch: string | null;
	sourcePath: string;
	text: string;
	textTruncated: boolean;
	excerpt: string;
	matchRanges: Array<[number, number]>;
	resumeCommand: string | null;
};

export class HistoryReadError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "HistoryReadError";
		this.code = code;
	}
}
