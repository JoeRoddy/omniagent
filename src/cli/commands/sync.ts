import { stat } from "node:fs/promises";
import path from "node:path";
import type { CommandModule } from "yargs";
import { findRepoRoot } from "../../lib/repo-root.js";
import { copyDirectory } from "../../lib/sync-copy.js";
import { buildSummary, formatSummary, type SyncResult } from "../../lib/sync-results.js";
import { isTargetName, TARGETS, type TargetName } from "../../lib/sync-targets.js";

type SyncArgs = {
	skip?: string | string[];
	only?: string | string[];
	json: boolean;
};

const SUPPORTED_TARGETS = TARGETS.map((target) => target.name).join(", ");

function parseList(value?: string | string[]): string[] {
	if (!value) {
		return [];
	}

	const rawValues = Array.isArray(value) ? value : [value];
	return rawValues
		.flatMap((entry) => entry.split(","))
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function formatDisplayPath(repoRoot: string, absolutePath: string): string {
	const relative = path.relative(repoRoot, absolutePath);
	const isWithinRepo = relative && !relative.startsWith("..") && !path.isAbsolute(relative);
	return isWithinRepo ? relative : absolutePath;
}

async function assertSourceDirectory(sourcePath: string): Promise<boolean> {
	try {
		const stats = await stat(sourcePath);
		return stats.isDirectory();
	} catch {
		return false;
	}
}

function formatResultMessage(
	status: "synced" | "skipped" | "failed",
	sourceDisplay: string,
	destDisplay: string,
	errorMessage?: string,
): string {
	const verb = status === "synced" ? "Synced" : status === "skipped" ? "Skipped" : "Failed";
	const suffix = errorMessage ? `: ${errorMessage}` : "";
	return `${verb} ${sourceDisplay} -> ${destDisplay}${suffix}`;
}

export const syncCommand: CommandModule<Record<string, never>, SyncArgs> = {
	command: "sync",
	describe: "Sync canonical agent config to supported targets",
	builder: (yargs) =>
		yargs
			.usage("agentctl sync [options]")
			.option("skip", {
				type: "string",
				describe: `Comma-separated targets to skip (${SUPPORTED_TARGETS})`,
			})
			.option("only", {
				type: "string",
				describe: `Comma-separated targets to sync (${SUPPORTED_TARGETS})`,
			})
			.option("json", {
				type: "boolean",
				default: false,
				describe: "Output JSON summary",
			})
			.epilog(`Supported targets: ${SUPPORTED_TARGETS}`)
			.example("agentctl sync", "Sync all targets")
			.example("agentctl sync --skip codex", "Skip a target")
			.example("agentctl sync --only claude", "Sync only one target"),
	handler: async (argv) => {
		const skipList = parseList(argv.skip);
		const onlyList = parseList(argv.only);

		if (skipList.length > 0 && onlyList.length > 0) {
			console.error("Error: Use either --skip or --only, not both.");
			process.exit(1);
			return;
		}

		const unknownTargets = [...skipList, ...onlyList].filter((name) => !isTargetName(name));
		if (unknownTargets.length > 0) {
			const unknownList = unknownTargets.join(", ");
			console.error(
				`Error: Unknown target name(s): ${unknownList}. Supported targets: ${SUPPORTED_TARGETS}.`,
			);
			process.exit(1);
			return;
		}

		const skipSet = new Set<TargetName>(skipList as TargetName[]);
		const onlySet = new Set<TargetName>(onlyList as TargetName[]);

		const selectedTargets = TARGETS.filter((target) => {
			if (onlySet.size > 0) {
				return onlySet.has(target.name);
			}
			if (skipSet.size > 0) {
				return !skipSet.has(target.name);
			}
			return true;
		});

		if (selectedTargets.length === 0) {
			console.error("Error: No targets selected after applying filters.");
			process.exit(1);
			return;
		}

		const startDir = process.cwd();
		const repoRoot = await findRepoRoot(startDir);

		if (!repoRoot) {
			console.error(
				`Error: Repository root not found starting from ${startDir}. Looked for .git or package.json.`,
			);
			process.exit(1);
			return;
		}

		const sourcePath = path.join(repoRoot, "agents", "skills");
		if (!(await assertSourceDirectory(sourcePath))) {
			console.error(`Error: Canonical config source not found at ${sourcePath}.`);
			process.exit(1);
			return;
		}

		const results: SyncResult[] = [];
		const sourceDisplay = formatDisplayPath(repoRoot, sourcePath);

		for (const target of TARGETS) {
			const destPath = path.join(repoRoot, target.relativePath);
			const destDisplay = formatDisplayPath(repoRoot, destPath);
			const isSelected = selectedTargets.some((item) => item.name === target.name);

			if (!isSelected) {
				results.push({
					targetName: target.name,
					status: "skipped",
					message: formatResultMessage("skipped", sourceDisplay, destDisplay),
				});
				continue;
			}

			try {
				await copyDirectory(sourcePath, destPath);
				results.push({
					targetName: target.name,
					status: "synced",
					message: formatResultMessage("synced", sourceDisplay, destDisplay),
				});
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				results.push({
					targetName: target.name,
					status: "failed",
					message: formatResultMessage("failed", sourceDisplay, destDisplay, errorMessage),
					error: errorMessage,
				});
			}
		}

		const summary = buildSummary(sourcePath, results);
		const output = formatSummary(summary, argv.json);
		if (output.length > 0) {
			console.log(output);
		}

		if (summary.hadFailures) {
			process.exitCode = 1;
		}
	},
};
