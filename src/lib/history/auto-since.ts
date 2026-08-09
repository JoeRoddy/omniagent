import { parseWhen } from "./filters.js";
import type { HistoryFile } from "./types.js";

export const LARGE_HISTORY_BYTES = 2 * 1024 * 1024 * 1024;
export const LARGE_HISTORY_FILES = 20_000;
export const TARGET_HISTORY_BYTES = 512 * 1024 * 1024;
export const TARGET_HISTORY_FILES = 5_000;

export const AUTO_SINCE_WINDOWS = ["365d", "180d", "90d", "30d", "7d"] as const;

export type AutomaticSinceDecision = {
	argument: (typeof AUTO_SINCE_WINDOWS)[number];
	since: Date;
};

const ISO_TIMESTAMP =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function knownSizeBytes(file: HistoryFile): number {
	return typeof file.sizeBytes === "number" &&
		Number.isFinite(file.sizeBytes) &&
		file.sizeBytes >= 0
		? file.sizeBytes
		: 0;
}

function parseKnownModifiedAt(value: unknown): number | null {
	if (typeof value !== "string") {
		return null;
	}
	const match = ISO_TIMESTAMP.exec(value);
	if (!match) {
		return null;
	}

	const [year, month, day, hour, minute, second] = match.slice(1, 7).map((part) => Number(part));
	const calendar = new Date(0);
	calendar.setUTCFullYear(year as number, (month as number) - 1, day);
	calendar.setUTCHours(hour as number, minute, second, 0);
	if (
		calendar.getUTCFullYear() !== year ||
		calendar.getUTCMonth() !== (month as number) - 1 ||
		calendar.getUTCDate() !== day ||
		calendar.getUTCHours() !== hour ||
		calendar.getUTCMinutes() !== minute ||
		calendar.getUTCSeconds() !== second
	) {
		return null;
	}

	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : null;
}

/** Missing or invalid mtimes fail open so uncertain metadata never hides a transcript. */
export function historyFileMatchesSince(file: HistoryFile, since: Date): boolean {
	const modifiedAt = parseKnownModifiedAt(file.modifiedAt);
	return modifiedAt === null || modifiedAt >= since.getTime();
}

/** Selects a responsive search window using only metadata gathered during normal discovery. */
export function chooseAutomaticSince(
	files: readonly HistoryFile[],
	now: Date = new Date(),
): AutomaticSinceDecision | null {
	const knownBytes = files.reduce((total, file) => total + knownSizeBytes(file), 0);
	if (knownBytes <= LARGE_HISTORY_BYTES && files.length <= LARGE_HISTORY_FILES) {
		return null;
	}

	let fallback: AutomaticSinceDecision | null = null;
	for (const argument of AUTO_SINCE_WINDOWS) {
		const decision = {
			argument,
			since: parseWhen(argument, { flag: "--since", now }),
		} satisfies AutomaticSinceDecision;
		fallback = decision;

		let recentBytes = 0;
		let recentFiles = 0;
		for (const file of files) {
			if (!historyFileMatchesSince(file, decision.since)) {
				continue;
			}
			recentFiles += 1;
			recentBytes += knownSizeBytes(file);
			if (recentBytes > TARGET_HISTORY_BYTES || recentFiles > TARGET_HISTORY_FILES) {
				break;
			}
		}

		if (recentBytes <= TARGET_HISTORY_BYTES && recentFiles <= TARGET_HISTORY_FILES) {
			return decision;
		}
	}

	return fallback;
}
