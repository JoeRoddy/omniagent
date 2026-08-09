import type { ResolvedTarget } from "../targets/config-types.js";
import { chooseAutomaticSince, historyFileMatchesSince } from "./auto-since.js";
import { BoundedTopK } from "./bounded-top-k.js";
import { recordMatchesScope } from "./filters.js";
import { type JsonlCounters, readJsonlLines } from "./jsonl.js";
import { type HistoryQuery, matchesText } from "./query.js";
import {
	type HistoryContext,
	type HistoryFile,
	type HistoryRole,
	isHistoryRole,
	type SearchHit,
	type SearchNote,
	type SearchRecord,
	type SearchScope,
	type SearchStats,
	type TargetHistoryDefinition,
} from "./types.js";

const DEFAULT_CONCURRENCY = 8;
/**
 * Backstop against a pathological query (`--regex .` over `--role all`). Buffering hits is cheap
 * — a real corpus holds only a few thousand user records — but it must still be bounded.
 */
const MAX_BUFFERED_HITS = 10_000;

export type SearchOptions = {
	targets: ResolvedTarget[];
	query: HistoryQuery;
	scope: SearchScope;
	roles: Set<HistoryRole>;
	limit: number;
	homeDir: string;
	cwd: string;
	signal: AbortSignal;
	concurrency?: number;
	automaticSince?: boolean;
};

export type SearchResult = {
	hits: SearchHit[];
	stats: SearchStats;
	errors: SearchNote[];
	notes: SearchNote[];
	effectiveScope: SearchScope;
};

type QueuedFile = {
	file: HistoryFile;
	target: ResolvedTarget;
	history: TargetHistoryDefinition;
	context: HistoryContext;
};

/**
 * Tolerates a capability that hands back a promise, or a plain sync iterable, instead of the
 * declared async iterable. Built-ins get this right by construction; a hand-written custom target
 * should degrade rather than crash with "undefined is not async iterable".
 */
async function* toAsyncIterable<T>(value: unknown): AsyncGenerator<T> {
	const resolved = (await value) as AsyncIterable<T> | Iterable<T> | null | undefined;
	if (!resolved) {
		return;
	}
	if (typeof (resolved as AsyncIterable<T>)[Symbol.asyncIterator] === "function") {
		yield* resolved as AsyncIterable<T>;
		return;
	}
	if (typeof (resolved as Iterable<T>)[Symbol.iterator] === "function") {
		yield* resolved as Iterable<T>;
	}
}

function isSearchRecord(value: unknown): value is SearchRecord {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		typeof record.agentId === "string" &&
		typeof record.role === "string" &&
		isHistoryRole(record.role) &&
		(record.timestamp === null || typeof record.timestamp === "string") &&
		typeof record.text === "string" &&
		record.text.length > 0 &&
		typeof record.sessionId === "string" &&
		(record.cwd === null || typeof record.cwd === "string") &&
		(record.gitBranch === undefined ||
			record.gitBranch === null ||
			typeof record.gitBranch === "string") &&
		typeof record.sourcePath === "string" &&
		typeof record.recordIndex === "number" &&
		Number.isInteger(record.recordIndex) &&
		record.recordIndex >= 0
	);
}

async function runPool<T>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let cursor = 0;
	const size = Math.max(1, Math.min(concurrency, items.length));
	const workers = Array.from({ length: size }, async () => {
		for (;;) {
			const index = cursor;
			cursor += 1;
			if (index >= items.length) {
				return;
			}
			await worker(items[index] as T);
		}
	});
	await Promise.all(workers);
}

function compareHits(a: SearchHit, b: SearchHit): number {
	const left = a.record.timestamp ? Date.parse(a.record.timestamp) : Number.NaN;
	const right = b.record.timestamp ? Date.parse(b.record.timestamp) : Number.NaN;
	const leftValid = !Number.isNaN(left);
	const rightValid = !Number.isNaN(right);
	// Records without a usable timestamp sort last rather than jumbling the newest-first order.
	if (leftValid !== rightValid) {
		return leftValid ? -1 : 1;
	}
	if (leftValid && rightValid && left !== right) {
		return right - left;
	}
	// Deterministic tie-break so output is stable across runs and across machines.
	return (
		a.record.agentId.localeCompare(b.record.agentId) ||
		a.record.sessionId.localeCompare(b.record.sessionId) ||
		a.record.sourcePath.localeCompare(b.record.sourcePath) ||
		a.record.recordIndex - b.record.recordIndex
	);
}

export async function searchHistory(options: SearchOptions): Promise<SearchResult> {
	const startedAt = Date.now();
	const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
	const stats: SearchStats = {
		scannedFiles: 0,
		skippedFiles: 0,
		scannedBytes: 0,
		malformedRecords: 0,
		oversizedLines: 0,
		matchedRecords: 0,
		returnedMatches: 0,
		truncated: false,
		elapsedMs: 0,
	};
	const errors: SearchNote[] = [];
	const notes: SearchNote[] = [];
	const effectiveScope = { ...options.scope };
	const hitCapacity =
		options.limit > 0 ? Math.min(options.limit, MAX_BUFFERED_HITS) : MAX_BUFFERED_HITS;
	const hits = new BoundedTopK<SearchHit>(hitCapacity, compareHits);

	let queue: QueuedFile[] = [];
	for (const target of options.targets) {
		const history = target.history;
		if (!history) {
			continue;
		}
		const supported = new Set(history.roles);
		const requested = new Set([...options.roles].filter((role) => supported.has(role)));
		if (requested.size === 0) {
			notes.push({
				targetId: target.id,
				displayName: target.displayName,
				code: "role_unsupported",
				message: `${target.displayName} does not record ${[...options.roles].join(", ")} messages.`,
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
			let found = 0;
			for await (const file of toAsyncIterable<HistoryFile>(
				history.listFiles(options.scope, context),
			)) {
				found += 1;
				queue.push({ file, target, history, context });
			}
			if (found === 0) {
				notes.push({
					targetId: target.id,
					displayName: target.displayName,
					code: "history_unavailable",
					message: `No ${target.displayName} history was found to search.`,
				});
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

	if (options.automaticSince && !options.scope.since && !options.scope.until) {
		const decision = chooseAutomaticSince(queue.map((entry) => entry.file));
		if (decision) {
			effectiveScope.since = decision.since;
			notes.push({
				targetId: "",
				displayName: "",
				code: "automatic_since",
				message:
					`Large history detected: using \`--since ${decision.argument}\`. ` +
					"Use `--all-history` for everything.",
			});
			queue = queue.filter((entry) => historyFileMatchesSince(entry.file, decision.since));
		}
	}

	// Process recent transcripts first for predictable scan behavior. The bounded heap and its
	// comparator determine which hits survive regardless of file or worker completion order.
	queue.sort((a, b) => (b.file.modifiedAt ?? "").localeCompare(a.file.modifiedAt ?? ""));

	const counters: JsonlCounters = { scannedBytes: 0, oversizedLines: 0 };

	const collect = (record: SearchRecord, entry: QueuedFile): void => {
		if (!options.roles.has(record.role)) {
			return;
		}
		if (!recordMatchesScope(record, effectiveScope)) {
			return;
		}
		if (!matchesText(options.query, record.text)) {
			return;
		}
		stats.matchedRecords += 1;
		const offered = hits.offer({
			record,
			displayName: entry.target.displayName,
			resume: entry.history.resume ? (entry.history.resume(record) ?? null) : null,
		});
		if (offered.discarded) {
			stats.truncated = true;
		}
	};

	await runPool(queue, concurrency, async (entry) => {
		if (options.signal.aborted) {
			return;
		}
		try {
			const custom = entry.history.scan?.kind === "custom" ? entry.history.scan : null;
			if (custom) {
				// A bespoke store forgoes the raw-line prefilter; it hands back records directly.
				for await (const record of toAsyncIterable<SearchRecord>(
					custom.read(entry.file, entry.context),
				)) {
					if (options.signal.aborted) {
						return;
					}
					if (!isSearchRecord(record)) {
						stats.malformedRecords += 1;
						continue;
					}
					collect(record, entry);
				}
				stats.scannedFiles += 1;
				return;
			}

			const normalize = entry.history.normalize;
			if (!normalize) {
				return;
			}
			const prefilter = entry.history.prefilter;
			for await (const line of readJsonlLines(entry.file.path, {
				prefilter: prefilter ? (text) => prefilter(text, options.query) : undefined,
				signal: options.signal,
				counters,
			})) {
				const record = normalize(line.text, entry.file, line.index, entry.context);
				if (record === null) {
					continue;
				}
				if (!isSearchRecord(record)) {
					stats.malformedRecords += 1;
					continue;
				}
				collect(record, entry);
			}
			stats.scannedFiles += 1;
		} catch {
			// One unreadable or hostile transcript must never abort a whole-corpus search, and it
			// is not an error worth failing the command over. The caller aggregates the count into
			// a single note.
			stats.skippedFiles += 1;
		}
	});

	stats.scannedBytes = counters.scannedBytes;
	stats.oversizedLines = counters.oversizedLines;

	const retained = hits.toSortedArray();
	stats.returnedMatches = retained.length;
	stats.elapsedMs = Date.now() - startedAt;

	return { hits: retained, stats, errors, notes, effectiveScope };
}
