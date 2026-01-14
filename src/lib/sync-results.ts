import type { TargetName } from "./sync-targets.js";

export type SyncStatus = "synced" | "skipped" | "failed";

export type SyncResult = {
	targetName: TargetName;
	status: SyncStatus;
	message: string;
	error?: string | null;
};

export type SyncSummary = {
	sourcePath: string;
	results: SyncResult[];
	warnings: string[];
	hadFailures: boolean;
};

export function buildSummary(
	sourcePath: string,
	results: SyncResult[],
	warnings: string[] = [],
): SyncSummary {
	return {
		sourcePath,
		results,
		warnings,
		hadFailures: results.some((result) => result.status === "failed"),
	};
}

export function formatSummary(summary: SyncSummary, jsonOutput: boolean): string {
	if (jsonOutput) {
		return JSON.stringify(summary, null, 2);
	}

	const lines = summary.results.map((result) => result.message);
	for (const warning of summary.warnings) {
		lines.push(`Warning: ${warning}`);
	}
	return lines.join("\n");
}
