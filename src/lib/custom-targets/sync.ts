import { createConvertContext } from "./context.js";
import { runSyncHook } from "./hooks.js";
import { OutputWriter } from "./output-writer.js";
import { loadCommandItems, writeCommandOutputs } from "./commands.js";
import { loadSkillItems, writeSkillOutputs } from "./skills.js";
import { loadSubagentItems, writeSubagentOutputs } from "./subagents.js";
import { loadInstructionItems, writeInstructionOutputs } from "./instructions.js";
import type { ConvertContext, OutputWriteCounts, ResolvedTargetDefinition } from "./types.js";

export type CustomTargetSyncResult = {
	targetId: string;
	displayName: string;
	status: "synced" | "partial" | "failed" | "skipped";
	counts: OutputWriteCounts;
	warnings: string[];
	errors: string[];
};

export type CustomTargetSyncSummary = {
	results: CustomTargetSyncResult[];
	warnings: string[];
	hadFailures: boolean;
};

function formatCounts(counts: OutputWriteCounts): string {
	return `created ${counts.created}, updated ${counts.updated}, skipped ${counts.skipped}, failed ${counts.failed}`;
}

export function formatCustomTargetSummary(
	summary: CustomTargetSyncSummary,
	jsonOutput: boolean,
): string {
	if (jsonOutput) {
		return JSON.stringify(summary, null, 2);
	}
	const lines: string[] = [];
	for (const result of summary.results) {
		const total =
			result.counts.created +
			result.counts.updated +
			result.counts.skipped +
			result.counts.failed;
		if (total === 0) {
			lines.push(`No outputs for ${result.displayName}.`);
		} else {
			const prefix =
				result.status === "synced"
					? "Synced"
					: result.status === "partial"
						? "Partially synced"
						: result.status === "failed"
							? "Failed"
							: "Skipped";
			lines.push(`${prefix} ${result.displayName}: ${formatCounts(result.counts)}`);
		}
		for (const warning of result.warnings) {
			lines.push(`Warning: ${warning}`);
		}
		for (const error of result.errors) {
			lines.push(`Error: ${error}`);
		}
	}
	for (const warning of summary.warnings) {
		lines.push(`Warning: ${warning}`);
	}
	return lines.join("\n");
}

function resolveResultStatus(result: {
	counts: OutputWriteCounts;
	warnings: string[];
	errors: string[];
}): CustomTargetSyncResult["status"] {
	const total =
		result.counts.created +
		result.counts.updated +
		result.counts.skipped +
		result.counts.failed;
	if (total === 0 && result.errors.length === 0) {
		return "skipped";
	}
	if (result.errors.length > 0 || result.counts.failed > 0) {
		return total > result.counts.failed ? "partial" : "failed";
	}
	return "synced";
}

async function runHooks(options: {
	target: ResolvedTargetDefinition;
	context: ConvertContext;
	outputWriter: OutputWriter;
	phase: "before" | "after";
}): Promise<boolean> {
	const hook = options.phase === "before" ? options.target.hooks.beforeSync : options.target.hooks.afterSync;
	return runSyncHook({
		hook,
		context: options.context,
		onError: (message) => options.outputWriter.recordError(options.target.id, message),
		label: options.phase === "before" ? "beforeSync" : "afterSync",
	});
}

export async function syncCustomTargets(options: {
	repoRoot: string;
	agentsDir?: string | null;
	targets: ResolvedTargetDefinition[];
	validAgents: string[];
	flags?: Record<string, unknown>;
	excludeLocal?: {
		skills?: boolean;
		commands?: boolean;
		subagents?: boolean;
		instructions?: boolean;
	};
}): Promise<CustomTargetSyncSummary> {
	const outputWriter = new OutputWriter();
	const globalWarnings: string[] = [];
	const includeLocalSkills = !(options.excludeLocal?.skills ?? false);
	const includeLocalCommands = !(options.excludeLocal?.commands ?? false);
	const includeLocalSubagents = !(options.excludeLocal?.subagents ?? false);
	const includeLocalInstructions = !(options.excludeLocal?.instructions ?? false);

	const [skillItems, commandItems, subagentItems, instructionItemsResult] = await Promise.all([
		loadSkillItems({
			repoRoot: options.repoRoot,
			agentsDir: options.agentsDir,
			includeLocal: includeLocalSkills,
		}),
		loadCommandItems({
			repoRoot: options.repoRoot,
			agentsDir: options.agentsDir,
			includeLocal: includeLocalCommands,
		}),
		loadSubagentItems({
			repoRoot: options.repoRoot,
			agentsDir: options.agentsDir,
			includeLocal: includeLocalSubagents,
		}),
		loadInstructionItems({
			repoRoot: options.repoRoot,
			agentsDir: options.agentsDir,
			includeLocal: includeLocalInstructions,
		}),
	]);

	for (const warning of instructionItemsResult.warnings) {
		globalWarnings.push(warning);
	}

	for (const target of options.targets) {
		const context = createConvertContext({
			repoRoot: options.repoRoot,
			target,
			flags: options.flags,
		});
		const beforeOk = await runHooks({
			target,
			context,
			outputWriter,
			phase: "before",
		});
		if (!beforeOk) {
			continue;
		}

		await writeSkillOutputs({
			items: skillItems,
			output: target.outputs.skills,
			context,
			outputWriter,
			target,
			validAgents: options.validAgents,
		});
		await writeCommandOutputs({
			items: commandItems,
			output: target.outputs.commands,
			skillOutput: target.outputs.skills,
			context,
			outputWriter,
			target,
			validAgents: options.validAgents,
		});
		await writeSubagentOutputs({
			items: subagentItems,
			output: target.outputs.subagents,
			skillOutput: target.outputs.skills,
			context,
			outputWriter,
			target,
			validAgents: options.validAgents,
		});
		await writeInstructionOutputs({
			items: instructionItemsResult.items,
			output: target.outputs.instructions,
			context,
			outputWriter,
			target,
			validAgents: options.validAgents,
		});

		await runHooks({
			target,
			context,
			outputWriter,
			phase: "after",
		});
	}

	const writeSummary = await outputWriter.writeAll();
	const resultById = new Map(writeSummary.results.map((result) => [result.targetId, result]));

	const results: CustomTargetSyncResult[] = options.targets.map((target) => {
		const entry =
			resultById.get(target.id) ??
			({
				counts: { created: 0, updated: 0, skipped: 0, failed: 0 },
				warnings: [],
				errors: [],
			} as const);
		return {
			targetId: target.id,
			displayName: target.displayName,
			status: resolveResultStatus(entry),
			counts: entry.counts,
			warnings: entry.warnings,
			errors: entry.errors,
		};
	});

	const hadFailures = results.some((result) => result.status === "failed" || result.status === "partial");

	return {
		results,
		warnings: [...globalWarnings, ...writeSummary.warnings],
		hadFailures,
	};
}
