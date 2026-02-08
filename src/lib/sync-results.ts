import type { TargetName } from "./sync-targets.js";

export type SyncStatus = "synced" | "skipped" | "failed";
export type ScriptExecutionStatus = "pending" | "running" | "succeeded" | "failed";
export type ScriptResultKind = "string" | "json" | "coerced" | "empty";
export type RunWarningCode = "still_running" | "sync_warning";

export type SyncSourceCounts = {
	shared: number;
	local: number;
	excludedLocal: boolean;
};

export type ScriptExecution = {
	blockId: string;
	templatePath: string;
	status: ScriptExecutionStatus;
	resultKind?: ScriptResultKind | null;
	renderedPreview?: string | null;
	errorMessage?: string | null;
	durationMs?: number | null;
	reusedAcrossTargets: boolean;
};

export type RunWarning = {
	code: RunWarningCode;
	message: string;
	templatePath?: string | null;
	blockId?: string | null;
};

export type SyncRunMetadata = {
	runId: string;
	status: "running" | "completed" | "failed";
	failedTemplatePath: string | null;
	failedBlockId: string | null;
	partialOutputsWritten: boolean;
	scriptExecutions: ScriptExecution[];
	warnings: RunWarning[];
};

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
	sourceCounts?: SyncSourceCounts;
};

export function buildSummary(
	sourcePath: string,
	results: SyncResult[],
	warnings: string[] = [],
	sourceCounts?: SyncSourceCounts,
): SyncSummary {
	return {
		sourcePath,
		results,
		warnings,
		hadFailures: results.some((result) => result.status === "failed"),
		sourceCounts,
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
	if (summary.sourceCounts) {
		const { shared, local, excludedLocal } = summary.sourceCounts;
		const suffix = excludedLocal ? " (local excluded)" : "";
		lines.push(`Sources: shared ${shared}, local ${local}${suffix}`);
	}
	return lines.join("\n");
}
