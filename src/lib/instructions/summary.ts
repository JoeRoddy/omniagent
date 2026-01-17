import type { SyncSourceCounts } from "../sync-results.js";
import type { InstructionTargetName } from "./targets.js";

export type InstructionOutputCounts = {
	created: number;
	updated: number;
	removed: number;
	skipped: number;
	total: number;
};

export type InstructionSyncResult = {
	targetName: InstructionTargetName;
	status: "synced" | "skipped" | "failed" | "partial";
	message: string;
	counts: InstructionOutputCounts;
	warnings: string[];
	error?: string | null;
};

export type InstructionSyncSummary = {
	sourcePath: string;
	results: InstructionSyncResult[];
	warnings: string[];
	hadFailures: boolean;
	sourceCounts?: SyncSourceCounts;
};

export function emptyOutputCounts(): InstructionOutputCounts {
	return { created: 0, updated: 0, removed: 0, skipped: 0, total: 0 };
}

function formatTargetLabel(targetName: InstructionTargetName): string {
	return targetName.charAt(0).toUpperCase() + targetName.slice(1);
}

function formatCounts(counts: InstructionOutputCounts): string {
	return (
		`created ${counts.created}, updated ${counts.updated}, ` +
		`removed ${counts.removed}, skipped ${counts.skipped}`
	);
}

export function formatInstructionSummary(
	summary: InstructionSyncSummary,
	jsonOutput: boolean,
): string {
	if (jsonOutput) {
		return JSON.stringify(summary, null, 2);
	}

	const lines: string[] = [];
	for (const result of summary.results) {
		lines.push(result.message);
		for (const warning of result.warnings) {
			lines.push(`Warning: ${warning}`);
		}
	}
	for (const warning of summary.warnings) {
		if (!lines.includes(`Warning: ${warning}`)) {
			lines.push(`Warning: ${warning}`);
		}
	}
	if (summary.sourceCounts) {
		const { shared, local, excludedLocal } = summary.sourceCounts;
		const suffix = excludedLocal ? " (local excluded)" : "";
		lines.push(`Sources: shared ${shared}, local ${local}${suffix}`);
	}
	return lines.join("\n");
}

export function buildInstructionResultMessage(options: {
	targetName: InstructionTargetName;
	status: InstructionSyncResult["status"];
	counts: InstructionOutputCounts;
	error?: string | null;
}): string {
	const displayName = formatTargetLabel(options.targetName);
	const suffix = options.error ? ` (${options.error})` : "";
	if (
		options.status === "synced" &&
		options.counts.created === 0 &&
		options.counts.updated === 0 &&
		options.counts.removed === 0 &&
		options.counts.skipped === 0
	) {
		return `No changes for ${displayName} instructions.`;
	}

	const verb =
		options.status === "synced"
			? "Synced"
			: options.status === "partial"
				? "Partially synced"
				: options.status === "skipped"
					? "Skipped"
					: "Failed";
	return `${verb} ${displayName} instructions: ${formatCounts(options.counts)}${suffix}`;
}
