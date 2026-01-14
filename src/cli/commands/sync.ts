import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { TextDecoder } from "node:util";
import type { CommandModule } from "yargs";
import { validateAgentTemplating } from "../../lib/agent-templating.js";
import { findRepoRoot } from "../../lib/repo-root.js";
import { syncSkills as syncSkillTargets } from "../../lib/skills/sync.js";
import {
	applySlashCommandSync,
	type CodexConversionScope,
	type CodexOption,
	type SyncSummary as CommandSyncSummary,
	type ConflictResolution,
	formatSyncSummary as formatCommandSummary,
	formatPlanSummary,
	planSlashCommandSync,
	type SyncPlanDetails,
	type UnsupportedFallback,
} from "../../lib/slash-commands/sync.js";
import {
	type TargetName as CommandTargetName,
	getDefaultScope,
	getTargetProfile,
	type Scope,
	SLASH_COMMAND_TARGETS,
} from "../../lib/slash-commands/targets.js";
import {
	applySubagentSync,
	formatSubagentSummary,
	planSubagentSync,
	type SubagentSyncPlanDetails,
	type SubagentSyncSummary,
} from "../../lib/subagents/sync.js";
import {
	getSubagentProfile,
	SUBAGENT_TARGETS,
	type SubagentTargetName,
} from "../../lib/subagents/targets.js";
import { SUPPORTED_AGENT_NAMES } from "../../lib/supported-targets.js";
import {
	buildSummary,
	formatSummary,
	type SyncResult,
	type SyncSummary,
} from "../../lib/sync-results.js";
import {
	InvalidFrontmatterTargetsError,
	type TargetName as SkillTargetName,
	TARGETS,
} from "../../lib/sync-targets.js";

type SyncArgs = {
	skip?: string | string[];
	only?: string | string[];
	json: boolean;
	yes: boolean;
	removeMissing: boolean;
	conflicts?: string;
};

type SkillTarget = (typeof TARGETS)[number];

const ALL_TARGETS = [...SUPPORTED_AGENT_NAMES];
const SUPPORTED_TARGETS = ALL_TARGETS.join(", ");

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

type CatalogStatus =
	| { available: true }
	| {
			available: false;
			reason: string;
	  };

function parseList(value?: string | string[]): string[] {
	if (!value) {
		return [];
	}

	const rawValues = Array.isArray(value) ? value : [value];
	return rawValues
		.flatMap((entry) => entry.split(","))
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
}

function decodeUtf8(buffer: Buffer): string | null {
	try {
		return utf8Decoder.decode(buffer);
	} catch {
		return null;
	}
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

async function hasMarkdownFiles(root: string): Promise<boolean> {
	const entries = await readdir(root, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			if (await hasMarkdownFiles(entryPath)) {
				return true;
			}
			continue;
		}
		if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
			return true;
		}
	}
	return false;
}

async function listMarkdownFiles(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const entryPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listMarkdownFiles(entryPath)));
			continue;
		}
		if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
			files.push(entryPath);
		}
	}
	return files;
}

async function listFiles(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const entryPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listFiles(entryPath)));
			continue;
		}
		if (entry.isFile()) {
			files.push(entryPath);
		}
	}
	return files;
}

async function validateTemplatingSources(options: {
	repoRoot: string;
	validAgents: string[];
	commandsAvailable: boolean;
	skillsAvailable: boolean;
}): Promise<void> {
	const directories: string[] = [];
	if (options.commandsAvailable) {
		directories.push(path.join(options.repoRoot, "agents", "commands"));
	}
	if (options.skillsAvailable) {
		directories.push(path.join(options.repoRoot, "agents", "skills"));
	}
	const subagentsPath = path.join(options.repoRoot, "agents", "agents");
	if (await assertSourceDirectory(subagentsPath)) {
		directories.push(subagentsPath);
	}

	for (const directory of directories) {
		const files =
			path.basename(directory) === "skills"
				? await listFiles(directory)
				: await listMarkdownFiles(directory);
		for (const filePath of files) {
			const buffer = await readFile(filePath);
			const contents = decodeUtf8(buffer);
			if (contents === null) {
				continue;
			}
			validateAgentTemplating({
				content: contents,
				validAgents: options.validAgents,
				sourcePath: filePath,
			});
		}
	}
}

async function getCommandCatalogStatus(commandsPath: string): Promise<CatalogStatus> {
	try {
		const stats = await stat(commandsPath);
		if (!stats.isDirectory()) {
			return {
				available: false,
				reason: `Command catalog path is not a directory: ${commandsPath}.`,
			};
		}
	} catch {
		return {
			available: false,
			reason: `Command catalog directory not found at ${commandsPath}.`,
		};
	}

	if (!(await hasMarkdownFiles(commandsPath))) {
		return {
			available: false,
			reason: `No slash command definitions found in ${commandsPath}.`,
		};
	}

	return { available: true };
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

function logWithChannel(message: string, jsonOutput: boolean) {
	if (jsonOutput) {
		console.error(message);
		return;
	}
	console.log(message);
}

function rethrowIfInvalidTargets(error: unknown): void {
	if (error instanceof InvalidFrontmatterTargetsError) {
		throw error;
	}
}

function logNonInteractiveNotices(options: {
	targets: CommandTargetName[];
	jsonOutput: boolean;
	scopeByTarget: Partial<Record<CommandTargetName, Scope>>;
	unsupportedFallback?: UnsupportedFallback;
	codexOption?: CodexOption;
	codexConversionScope?: CodexConversionScope;
}) {
	const unsupportedFallback = options.unsupportedFallback ?? "skip";
	const codexOption = options.codexOption ?? "prompts";
	const codexConversionScope = options.codexConversionScope ?? "global";

	for (const targetName of options.targets) {
		const profile = getTargetProfile(targetName);
		if (!profile.supportsSlashCommands) {
			const fallbackLabel =
				unsupportedFallback === "convert_to_skills" ? "convert to skills" : "skip";
			logWithChannel(
				`${profile.displayName} does not support slash commands; will ${fallbackLabel}.`,
				options.jsonOutput,
			);
			continue;
		}

		if (targetName === "codex") {
			logWithChannel(
				"Codex only supports global prompts (no project-level custom commands).",
				options.jsonOutput,
			);
			if (codexOption === "convert_to_skills") {
				logWithChannel(
					`Converting Codex commands to ${codexConversionScope} skills.`,
					options.jsonOutput,
				);
			} else if (codexOption === "skip") {
				logWithChannel("Skipping Codex slash commands.", options.jsonOutput);
			} else {
				logWithChannel("Using Codex global prompts.", options.jsonOutput);
			}
			continue;
		}

		if (profile.supportedScopes.length > 1) {
			const scope = options.scopeByTarget[targetName] ?? getDefaultScope(profile);
			logWithChannel(
				`Using ${scope} scope for ${profile.displayName} commands.`,
				options.jsonOutput,
			);
		}
	}
}

async function withPrompter<T>(fn: (ask: (prompt: string) => Promise<string>) => Promise<T>) {
	const rl = createInterface({ input: process.stdin, output: process.stderr });
	try {
		return await fn((prompt) => rl.question(prompt));
	} finally {
		rl.close();
	}
}

async function promptChoice(
	ask: (prompt: string) => Promise<string>,
	question: string,
	choices: string[],
	defaultValue: string,
): Promise<string> {
	const normalizedChoices = new Map(choices.map((choice) => [choice.toLowerCase(), choice]));
	while (true) {
		const answer = (await ask(question)).trim();
		if (!answer) {
			return defaultValue;
		}
		const normalized = answer.toLowerCase();
		const match = normalizedChoices.get(normalized);
		if (match) {
			return match;
		}
		console.error(`Please enter one of: ${choices.join(", ")}.`);
	}
}

async function promptConfirm(
	ask: (prompt: string) => Promise<string>,
	question: string,
	defaultValue: boolean,
): Promise<boolean> {
	const choices = ["yes", "no"];
	const defaultLabel = defaultValue ? "yes" : "no";
	const answer = await promptChoice(
		ask,
		`${question} (${choices.join("/")}) [${defaultLabel}]: `,
		choices,
		defaultLabel,
	);
	return answer.toLowerCase() === "yes";
}

function emptyCommandCounts(): CommandSyncSummary["results"][number]["counts"] {
	return { created: 0, updated: 0, removed: 0, converted: 0, skipped: 0 };
}

function buildCommandSummary(
	sourcePath: string,
	targets: CommandTargetName[],
	status: "skipped" | "failed",
	message: string,
): CommandSyncSummary {
	return {
		sourcePath,
		results: targets.map((targetName) => {
			const displayName = getTargetProfile(targetName).displayName;
			const verb = status === "failed" ? "Failed" : "Skipped";
			return {
				targetName,
				status,
				message: `${verb} ${displayName}: ${message}`,
				error: message,
				counts: emptyCommandCounts(),
			};
		}),
		warnings: [],
		hadFailures: status === "failed",
	};
}

function buildSkillsSummary(
	repoRoot: string,
	sourcePath: string,
	targets: SkillTarget[],
	status: "skipped" | "failed",
	reason: string,
): SyncSummary {
	const sourceDisplay = formatDisplayPath(repoRoot, sourcePath);
	const results: SyncResult[] = targets.map((target) => {
		const destPath = path.join(repoRoot, target.relativePath);
		const destDisplay = formatDisplayPath(repoRoot, destPath);
		return {
			targetName: target.name,
			status,
			message: formatResultMessage(status, sourceDisplay, destDisplay, reason),
			error: reason,
		};
	});
	return buildSummary(sourcePath, results);
}

function emptySubagentCounts(): SubagentSyncSummary["results"][number]["counts"] {
	return { created: 0, updated: 0, removed: 0, converted: 0, skipped: 0 };
}

function formatSubagentFailureMessage(
	displayName: string,
	outputKind: "subagent" | "skill",
	status: "skipped" | "failed",
	message: string,
): string {
	const verb = status === "failed" ? "Failed" : "Skipped";
	const modeLabel = outputKind === "skill" ? " [skills]" : "";
	return `${verb} ${displayName} subagents${modeLabel}: ${message}`;
}

function buildSubagentSummary(
	sourcePath: string,
	targets: SubagentTargetName[],
	status: "skipped" | "failed",
	message: string,
): SubagentSyncSummary {
	return {
		sourcePath,
		results: targets.map((targetName) => {
			const profile = getSubagentProfile(targetName);
			const outputKind = profile.supportsSubagents ? "subagent" : "skill";
			return {
				targetName,
				status,
				message: formatSubagentFailureMessage(profile.displayName, outputKind, status, message),
				error: message,
				counts: emptySubagentCounts(),
				warnings: [],
			};
		}),
		warnings: [],
		hadFailures: status === "failed",
	};
}

type SubagentSyncOptions = {
	repoRoot: string;
	targets: SubagentTargetName[];
	overrideOnly?: SubagentTargetName[];
	overrideSkip?: SubagentTargetName[];
	removeMissing: boolean;
	validAgents: string[];
};

async function syncSubagents(options: SubagentSyncOptions): Promise<SubagentSyncSummary> {
	const sourcePath = path.join(options.repoRoot, "agents", "agents");
	if (options.targets.length === 0) {
		return { sourcePath, results: [], warnings: [], hadFailures: false };
	}

	let planDetails: SubagentSyncPlanDetails;
	try {
		planDetails = await planSubagentSync({
			repoRoot: options.repoRoot,
			targets: options.targets,
			overrideOnly: options.overrideOnly,
			overrideSkip: options.overrideSkip,
			removeMissing: options.removeMissing,
			validAgents: options.validAgents,
		});
	} catch (error) {
		rethrowIfInvalidTargets(error);
		const message = error instanceof Error ? error.message : String(error);
		return buildSubagentSummary(sourcePath, options.targets, "failed", message);
	}

	try {
		return await applySubagentSync(planDetails);
	} catch (error) {
		rethrowIfInvalidTargets(error);
		const message = error instanceof Error ? error.message : String(error);
		return buildSubagentSummary(sourcePath, options.targets, "failed", message);
	}
}

type CommandSyncOptions = {
	repoRoot: string;
	targets: CommandTargetName[];
	overrideOnly?: CommandTargetName[];
	overrideSkip?: CommandTargetName[];
	jsonOutput: boolean;
	yes: boolean;
	removeMissing: boolean;
	conflicts?: string;
	catalogStatus: CatalogStatus;
	validAgents: string[];
};

async function syncSlashCommands(options: CommandSyncOptions): Promise<CommandSyncSummary> {
	const sourcePath = path.join(options.repoRoot, "agents", "commands");
	if (options.targets.length === 0) {
		return { sourcePath, results: [], hadFailures: false };
	}
	if (!options.catalogStatus.available) {
		return buildCommandSummary(
			sourcePath,
			options.targets,
			"skipped",
			options.catalogStatus.reason,
		);
	}

	const nonInteractive = options.yes || !process.stdin.isTTY;
	const scopeByTarget: Partial<Record<CommandTargetName, Scope>> = {};
	let unsupportedFallback: UnsupportedFallback | undefined;
	let codexOption: CodexOption | undefined;
	let codexConversionScope: CodexConversionScope | undefined;

	for (const targetName of options.targets) {
		const profile = getTargetProfile(targetName);
		if (profile.supportedScopes.includes("project")) {
			scopeByTarget[targetName] = "project";
		}
		if (targetName === "copilot") {
			unsupportedFallback = "convert_to_skills";
		}
	}

	if (!nonInteractive) {
		if (options.targets.includes("codex")) {
			await withPrompter(async (ask) => {
				logWithChannel(
					"Codex only supports global prompts (no project-level custom commands).",
					options.jsonOutput,
				);
				const choice = await promptChoice(
					ask,
					"Choose Codex option (global/convert) [global]: ",
					["global", "convert"],
					"global",
				);
				codexOption = choice === "convert" ? "convert_to_skills" : "prompts";
			});
		}
	}

	if (nonInteractive) {
		logNonInteractiveNotices({
			targets: options.targets,
			jsonOutput: options.jsonOutput,
			scopeByTarget,
			unsupportedFallback,
			codexOption,
			codexConversionScope,
		});
	}

	const conflictResolution = options.conflicts as ConflictResolution | undefined;
	const planRequestBase = {
		repoRoot: options.repoRoot,
		targets: options.targets,
		overrideOnly: options.overrideOnly,
		overrideSkip: options.overrideSkip,
		scopeByTarget,
		removeMissing: options.removeMissing,
		unsupportedFallback: unsupportedFallback ?? (nonInteractive ? "skip" : undefined),
		codexOption: codexOption ?? (nonInteractive ? "prompts" : undefined),
		codexConversionScope: codexConversionScope ?? (nonInteractive ? "global" : undefined),
		conflictResolution: conflictResolution ?? "skip",
		useDefaults: options.yes,
		nonInteractive,
		validAgents: options.validAgents,
	};

	let planDetails: SyncPlanDetails;
	try {
		planDetails = await planSlashCommandSync(planRequestBase);
	} catch (error) {
		rethrowIfInvalidTargets(error);
		const message = error instanceof Error ? error.message : String(error);
		return buildCommandSummary(sourcePath, options.targets, "failed", message);
	}

	if (!nonInteractive && !conflictResolution && planDetails.conflicts > 0) {
		await withPrompter(async (ask) => {
			const resolution = await promptChoice(
				ask,
				"Conflicts detected. Choose resolution (overwrite/rename/skip) [skip]: ",
				["overwrite", "rename", "skip"],
				"skip",
			);
			planDetails = await planSlashCommandSync({
				...planRequestBase,
				conflictResolution: resolution as ConflictResolution,
			});
		});
	}

	logWithChannel(
		formatPlanSummary(planDetails.plan, planDetails.targetSummaries),
		options.jsonOutput,
	);

	const hasPlannedChanges = planDetails.targetPlans.some((plan) => {
		const counts = plan.summary;
		return counts.create + counts.update + counts.remove + counts.convert > 0;
	});

	if (!nonInteractive && !options.yes && hasPlannedChanges) {
		const shouldApply = await withPrompter((ask) =>
			promptConfirm(ask, "Apply these changes?", false),
		);
		if (!shouldApply) {
			logWithChannel("Aborted.", options.jsonOutput);
			return buildCommandSummary(sourcePath, options.targets, "skipped", "Aborted by user.");
		}
	}

	try {
		return await applySlashCommandSync(planDetails);
	} catch (error) {
		rethrowIfInvalidTargets(error);
		const message = error instanceof Error ? error.message : String(error);
		return buildCommandSummary(sourcePath, options.targets, "failed", message);
	}
}

export const syncCommand: CommandModule<Record<string, never>, SyncArgs> = {
	command: "sync",
	describe: "Sync canonical skills, subagents, and slash commands to supported targets",
	builder: (yargs) =>
		yargs
			.usage("omniagent sync [options]")
			.option("skip", {
				type: "string",
				describe: `Comma-separated targets to skip (${SUPPORTED_TARGETS})`,
			})
			.option("only", {
				type: "string",
				describe: `Comma-separated targets to sync (${SUPPORTED_TARGETS})`,
			})
			.option("yes", {
				type: "boolean",
				default: false,
				describe: "Accept defaults and skip confirmation prompts",
			})
			.option("remove-missing", {
				type: "boolean",
				default: true,
				describe: "Remove previously synced commands/subagents missing from the catalog",
			})
			.option("conflicts", {
				type: "string",
				choices: ["overwrite", "rename", "skip"],
				describe: "Conflict resolution strategy for slash commands",
			})
			.option("json", {
				type: "boolean",
				default: false,
				describe: "Output JSON summary",
			})
			.epilog(`Supported targets: ${SUPPORTED_TARGETS}`)
			.example("omniagent sync", "Sync all targets")
			.example("omniagent sync --skip codex", "Skip a target")
			.example("omniagent sync --only claude", "Sync only one target")
			.example("omniagent sync --yes", "Accept defaults and apply changes")
			.example("omniagent sync --json", "Output a JSON summary"),
	handler: async (argv) => {
		try {
			const skipList = parseList(argv.skip);
			const onlyList = parseList(argv.only);

			const supportedTargetSet = new Set(ALL_TARGETS);
			const unknownTargets = [...skipList, ...onlyList].filter(
				(name) => !supportedTargetSet.has(name),
			);
			if (unknownTargets.length > 0) {
				const unknownList = unknownTargets.join(", ");
				console.error(
					`Error: Unknown target name(s): ${unknownList}. Supported targets: ${SUPPORTED_TARGETS}.`,
				);
				process.exit(1);
				return;
			}

			const skipSet = new Set(skipList);
			const onlySet = new Set(onlyList);
			const selectedTargets = ALL_TARGETS.filter((name) => {
				if (onlySet.size > 0 && !onlySet.has(name)) {
					return false;
				}
				if (skipSet.size > 0 && skipSet.has(name)) {
					return false;
				}
				return true;
			});
			const overrideOnly = onlyList.length > 0 ? onlyList : undefined;
			const overrideSkip = skipList.length > 0 ? skipList : undefined;
			const validAgents = [...SUPPORTED_AGENT_NAMES];

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

			const selectedSkillTargets = TARGETS.filter((target) =>
				selectedTargets.includes(target.name),
			);
			const selectedCommandTargets = SLASH_COMMAND_TARGETS.filter((target) =>
				selectedTargets.includes(target.name),
			).map((target) => target.name as CommandTargetName);

			const selectedSubagentTargets = SUBAGENT_TARGETS.filter((target) =>
				selectedTargets.includes(target.name),
			).map((target) => target.name as SubagentTargetName);

			const skillsSourcePath = path.join(repoRoot, "agents", "skills");
			const commandsSourcePath = path.join(repoRoot, "agents", "commands");

			const skillsAvailable =
				selectedSkillTargets.length > 0 ? await assertSourceDirectory(skillsSourcePath) : false;
			const commandsStatus =
				selectedCommandTargets.length > 0
					? await getCommandCatalogStatus(commandsSourcePath)
					: ({ available: true } as CatalogStatus);

			const hasSkillsToSync = selectedSkillTargets.length > 0 && skillsAvailable;
			const hasCommandsToSync = selectedCommandTargets.length > 0 && commandsStatus.available;
			const hasSubagentsToSync = selectedSubagentTargets.length > 0;

			if (!hasSkillsToSync && !hasCommandsToSync && !hasSubagentsToSync) {
				const missingMessages: string[] = [];
				if (selectedSkillTargets.length > 0 && !skillsAvailable) {
					missingMessages.push(`Canonical config source not found at ${skillsSourcePath}.`);
				}
				if (selectedCommandTargets.length > 0 && !commandsStatus.available) {
					missingMessages.push(commandsStatus.reason);
				}
				const message =
					missingMessages.length > 0 ? missingMessages.join(" ") : "No sources to sync.";
				console.error(`Error: ${message}`);
				process.exit(1);
				return;
			}

			try {
				await validateTemplatingSources({
					repoRoot,
					validAgents,
					commandsAvailable: hasCommandsToSync,
					skillsAvailable: hasSkillsToSync,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(message);
				process.exit(1);
				return;
			}

			const commandsSummary = await syncSlashCommands({
				repoRoot,
				targets: selectedCommandTargets,
				overrideOnly: overrideOnly as CommandTargetName[] | undefined,
				overrideSkip: overrideSkip as CommandTargetName[] | undefined,
				jsonOutput: argv.json,
				yes: argv.yes,
				removeMissing: argv.removeMissing,
				conflicts: argv.conflicts,
				catalogStatus: commandsStatus,
				validAgents,
			});

			const subagentSummary = await syncSubagents({
				repoRoot,
				targets: selectedSubagentTargets,
				overrideOnly: overrideOnly as SubagentTargetName[] | undefined,
				overrideSkip: overrideSkip as SubagentTargetName[] | undefined,
				removeMissing: argv.removeMissing,
				validAgents,
			});

			// Sync conversions before copying canonical skills.
			let skillsSummary: SyncSummary;
			if (selectedSkillTargets.length === 0) {
				skillsSummary = buildSummary(skillsSourcePath, []);
			} else if (!skillsAvailable) {
				const reason = `Canonical config source not found at ${skillsSourcePath}.`;
				skillsSummary = buildSkillsSummary(
					repoRoot,
					skillsSourcePath,
					selectedSkillTargets,
					"skipped",
					reason,
				);
			} else {
				skillsSummary = await syncSkillTargets({
					repoRoot,
					targets: selectedSkillTargets,
					overrideOnly: overrideOnly as SkillTargetName[] | undefined,
					overrideSkip: overrideSkip as SkillTargetName[] | undefined,
					validAgents,
				});
			}

			const combined = {
				skills: skillsSummary,
				subagents: subagentSummary,
				commands: commandsSummary,
				hadFailures:
					skillsSummary.hadFailures || subagentSummary.hadFailures || commandsSummary.hadFailures,
			};

			if (argv.json) {
				console.log(JSON.stringify(combined, null, 2));
			} else {
				const outputs: string[] = [];
				const skillsOutput = formatSummary(skillsSummary, false);
				if (skillsOutput.length > 0) {
					outputs.push(skillsOutput);
				}
				const subagentOutput = formatSubagentSummary(subagentSummary, false);
				if (subagentOutput.length > 0) {
					outputs.push(subagentOutput);
				}
				const commandOutput = formatCommandSummary(commandsSummary, false);
				if (commandOutput.length > 0) {
					outputs.push(commandOutput);
				}
				if (outputs.length > 0) {
					console.log(outputs.join("\n"));
				}
			}

			if (combined.hadFailures) {
				process.exitCode = 1;
			}
		} catch (error) {
			if (error instanceof InvalidFrontmatterTargetsError) {
				console.error(`Error: ${error.message}`);
				process.exit(1);
				return;
			}
			throw error;
		}
	},
};
