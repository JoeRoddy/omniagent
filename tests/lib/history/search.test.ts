import { LARGE_HISTORY_BYTES } from "../../../src/lib/history/auto-since.js";
import { compileQuery } from "../../../src/lib/history/query.js";
import { searchHistory } from "../../../src/lib/history/search.js";
import type { HistoryFile, SearchRecord, SearchScope } from "../../../src/lib/history/types.js";
import type { ResolvedTarget } from "../../../src/lib/targets/config-types.js";

function record(index: number, overrides: Partial<SearchRecord> = {}): SearchRecord {
	return {
		agentId: "demo",
		role: "user",
		timestamp: new Date(Date.UTC(2026, 0, 1) + index).toISOString(),
		text: `matching record ${index}`,
		sessionId: `session-${index}`,
		cwd: "/repo",
		sourcePath: "/history.json",
		recordIndex: index,
		...overrides,
	};
}

function target(records: SearchRecord[], id = "demo"): ResolvedTarget {
	return {
		id,
		displayName: id,
		aliases: [],
		outputs: {},
		isBuiltIn: false,
		isCustomized: true,
		history: {
			roles: ["user"],
			listFiles: async function* () {
				yield {
					path: "/history.json",
					projectPath: "/repo",
					sessionId: "session",
					modifiedAt: "2026-01-01T00:00:00.000Z",
					sizeBytes: null,
				};
			},
			scan: {
				kind: "custom",
				read: async function* () {
					yield* records;
				},
			},
		},
	};
}

async function search(records: SearchRecord[], limit: number) {
	return searchHistory({
		targets: [target(records)],
		query: compileQuery(["matching"]),
		scope: { projectPath: null, projectMatch: null, since: null, until: null },
		roles: new Set(["user"]),
		limit,
		homeDir: "/home/demo",
		cwd: "/repo",
		signal: new AbortController().signal,
	});
}

describe("bounded history search", () => {
	it("keeps the newest 10,000 matches under the unlimited safety cap", async () => {
		const records = Array.from({ length: 10_005 }, (_, index) => record(index));

		const result = await search(records, 0);

		expect(result.hits).toHaveLength(10_000);
		expect(result.hits[0]?.record.recordIndex).toBe(10_004);
		expect(result.hits.at(-1)?.record.recordIndex).toBe(5);
		expect(result.stats.matchedRecords).toBe(10_005);
		expect(result.stats.returnedMatches).toBe(10_000);
		expect(result.stats.truncated).toBe(true);
	});

	it("uses a finite requested limit as the heap capacity", async () => {
		const records = [record(2), record(0), record(4), record(1), record(3)];

		const result = await search(records, 3);

		expect(result.hits.map((hit) => hit.record.recordIndex)).toEqual([4, 3, 2]);
		expect(result.stats.matchedRecords).toBe(5);
		expect(result.stats.returnedMatches).toBe(3);
		expect(result.stats.truncated).toBe(true);
	});

	it("preserves deterministic tie-breaks and sorts unknown timestamps last", async () => {
		const timestamp = "2026-01-01T00:00:00.000Z";
		const records = [
			record(4, { agentId: "beta", sessionId: "s1", timestamp, recordIndex: 0 }),
			record(3, { agentId: "alpha", sessionId: "s2", timestamp, recordIndex: 0 }),
			record(2, { agentId: "alpha", sessionId: "s1", timestamp, recordIndex: 1 }),
			record(1, { agentId: "alpha", sessionId: "s1", timestamp, recordIndex: 0 }),
			record(5, { agentId: "unknown-b", timestamp: "not-a-date", recordIndex: 0 }),
			record(6, { agentId: "unknown-a", timestamp: null, recordIndex: 0 }),
		];

		const result = await search(records, 0);

		expect(
			result.hits.map(({ record: hit }) => [
				hit.agentId,
				hit.sessionId,
				hit.recordIndex,
				hit.timestamp,
			]),
		).toEqual([
			["alpha", "s1", 0, timestamp],
			["alpha", "s1", 1, timestamp],
			["alpha", "s2", 0, timestamp],
			["beta", "s1", 0, timestamp],
			["unknown-a", "session-6", 0, null],
			["unknown-b", "session-5", 0, "not-a-date"],
		]);
	});

	it("uses source paths to resolve otherwise identical ordering ties", async () => {
		const timestamp = "2026-01-01T00:00:00.000Z";
		const records = [
			record(1, {
				timestamp,
				sessionId: "shared-session",
				sourcePath: "/z-history.json",
				recordIndex: 0,
			}),
			record(0, {
				timestamp,
				sessionId: "shared-session",
				sourcePath: "/a-history.json",
				recordIndex: 0,
			}),
		];

		const result = await search(records, 0);

		expect(result.hits.map((hit) => hit.record.sourcePath)).toEqual([
			"/a-history.json",
			"/z-history.json",
		]);
	});
});

type FileFixture = {
	file: HistoryFile;
	records: SearchRecord[];
};

function historyFile(name: string, overrides: Partial<HistoryFile> = {}): HistoryFile {
	return {
		path: `/history/${name}.jsonl`,
		projectPath: "/repo",
		sessionId: name,
		modifiedAt: "2026-08-01T00:00:00.000Z",
		sizeBytes: 1,
		...overrides,
	};
}

function targetWithFiles(fixtures: FileFixture[], scanned: string[]): ResolvedTarget {
	return {
		id: "adaptive",
		displayName: "Adaptive Agent",
		aliases: [],
		outputs: {},
		isBuiltIn: false,
		isCustomized: true,
		history: {
			roles: ["user"],
			listFiles: async function* () {
				for (const fixture of fixtures) {
					yield fixture.file;
				}
			},
			scan: {
				kind: "custom",
				read: async function* (file) {
					scanned.push(file.path);
					const fixture = fixtures.find((candidate) => candidate.file.path === file.path);
					if (fixture) {
						yield* fixture.records;
					}
				},
			},
		},
	};
}

async function adaptiveSearch(
	fixtures: FileFixture[],
	options: { automaticSince?: boolean; scope?: Partial<SearchScope>; limit?: number } = {},
) {
	const scanned: string[] = [];
	const scope: SearchScope = {
		projectPath: null,
		projectMatch: null,
		since: null,
		until: null,
		...options.scope,
	};
	const result = await searchHistory({
		targets: [targetWithFiles(fixtures, scanned)],
		query: compileQuery(["matching"]),
		scope,
		roles: new Set(["user"]),
		limit: options.limit ?? 0,
		homeDir: "/home/demo",
		cwd: "/repo",
		signal: new AbortController().signal,
		automaticSince: options.automaticSince,
	});
	return { result, scanned };
}

describe("adaptive history cutoff", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-09T12:00:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("derives an effective scope and prunes old files before reading them", async () => {
		const old = historyFile("old", {
			modifiedAt: "2024-01-01T00:00:00.000Z",
			sizeBytes: LARGE_HISTORY_BYTES + 1,
		});
		const recent = historyFile("recent");
		const { result, scanned } = await adaptiveSearch(
			[
				{ file: old, records: [record(0)] },
				{ file: recent, records: [record(1, { timestamp: "2026-08-01T00:00:00.000Z" })] },
			],
			{ automaticSince: true },
		);

		expect(result.effectiveScope.since).toEqual(new Date("2025-08-09T12:00:00.000Z"));
		expect(result.notes).toContainEqual({
			targetId: "",
			displayName: "",
			code: "automatic_since",
			message: "Large history detected: using `--since 365d`. Use `--all-history` for everything.",
		});
		expect(scanned).toEqual([recent.path]);
	});

	it("still filters old records inside recent files and scans unknown-mtime files", async () => {
		const trigger = historyFile("trigger", {
			modifiedAt: "2024-01-01T00:00:00.000Z",
			sizeBytes: LARGE_HISTORY_BYTES + 1,
		});
		const mixed = historyFile("mixed");
		const unknown = historyFile("unknown", { modifiedAt: null });
		const { result, scanned } = await adaptiveSearch(
			[
				{ file: trigger, records: [] },
				{ file: mixed, records: [record(0, { timestamp: "2024-06-01T00:00:00.000Z" })] },
				{
					file: unknown,
					records: [record(1, { timestamp: "2026-08-02T00:00:00.000Z" })],
				},
			],
			{ automaticSince: true },
		);

		expect(scanned).toEqual(expect.arrayContaining([mixed.path, unknown.path]));
		expect(scanned).not.toContain(trigger.path);
		expect(result.hits.map((hit) => hit.record.sourcePath)).toEqual(["/history.json"]);
		expect(result.hits[0]?.record.recordIndex).toBe(1);
	});

	it("scans every file when automatic cutoff is disabled", async () => {
		const old = historyFile("old", {
			modifiedAt: "2024-01-01T00:00:00.000Z",
			sizeBytes: LARGE_HISTORY_BYTES + 1,
		});
		const recent = historyFile("recent");
		const { result, scanned } = await adaptiveSearch(
			[
				{ file: old, records: [record(0, { timestamp: "2024-01-01T00:00:00.000Z" })] },
				{ file: recent, records: [record(1, { timestamp: "2026-08-01T00:00:00.000Z" })] },
			],
			{ automaticSince: false },
		);

		expect(scanned).toHaveLength(2);
		expect(result.hits).toHaveLength(2);
		expect(result.effectiveScope.since).toBeNull();
		expect(result.notes).not.toContainEqual(expect.objectContaining({ code: "automatic_since" }));
	});

	it("preserves an explicit since without adding an automatic note", async () => {
		const since = new Date("2026-07-01T00:00:00.000Z");
		const { result } = await adaptiveSearch(
			[
				{
					file: historyFile("large", { sizeBytes: LARGE_HISTORY_BYTES + 1 }),
					records: [record(0, { timestamp: "2026-08-01T00:00:00.000Z" })],
				},
			],
			{ automaticSince: true, scope: { since } },
		);

		expect(result.effectiveScope.since).toBe(since);
		expect(result.notes).not.toContainEqual(expect.objectContaining({ code: "automatic_since" }));
	});

	it("preserves an explicit until without adding an automatic note", async () => {
		const until = new Date("2026-08-10T00:00:00.000Z");
		const { result } = await adaptiveSearch(
			[
				{
					file: historyFile("large", { sizeBytes: LARGE_HISTORY_BYTES + 1 }),
					records: [record(0, { timestamp: "2026-08-01T00:00:00.000Z" })],
				},
			],
			{ automaticSince: true, scope: { until } },
		);

		expect(result.effectiveScope.until).toBe(until);
		expect(result.notes).not.toContainEqual(expect.objectContaining({ code: "automatic_since" }));
	});

	it("leaves small histories unbounded and keeps normal ordering, limits, and stats", async () => {
		const { result } = await adaptiveSearch(
			[
				{
					file: historyFile("small"),
					records: [
						record(0, { timestamp: "2026-08-01T00:00:00.000Z" }),
						record(1, { timestamp: "2026-08-02T00:00:00.000Z" }),
					],
				},
			],
			{ automaticSince: true, limit: 1 },
		);

		expect(result.effectiveScope.since).toBeNull();
		expect(result.notes).not.toContainEqual(expect.objectContaining({ code: "automatic_since" }));
		expect(result.hits[0]?.record.recordIndex).toBe(1);
		expect(result.stats).toMatchObject({
			scannedFiles: 1,
			matchedRecords: 2,
			returnedMatches: 1,
			truncated: true,
		});
	});

	it("does not report discovered history as unavailable after automatic pruning", async () => {
		const { result } = await adaptiveSearch(
			[
				{
					file: historyFile("old", {
						modifiedAt: "2024-01-01T00:00:00.000Z",
						sizeBytes: LARGE_HISTORY_BYTES + 1,
					}),
					records: [],
				},
			],
			{ automaticSince: true },
		);

		expect(result.stats.scannedFiles).toBe(0);
		expect(result.notes).not.toContainEqual(
			expect.objectContaining({ code: "history_unavailable" }),
		);
	});
});
