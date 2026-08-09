import {
	AUTO_SINCE_WINDOWS,
	chooseAutomaticSince,
	historyFileMatchesSince,
	LARGE_HISTORY_BYTES,
	LARGE_HISTORY_FILES,
	TARGET_HISTORY_BYTES,
	TARGET_HISTORY_FILES,
} from "../../../src/lib/history/auto-since.js";
import { parseWhen } from "../../../src/lib/history/filters.js";
import type { HistoryFile } from "../../../src/lib/history/types.js";

const NOW = new Date("2026-08-09T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;
let fileIndex = 0;

function daysAgo(days: number): string {
	return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

function file(overrides: Partial<HistoryFile> = {}): HistoryFile {
	return {
		path: `/history/${fileIndex++}.jsonl`,
		projectPath: null,
		sessionId: null,
		modifiedAt: daysAgo(1),
		sizeBytes: 1,
		...overrides,
	};
}

function oldTrigger(): HistoryFile {
	return file({ modifiedAt: daysAgo(400), sizeBytes: LARGE_HISTORY_BYTES + 1 });
}

function corpusSelecting(argument: (typeof AUTO_SINCE_WINDOWS)[number]): HistoryFile[] {
	const overloadAges: Record<(typeof AUTO_SINCE_WINDOWS)[number], number[]> = {
		"365d": [],
		"180d": [300],
		"90d": [300, 120],
		"30d": [300, 120, 60],
		"7d": [300, 120, 60, 20],
	};
	return [
		oldTrigger(),
		...overloadAges[argument].map((age) =>
			file({ modifiedAt: daysAgo(age), sizeBytes: TARGET_HISTORY_BYTES + 1 }),
		),
	];
}

describe("chooseAutomaticSince", () => {
	it("keeps corpora below both large-history triggers unbounded", () => {
		expect(
			chooseAutomaticSince([file({ sizeBytes: LARGE_HISTORY_BYTES }), file({ sizeBytes: 0 })], NOW),
		).toBeNull();
	});

	it("triggers when known transcript data exceeds 2 GiB", () => {
		expect(chooseAutomaticSince([oldTrigger()], NOW)?.argument).toBe("365d");
	});

	it("triggers when the corpus contains more than 20,000 small files", () => {
		const files = Array.from({ length: LARGE_HISTORY_FILES + 1 }, () =>
			file({ modifiedAt: daysAgo(400), sizeBytes: 1 }),
		);

		expect(chooseAutomaticSince(files, NOW)?.argument).toBe("365d");
	});

	it.each(AUTO_SINCE_WINDOWS)("selects the least restrictive qualifying %s window", (argument) => {
		expect(chooseAutomaticSince(corpusSelecting(argument), NOW)?.argument).toBe(argument);
	});

	it("uses 7d when even the tightest window exceeds the responsive target", () => {
		const files = [
			...corpusSelecting("7d"),
			file({ modifiedAt: daysAgo(3), sizeBytes: TARGET_HISTORY_BYTES + 1 }),
		];

		expect(chooseAutomaticSince(files, NOW)?.argument).toBe("7d");
	});

	it("counts missing and invalid modification times as recent in every window", () => {
		const uncertain = Array.from({ length: TARGET_HISTORY_FILES + 1 }, (_, index) =>
			file({ modifiedAt: index % 2 === 0 ? null : "not-a-date", sizeBytes: 0 }),
		);

		expect(chooseAutomaticSince([oldTrigger(), ...uncertain], NOW)?.argument).toBe("7d");
	});

	it("counts unknown-size files toward the file trigger but not the byte estimate", () => {
		const files = Array.from({ length: LARGE_HISTORY_FILES + 1 }, () =>
			file({ modifiedAt: daysAgo(400), sizeBytes: null }),
		);

		expect(chooseAutomaticSince(files, NOW)?.argument).toBe("365d");
	});

	it("ignores negative and non-finite sizes", () => {
		const files = [
			file({ sizeBytes: -1 }),
			file({ sizeBytes: Number.NaN }),
			file({ sizeBytes: Number.POSITIVE_INFINITY }),
		];

		expect(chooseAutomaticSince(files, NOW)).toBeNull();
	});

	it("uses strict large-history triggers and inclusive responsive targets", () => {
		const atLargeBoundaries = [
			file({ sizeBytes: LARGE_HISTORY_BYTES }),
			...Array.from({ length: LARGE_HISTORY_FILES - 1 }, () =>
				file({ modifiedAt: daysAgo(400), sizeBytes: 0 }),
			),
		];
		expect(chooseAutomaticSince(atLargeBoundaries, NOW)).toBeNull();

		const atResponsiveBoundaries = [
			oldTrigger(),
			file({ sizeBytes: TARGET_HISTORY_BYTES }),
			...Array.from({ length: TARGET_HISTORY_FILES - 1 }, () => file({ sizeBytes: 0 })),
		];
		expect(chooseAutomaticSince(atResponsiveBoundaries, NOW)?.argument).toBe("365d");
	});

	it("returns the same exact cutoff as parseWhen for an injected clock", () => {
		const decision = chooseAutomaticSince(corpusSelecting("90d"), NOW);

		expect(decision?.since).toEqual(parseWhen("90d", { flag: "--since", now: NOW }));
	});
});

describe("historyFileMatchesSince", () => {
	const since = new Date("2026-01-01T00:00:00.000Z");

	it.each([
		"0",
		"2026/08/01",
		"2026-02-30T00:00:00.000Z",
	])("fails open for invalid timestamp %s", (modifiedAt) => {
		expect(historyFileMatchesSince(file({ modifiedAt }), since)).toBe(true);
	});

	it("fails open for a non-string value from a JavaScript custom target", () => {
		const modifiedAt = Symbol("invalid") as unknown as string;

		expect(historyFileMatchesSince(file({ modifiedAt }), since)).toBe(true);
	});

	it("still excludes files with a valid ISO timestamp before the cutoff", () => {
		expect(historyFileMatchesSince(file({ modifiedAt: "2025-12-31T18:00:00-05:00" }), since)).toBe(
			false,
		);
	});
});
