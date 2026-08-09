import { compileQuery } from "../../../src/lib/history/query.js";
import { searchHistory } from "../../../src/lib/history/search.js";
import type { SearchRecord } from "../../../src/lib/history/types.js";
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
});
