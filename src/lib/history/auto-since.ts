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

function knownSizeBytes(file: HistoryFile): number {
	return typeof file.sizeBytes === "number" &&
		Number.isFinite(file.sizeBytes) &&
		file.sizeBytes >= 0
		? file.sizeBytes
		: 0;
}

/** Missing or invalid mtimes fail open so uncertain metadata never hides a transcript. */
export function historyFileMatchesSince(file: HistoryFile, since: Date): boolean {
	const modifiedAt = file.modifiedAt === null ? Number.NaN : Date.parse(file.modifiedAt);
	return !Number.isFinite(modifiedAt) || modifiedAt >= since.getTime();
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
