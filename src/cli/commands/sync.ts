import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { TextDecoder } from "node:util";
import type { CommandModule } from "yargs";
import { validateAgentTemplating } from "../../lib/agent-templating.js";
import { DEFAULT_AGENTS_DIR, resolveAgentsDir, validateAgentsDir } from "../../lib/agents-dir.js";
import { readIgnorePreference, recordIgnorePromptDeclined } from "../../lib/ignore-preferences.js";
import {
	appendIgnoreRules,
	buildAgentsIgnoreRules,
	getIgnoreRuleStatus,
} from "../../lib/ignore-rules.js";
import { scanInstructionTemplateSources } from "../../lib/instructions/catalog.js";
import { scanRepoInstructionSources } from "../../lib/instructions/scan.js";
import {
	buildInstructionResultMessage,
	emptyOutputCounts,
	formatInstructionSummary,
} from "../../lib/instructions/summary.js";
import { type InstructionSyncSummary, syncInstructions } from "../../lib/instructions/sync.js";
import {
	isLocalSuffixFile,
	resolveLocalCategoryRoot,
	resolveSharedCategoryRoot,
	stripLocalPathSuffix,
} from "../../lib/local-sources.js";
import { findRepoRoot } from "../../lib/repo-root.js";
import { loadSkillCatalog } from "../../lib/skills/catalog.js";
import { syncSkills as syncSkillTargets } from "../../lib/skills/sync.js";
import { loadCommandCatalog } from "../../lib/slash-commands/catalog.js";
import {
	type SyncRequestV2 as CommandSyncRequestV2,
	type SyncSummary as CommandSyncSummary,
	type ConflictResolution,
	formatSyncSummary as formatCommandSummary,
	syncSlashCommands as syncSlashCommandsV2,
} from "../../lib/slash-commands/sync.js";
import { loadSubagentCatalog } from "../../lib/subagents/catalog.js";
import {
	formatSubagentSummary,
	type SubagentSyncRequestV2,
	syncSubagents as syncSubagentsV2,
} from "../../lib/subagents/sync.js";
import {
	buildSupportedAgentNames,
	buildSupportedTargetLabel,
} from "../../lib/supported-targets.js";
import {
	buildSummary,
	formatSummary,
	type SyncResult,
	type SyncSummary,
} from "../../lib/sync-results.js";
import {
	createTargetNameResolver,
	InvalidFrontmatterTargetsError,
} from "../../lib/sync-targets.js";
import {
	BUILTIN_TARGETS,
	loadTargetConfig,
	type ResolvedTarget,
	resolveTargets,
	validateTargetConfig,
} from "../../lib/targets/index.js";
import { normalizeCommandOutputDefinition } from "../../lib/targets/output-resolver.js";

type SyncArgs = {
	skip?: string | string[];
	only?: string | string[];
	agentsDir?: string;
	json?: boolean;
	yes?: boolean;
	removeMissing?: boolean;
	conflicts?: string;
	excludeLocal?: string | string[] | boolean;
	listLocal?: boolean;
};

const DEFAULT_SUPPORTED_TARGETS = BUILTIN_TARGETS.map((target) => target.id).join(", ");
const LOCAL_CATEGORIES = ["skills", "commands", "agents", "instructions"] as const;
type LocalCategory = (typeof LOCAL_CATEGORIES)[number];
const LOCAL_CATEGORY_SET = new Set(LOCAL_CATEGORIES);

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

type ExcludeLocalSelection = {
	excludeAll: boolean;
	categories: Set<LocalCategory>;
	invalid: string[];
};

function parseExcludeLocal(value?: string | string[] | boolean): ExcludeLocalSelection {
	if (value === undefined || value === false) {
		return { excludeAll: false, categories: new Set(), invalid: [] };
	}
	if (value === true) {
		return { excludeAll: true, categories: new Set(LOCAL_CATEGORIES), invalid: [] };
	}
	const list = parseList(value);
	if (list.length === 0) {
		return { excludeAll: true, categories: new Set(LOCAL_CATEGORIES), invalid: [] };
	}
	const invalid = list.filter((entry) => !LOCAL_CATEGORY_SET.has(entry as LocalCategory));
	if (invalid.length > 0) {
		return { excludeAll: false, categories: new Set(), invalid };
	}
	return {
		excludeAll: false,
		categories: new Set(list as LocalCategory[]),
		invalid: [],
	};
}

type LocalItem = {
	name: string;
	sourcePath: string;
	markerType: "path" | "suffix";
};

type LocalItemsByCategory = {
	skills: LocalItem[];
	commands: LocalItem[];
	agents: LocalItem[];
	instructions: LocalItem[];
	total: number;
};

function sortLocalItems(items: LocalItem[]): LocalItem[] {
	return [...items].sort((left, right) => {
		const nameCompare = left.name.localeCompare(right.name);
		if (nameCompare !== 0) {
			return nameCompare;
		}
		return left.sourcePath.localeCompare(right.sourcePath);
	});
}

async function collectLocalItems(
	repoRoot: string,
	agentsDir: string | null,
	resolveTargetName?: (value: string) => string | null,
	targets?: ResolvedTarget[],
): Promise<LocalItemsByCategory> {
	const [skillCatalog, commandCatalog, subagentCatalog, templateEntries, repoEntries] =
		await Promise.all([
			loadSkillCatalog(repoRoot, { agentsDir, resolveTargetName }),
			loadCommandCatalog(repoRoot, { agentsDir, resolveTargetName }),
			loadSubagentCatalog(repoRoot, { agentsDir, resolveTargetName }),
			scanInstructionTemplateSources({ repoRoot, includeLocal: true, agentsDir }),
			scanRepoInstructionSources({ repoRoot, includeLocal: true, agentsDir, targets }),
		]);

	const skills = sortLocalItems(
		skillCatalog.localSkills.map((skill) => ({
			name: skill.name,
			sourcePath: skill.sourcePath,
			markerType: skill.markerType ?? "path",
		})),
	);
	const commands = sortLocalItems(
		commandCatalog.localCommands.map((command) => ({
			name: command.name,
			sourcePath: command.sourcePath,
			markerType: command.markerType ?? "path",
		})),
	);
	const agents = sortLocalItems(
		subagentCatalog.localSubagents.map((subagent) => ({
			name: subagent.resolvedName,
			sourcePath: subagent.sourcePath,
			markerType: subagent.markerType ?? "path",
		})),
	);
	const instructionItems = sortLocalItems(
		[...templateEntries, ...repoEntries]
			.filter((entry) => entry.sourceType === "local")
			.map((entry) => ({
				name: formatDisplayPath(repoRoot, entry.sourcePath),
				sourcePath: entry.sourcePath,
				markerType: entry.markerType ?? "path",
			})),
	);

	return {
		skills,
		commands,
		agents,
		instructions: instructionItems,
		total: skills.length + commands.length + agents.length + instructionItems.length,
	};
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

function formatLocalItemsOutput(
	items: LocalItemsByCategory,
	repoRoot: string,
	jsonOutput: boolean,
): string {
	if (jsonOutput) {
		return JSON.stringify(
			{
				skills: items.skills,
				commands: items.commands,
				agents: items.agents,
				instructions: items.instructions,
			},
			null,
			2,
		);
	}

	const lines: string[] = [];
	const sections: Array<[string, LocalItem[]]> = [
		["skills", items.skills],
		["commands", items.commands],
		["agents", items.agents],
		["instructions", items.instructions],
	];
	for (const [label, list] of sections) {
		lines.push(`Local ${label} (${list.length}):`);
		if (list.length === 0) {
			lines.push("(none)");
			continue;
		}
		for (const item of list) {
			const displayPath = formatDisplayPath(repoRoot, item.sourcePath);
			lines.push(`- ${item.name} (${item.markerType}: ${displayPath})`);
		}
	}
	return lines.join("\n");
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

function hasLocalMarker(filePath: string): boolean {
	const segments = filePath.split(path.sep);
	for (const segment of segments) {
		if (stripLocalPathSuffix(segment).hadLocalSuffix) {
			return true;
		}
	}
	const baseName = path.basename(filePath);
	const extension = path.parse(baseName).ext;
	return isLocalSuffixFile(baseName, extension);
}

async function hasLocalSources(
	repoRoot: string,
	agentsDir?: string | null,
	targets?: ResolvedTarget[],
): Promise<boolean> {
	const localRoots = [
		resolveLocalCategoryRoot(repoRoot, "skills", agentsDir),
		resolveLocalCategoryRoot(repoRoot, "commands", agentsDir),
		resolveLocalCategoryRoot(repoRoot, "agents", agentsDir),
	];
	for (const localRoot of localRoots) {
		if (await assertSourceDirectory(localRoot)) {
			if (await hasMarkdownFiles(localRoot)) {
				return true;
			}
		}
	}

	const sharedChecks: Array<{
		root: string;
		listFiles: (root: string) => Promise<string[]>;
	}> = [
		{ root: resolveSharedCategoryRoot(repoRoot, "skills", agentsDir), listFiles },
		{
			root: resolveSharedCategoryRoot(repoRoot, "commands", agentsDir),
			listFiles: listMarkdownFiles,
		},
		{
			root: resolveSharedCategoryRoot(repoRoot, "agents", agentsDir),
			listFiles: listMarkdownFiles,
		},
	];

	for (const check of sharedChecks) {
		if (!(await assertSourceDirectory(check.root))) {
			continue;
		}
		const files = await check.listFiles(check.root);
		if (files.some((filePath) => hasLocalMarker(filePath))) {
			return true;
		}
	}

	const [templateEntries, repoEntries] = await Promise.all([
		scanInstructionTemplateSources({ repoRoot, includeLocal: true, agentsDir }),
		scanRepoInstructionSources({ repoRoot, includeLocal: true, agentsDir, targets }),
	]);
	if (
		templateEntries.some((entry) => entry.sourceType === "local") ||
		repoEntries.some((entry) => entry.sourceType === "local")
	) {
		return true;
	}

	return false;
}

async function validateTemplatingSources(options: {
	repoRoot: string;
	agentsDir?: string | null;
	validAgents: string[];
	commandsAvailable: boolean;
	skillsAvailable: boolean;
	includeLocalCommands: boolean;
	includeLocalSkills: boolean;
	includeLocalAgents: boolean;
	includeLocalInstructions: boolean;
	instructionsAvailable: boolean;
}): Promise<void> {
	const directories: string[] = [];
	if (options.commandsAvailable) {
		const commandsPath = resolveSharedCategoryRoot(options.repoRoot, "commands", options.agentsDir);
		if (await assertSourceDirectory(commandsPath)) {
			directories.push(commandsPath);
		}
	}
	if (options.skillsAvailable) {
		const skillsPath = resolveSharedCategoryRoot(options.repoRoot, "skills", options.agentsDir);
		if (await assertSourceDirectory(skillsPath)) {
			directories.push(skillsPath);
		}
	}
	if (options.includeLocalCommands) {
		const localCommandsPath = resolveLocalCategoryRoot(
			options.repoRoot,
			"commands",
			options.agentsDir,
		);
		if (await assertSourceDirectory(localCommandsPath)) {
			directories.push(localCommandsPath);
		}
	}
	if (options.includeLocalSkills) {
		const localSkillsPath = resolveLocalCategoryRoot(options.repoRoot, "skills", options.agentsDir);
		if (await assertSourceDirectory(localSkillsPath)) {
			directories.push(localSkillsPath);
		}
	}
	const subagentsPath = resolveSharedCategoryRoot(options.repoRoot, "agents", options.agentsDir);
	if (await assertSourceDirectory(subagentsPath)) {
		directories.push(subagentsPath);
	}
	if (options.includeLocalAgents) {
		const localSubagentsPath = resolveLocalCategoryRoot(
			options.repoRoot,
			"agents",
			options.agentsDir,
		);
		if (await assertSourceDirectory(localSubagentsPath)) {
			directories.push(localSubagentsPath);
		}
	}

	for (const directory of directories) {
		const category = path.basename(directory);
		const excludeLocal =
			(category === "skills" && !options.includeLocalSkills) ||
			(category === "commands" && !options.includeLocalCommands) ||
			(category === "agents" && !options.includeLocalAgents);
		const files =
			path.basename(directory) === "skills"
				? await listFiles(directory)
				: await listMarkdownFiles(directory);
		const filesToValidate = excludeLocal
			? files.filter((filePath) => !hasLocalMarker(filePath))
			: files;
		for (const filePath of filesToValidate) {
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

	if (options.instructionsAvailable) {
		const entries = await scanInstructionTemplateSources({
			repoRoot: options.repoRoot,
			includeLocal: options.includeLocalInstructions,
			agentsDir: options.agentsDir,
		});
		for (const entry of entries) {
			const buffer = await readFile(entry.sourcePath);
			const contents = decodeUtf8(buffer);
			if (contents === null) {
				continue;
			}
			validateAgentTemplating({
				content: contents,
				validAgents: options.validAgents,
				sourcePath: entry.sourcePath,
			});
		}
	}
}

async function getCommandCatalogStatus(options: {
	repoRoot: string;
	includeLocal: boolean;
	agentsDir?: string | null;
}): Promise<CatalogStatus> {
	const commandsPath = resolveSharedCategoryRoot(options.repoRoot, "commands", options.agentsDir);
	const localCommandsPath = resolveLocalCategoryRoot(
		options.repoRoot,
		"commands",
		options.agentsDir,
	);

	let sharedStats: Awaited<ReturnType<typeof stat>> | null = null;
	try {
		sharedStats = await stat(commandsPath);
		if (!sharedStats.isDirectory()) {
			return {
				available: false,
				reason: `Command catalog path is not a directory: ${commandsPath}.`,
			};
		}
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") {
			throw error;
		}
	}

	let localStats: Awaited<ReturnType<typeof stat>> | null = null;
	if (options.includeLocal) {
		try {
			localStats = await stat(localCommandsPath);
			if (!localStats.isDirectory()) {
				return {
					available: false,
					reason: `Local command catalog path is not a directory: ${localCommandsPath}.`,
				};
			}
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "ENOENT") {
				throw error;
			}
		}
	}

	const hasShared = sharedStats ? await hasMarkdownFiles(commandsPath) : false;
	const hasLocal = localStats ? await hasMarkdownFiles(localCommandsPath) : false;

	if (!hasShared && !hasLocal) {
		if (!sharedStats && !localStats) {
			const pathLabel = options.includeLocal
				? `${commandsPath} or ${localCommandsPath}`
				: commandsPath;
			return {
				available: false,
				reason: `Command catalog directory not found at ${pathLabel}.`,
			};
		}
		const pathLabel = options.includeLocal
			? `${commandsPath} or ${localCommandsPath}`
			: commandsPath;
		return {
			available: false,
			reason: `No slash command definitions found in ${pathLabel}.`,
		};
	}

	return { available: true };
}

function _formatResultMessage(
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

function logNonInteractiveNotices(options: { targets: ResolvedTarget[]; jsonOutput: boolean }) {
	for (const target of options.targets) {
		const commandDef = normalizeCommandOutputDefinition(target.outputs.commands);
		if (!commandDef || commandDef.fallback?.mode === "skip") {
			continue;
		}
		if (commandDef.fallback?.mode === "convert" && commandDef.fallback.targetType === "skills") {
			logWithChannel(
				`${target.displayName} commands are configured to convert to skills.`,
				options.jsonOutput,
			);
			continue;
		}
		const hasProject = Boolean(commandDef.projectPath);
		const hasUser = Boolean(commandDef.userPath);
		if (hasUser && !hasProject) {
			logWithChannel(`${target.displayName} commands are user-only.`, options.jsonOutput);
		} else if (hasUser && hasProject) {
			logWithChannel(
				`${target.displayName} commands will be written to project and user locations.`,
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

function normalizeTargets(targets: Array<ResolvedTarget | string>): ResolvedTarget[] {
	return targets.map((target) =>
		typeof target === "string"
			? {
					id: target,
					displayName: target,
					aliases: [],
					outputs: {},
					isBuiltIn: false,
					isCustomized: false,
				}
			: target,
	);
}

function buildCommandSummary(
	sourcePath: string,
	targets: Array<ResolvedTarget | string>,
	status: "skipped" | "failed",
	message: string,
	excludedLocal: boolean,
): CommandSyncSummary {
	const normalizedTargets = normalizeTargets(targets);
	return {
		sourcePath,
		results: normalizedTargets.map((target) => {
			const verb = status === "failed" ? "Failed" : "Skipped";
			return {
				targetName: target.id,
				status,
				message: `${verb} ${target.displayName}: ${message}`,
				error: message,
				counts: emptyCommandCounts(),
			};
		}),
		warnings: [],
		hadFailures: status === "failed",
		sourceCounts: {
			shared: 0,
			local: 0,
			excludedLocal,
		},
	};
}

function buildSkillsSummary(
	repoRoot: string,
	sourcePath: string,
	targets: Array<ResolvedTarget | string>,
	status: "skipped" | "failed",
	reason: string,
	excludedLocal: boolean,
): SyncSummary {
	const sourceDisplay = formatDisplayPath(repoRoot, sourcePath);
	const results: SyncResult[] = normalizeTargets(targets).map((target) => ({
		targetName: target.id,
		status,
		message: `${status === "failed" ? "Failed" : "Skipped"} ${sourceDisplay} for ${target.displayName}: ${reason}`,
		error: reason,
	}));
	return buildSummary(sourcePath, results, [], {
		shared: 0,
		local: 0,
		excludedLocal,
	});
}

function buildInstructionsSummary(
	repoRoot: string,
	targets: Array<ResolvedTarget | string>,
	status: "skipped" | "failed",
	message: string,
	excludedLocal: boolean,
): InstructionSyncSummary {
	const results = normalizeTargets(targets).map((target) => {
		const counts = emptyOutputCounts();
		return {
			targetName: target.id,
			status,
			message: buildInstructionResultMessage({
				targetName: target.id,
				status,
				counts,
				error: message,
			}),
			counts,
			warnings: [],
			error: message,
		};
	});
	return {
		sourcePath: repoRoot,
		results,
		warnings: [],
		hadFailures: status === "failed",
		sourceCounts: {
			shared: 0,
			local: 0,
			excludedLocal,
		},
	};
}

export const syncCommand: CommandModule<Record<string, never>, SyncArgs> = {
	command: "sync",
	describe: "Sync skills, subagents, slash commands, and instruction files to targets",
	builder: (yargs) =>
		yargs
			.usage("omniagent sync [options]")
			.option("skip", {
				type: "string",
				describe: `Comma-separated targets to skip (${DEFAULT_SUPPORTED_TARGETS})`,
			})
			.option("only", {
				type: "string",
				describe: `Comma-separated targets to sync (${DEFAULT_SUPPORTED_TARGETS})`,
			})
			.option("agentsDir", {
				type: "string",
				describe: "Override the agents directory (relative paths resolve from the project root)",
				defaultDescription: DEFAULT_AGENTS_DIR,
				coerce: (value) => {
					if (typeof value !== "string") {
						return value;
					}
					const trimmed = value.trim();
					return trimmed.length > 0 ? trimmed : undefined;
				},
			})
			.option("exclude-local", {
				type: "string",
				describe:
					"Exclude local sources entirely or by category (skills, commands, agents, instructions)",
			})
			.option("list-local", {
				type: "boolean",
				default: false,
				describe: "List detected local items and exit",
			})
			.option("yes", {
				type: "boolean",
				default: false,
				describe: "Accept defaults and skip confirmation prompts",
			})
			.option("remove-missing", {
				type: "boolean",
				default: true,
				describe:
					"Remove previously synced commands, subagents, and instruction outputs missing from sources",
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
			.epilog(
				`Supported targets: ${DEFAULT_SUPPORTED_TARGETS}\n` +
					"Config: auto-discovered as omniagent.config.(ts|mts|cts|js|mjs|cjs) in the agents directory.",
			)
			.example(
				"omniagent sync",
				"Sync all targets (auto-discovers omniagent.config.* in the agents directory)",
			)
			.example("omniagent sync --skip <target>", "Skip a target")
			.example("omniagent sync --only <target>", "Sync only one target")
			.example("omniagent sync --agentsDir ./my-custom-agents", "Use a custom agents directory")
			.example("omniagent sync --exclude-local", "Sync shared sources only")
			.example(
				"omniagent sync --exclude-local=skills,commands",
				"Exclude local skills and commands",
			)
			.example("omniagent sync --list-local", "List detected local items")
			.example("omniagent sync --yes", "Accept defaults and apply changes")
			.example("omniagent sync --json", "Output a JSON summary"),
	handler: async (argv) => {
		try {
			const skipList = parseList(argv.skip);
			const onlyList = parseList(argv.only);

			const excludeLocalSelection = parseExcludeLocal(argv.excludeLocal);
			if (excludeLocalSelection.invalid.length > 0) {
				const invalidList = excludeLocalSelection.invalid.join(", ");
				console.error(
					`Error: Unknown local category(s): ${invalidList}. Supported categories: ` +
						`${LOCAL_CATEGORIES.join(", ")}.`,
				);
				process.exit(1);
				return;
			}
			const excludeLocalCategories = excludeLocalSelection.excludeAll
				? new Set(LOCAL_CATEGORIES)
				: excludeLocalSelection.categories;
			const excludeLocalSkills = excludeLocalCategories.has("skills");
			const excludeLocalCommands = excludeLocalCategories.has("commands");
			const excludeLocalAgents = excludeLocalCategories.has("agents");
			const excludeLocalInstructions = excludeLocalCategories.has("instructions");

			const jsonOutput = argv.json ?? false;
			const yes = argv.yes ?? false;
			const removeMissing = argv.removeMissing ?? true;
			const listLocal = argv.listLocal ?? false;

			const startDir = process.cwd();
			const repoRoot = await findRepoRoot(startDir);

			if (!repoRoot) {
				console.error(
					`Error: Repository root not found starting from ${startDir}. Looked for .git or package.json.`,
				);
				process.exit(1);
				return;
			}

			const agentsDirResolution = resolveAgentsDir(repoRoot, argv.agentsDir);
			if (agentsDirResolution.source === "override") {
				const validation = await validateAgentsDir(repoRoot, argv.agentsDir);
				if (validation.validationStatus !== "valid") {
					console.error(`Error: ${validation.errorMessage}`);
					process.exit(1);
					return;
				}
			}
			const agentsDir = agentsDirResolution.resolvedPath;

			const { config } = await loadTargetConfig({ repoRoot, agentsDir });
			const validation = validateTargetConfig({ config, builtIns: BUILTIN_TARGETS });
			if (!validation.valid) {
				console.error(`Error: Invalid target configuration:\n- ${validation.errors.join("\n- ")}`);
				process.exit(1);
				return;
			}

			const resolved = resolveTargets({ config: validation.config, builtIns: BUILTIN_TARGETS });
			const targetResolver = createTargetNameResolver(resolved.targets);
			const resolveTargetName = targetResolver.resolveTargetName;
			const globalHooks = validation.config?.hooks;
			const supportedLabel = buildSupportedTargetLabel(resolved.targets);

			const resolveSelection = (list: string[]): { ids: string[]; unknown: string[] } => {
				const ids: string[] = [];
				const unknown: string[] = [];
				for (const name of list) {
					const resolvedName = targetResolver.resolveTargetName(name);
					if (!resolvedName) {
						unknown.push(name);
						continue;
					}
					if (!ids.includes(resolvedName)) {
						ids.push(resolvedName);
					}
				}
				return { ids, unknown };
			};

			const resolvedSkip = resolveSelection(skipList);
			const resolvedOnly = resolveSelection(onlyList);
			const unknownTargets = [...resolvedSkip.unknown, ...resolvedOnly.unknown];
			if (unknownTargets.length > 0) {
				const unknownList = unknownTargets.join(", ");
				console.error(
					`Error: Unknown target name(s): ${unknownList}. Supported targets: ${supportedLabel}.`,
				);
				process.exit(1);
				return;
			}

			const skipSet = new Set(resolvedSkip.ids);
			const onlySet = new Set(resolvedOnly.ids);
			const selectedTargets = resolved.targets.filter((target) => {
				if (onlySet.size > 0 && !onlySet.has(target.id)) {
					return false;
				}
				if (skipSet.size > 0 && skipSet.has(target.id)) {
					return false;
				}
				return true;
			});
			const overrideOnly = resolvedOnly.ids.length > 0 ? resolvedOnly.ids : undefined;
			const overrideSkip = resolvedSkip.ids.length > 0 ? resolvedSkip.ids : undefined;
			const validAgents = buildSupportedAgentNames(resolved.targets);

			if (selectedTargets.length === 0 && !listLocal) {
				console.error("Error: No targets selected after applying filters.");
				process.exit(1);
				return;
			}

			const localItems = listLocal
				? await collectLocalItems(repoRoot, agentsDir, resolveTargetName, resolved.targets)
				: { skills: [], commands: [], agents: [], instructions: [], total: 0 };
			if (listLocal) {
				const output = formatLocalItemsOutput(localItems, repoRoot, jsonOutput);
				if (output.length > 0) {
					console.log(output);
				}
				return;
			}

			const nonInteractive = yes || !process.stdin.isTTY;
			const hasLocalItems = await hasLocalSources(repoRoot, agentsDir, resolved.targets);

			const selectedSkillTargets = selectedTargets.filter((target) => target.outputs.skills);
			const selectedCommandTargets = selectedTargets.filter((target) => target.outputs.commands);
			const selectedSubagentTargets = selectedTargets.filter((target) => target.outputs.subagents);
			const selectedInstructionTargets = selectedTargets.filter(
				(target) => target.outputs.instructions,
			);

			const includeLocalSkills = !excludeLocalSkills;
			const includeLocalCommands = !excludeLocalCommands;
			const includeLocalAgents = !excludeLocalAgents;
			const includeLocalInstructions = !excludeLocalInstructions;

			const skillsSourcePath = resolveSharedCategoryRoot(repoRoot, "skills", agentsDir);
			const localSkillsPath = resolveLocalCategoryRoot(repoRoot, "skills", agentsDir);
			const sharedSkillsAvailable = await assertSourceDirectory(skillsSourcePath);
			const localSkillsAvailable = includeLocalSkills
				? await assertSourceDirectory(localSkillsPath)
				: false;
			const skillsAvailable =
				selectedSkillTargets.length > 0 ? sharedSkillsAvailable || localSkillsAvailable : false;
			const commandsStatus =
				selectedCommandTargets.length > 0
					? await getCommandCatalogStatus({
							repoRoot,
							includeLocal: includeLocalCommands,
							agentsDir,
						})
					: ({ available: true } as CatalogStatus);

			const hasSkillsToSync = selectedSkillTargets.length > 0 && skillsAvailable;
			const hasCommandsToSync = selectedCommandTargets.length > 0 && commandsStatus.available;
			const hasSubagentsToSync = selectedSubagentTargets.length > 0;
			const hasInstructionsToSync = selectedInstructionTargets.length > 0;

			if (!hasSkillsToSync && !hasCommandsToSync && !hasSubagentsToSync && !hasInstructionsToSync) {
				const missingMessages: string[] = [];
				if (selectedSkillTargets.length > 0 && !skillsAvailable) {
					const skillsLabel = includeLocalSkills
						? `${skillsSourcePath} or ${localSkillsPath}`
						: skillsSourcePath;
					missingMessages.push(`Canonical config source not found at ${skillsLabel}.`);
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
					agentsDir,
					validAgents,
					commandsAvailable: hasCommandsToSync,
					skillsAvailable: hasSkillsToSync,
					includeLocalCommands: includeLocalCommands && hasCommandsToSync,
					includeLocalSkills: includeLocalSkills && hasSkillsToSync,
					includeLocalAgents: includeLocalAgents && hasSubagentsToSync,
					includeLocalInstructions: includeLocalInstructions && hasInstructionsToSync,
					instructionsAvailable: hasInstructionsToSync,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(message);
				process.exit(1);
				return;
			}

			let missingIgnoreRules = false;
			let ignoreRules: string[] | null = null;
			if (hasLocalItems) {
				ignoreRules = buildAgentsIgnoreRules(repoRoot, agentsDir);
				const ignoreStatus = await getIgnoreRuleStatus(repoRoot, {
					agentsDir,
					rules: ignoreRules,
				});
				if (ignoreStatus.missingRules.length > 0) {
					missingIgnoreRules = true;
					const preference = await readIgnorePreference(repoRoot);
					const previouslyDeclined = preference?.ignorePromptDeclined ?? false;
					if (!nonInteractive && !previouslyDeclined) {
						const ignoreLabel = formatDisplayPath(repoRoot, ignoreStatus.ignoreFilePath);
						logWithChannel(
							`Local config detected. Missing ignore rules in ${ignoreLabel}.`,
							jsonOutput,
						);
						const rules = ignoreRules ?? buildAgentsIgnoreRules(repoRoot, agentsDir);
						const shouldApply = await withPrompter((ask) =>
							promptConfirm(ask, `Add ignore rules (${rules.join(", ")})?`, false),
						);
						if (shouldApply) {
							await appendIgnoreRules(repoRoot, { agentsDir, rules: ignoreRules });
							missingIgnoreRules = false;
							logWithChannel(`Updated ${ignoreLabel}.`, jsonOutput);
						} else {
							await recordIgnorePromptDeclined(repoRoot);
						}
					}
				}
			}

			const commandsSourcePath = resolveSharedCategoryRoot(repoRoot, "commands", agentsDir);
			let commandsSummary: CommandSyncSummary;
			if (selectedCommandTargets.length === 0) {
				commandsSummary = {
					sourcePath: commandsSourcePath,
					results: [],
					warnings: [],
					hadFailures: false,
					sourceCounts: {
						shared: 0,
						local: 0,
						excludedLocal: excludeLocalCommands,
					},
				};
			} else if (!commandsStatus.available) {
				commandsSummary = buildCommandSummary(
					commandsSourcePath,
					selectedCommandTargets,
					"skipped",
					commandsStatus.reason,
					excludeLocalCommands,
				);
			} else {
				if (nonInteractive && selectedCommandTargets.length > 0) {
					logNonInteractiveNotices({ targets: selectedCommandTargets, jsonOutput });
					logWithChannel("Planned actions:", jsonOutput);
				}
				commandsSummary = await syncSlashCommandsV2({
					repoRoot,
					agentsDir,
					targets: selectedCommandTargets,
					overrideOnly,
					overrideSkip,
					conflictResolution: argv.conflicts as ConflictResolution | undefined,
					removeMissing,
					nonInteractive,
					validAgents,
					excludeLocal: excludeLocalCommands,
					resolveTargetName,
					hooks: globalHooks,
				} satisfies CommandSyncRequestV2);
			}

			const subagentSummary = await syncSubagentsV2({
				repoRoot,
				agentsDir,
				targets: selectedSubagentTargets,
				overrideOnly,
				overrideSkip,
				removeMissing,
				validAgents,
				excludeLocal: excludeLocalAgents,
				includeLocalSkills,
				resolveTargetName,
				hooks: globalHooks,
			} satisfies SubagentSyncRequestV2);

			let instructionsSummary: InstructionSyncSummary;
			if (selectedInstructionTargets.length === 0) {
				instructionsSummary = {
					sourcePath: repoRoot,
					results: [],
					warnings: [],
					hadFailures: false,
					sourceCounts: {
						shared: 0,
						local: 0,
						excludedLocal: excludeLocalInstructions,
					},
				};
			} else {
				const confirmRemoval = nonInteractive
					? undefined
					: async (info: { outputPath: string; sourcePath: string; targetName: string }) =>
							withPrompter((ask) =>
								promptConfirm(
									ask,
									`Output ${formatDisplayPath(
										repoRoot,
										info.outputPath,
									)} (from ${formatDisplayPath(repoRoot, info.sourcePath)}) was modified. Remove?`,
									false,
								),
							);
				try {
					instructionsSummary = await syncInstructions({
						repoRoot,
						agentsDir,
						targets: selectedInstructionTargets,
						overrideOnly,
						overrideSkip,
						excludeLocal: excludeLocalInstructions,
						removeMissing,
						nonInteractive,
						validAgents,
						resolveTargetName,
						hooks: globalHooks,
						confirmRemoval,
					});
				} catch (error) {
					rethrowIfInvalidTargets(error);
					const message = error instanceof Error ? error.message : String(error);
					instructionsSummary = buildInstructionsSummary(
						repoRoot,
						selectedInstructionTargets,
						"failed",
						message,
						excludeLocalInstructions,
					);
				}
			}

			// Sync conversions before copying canonical skills.
			let skillsSummary: SyncSummary;
			if (selectedSkillTargets.length === 0) {
				skillsSummary = buildSummary(skillsSourcePath, [], [], {
					shared: 0,
					local: 0,
					excludedLocal: excludeLocalSkills,
				});
			} else if (!skillsAvailable) {
				const reason = `Canonical config source not found at ${skillsSourcePath}.`;
				skillsSummary = buildSkillsSummary(
					repoRoot,
					skillsSourcePath,
					selectedSkillTargets,
					"skipped",
					reason,
					excludeLocalSkills,
				);
			} else {
				skillsSummary = await syncSkillTargets({
					repoRoot,
					agentsDir,
					targets: selectedSkillTargets,
					overrideOnly,
					overrideSkip,
					validAgents,
					excludeLocal: excludeLocalSkills,
					removeMissing,
					resolveTargetName,
					hooks: globalHooks,
				});
			}

			const combined = {
				instructions: instructionsSummary,
				skills: skillsSummary,
				subagents: subagentSummary,
				commands: commandsSummary,
				hadFailures:
					instructionsSummary.hadFailures ||
					skillsSummary.hadFailures ||
					subagentSummary.hadFailures ||
					commandsSummary.hadFailures,
				missingIgnoreRules,
			};

			if (jsonOutput) {
				console.log(JSON.stringify(combined, null, 2));
			} else {
				const outputs: string[] = [];
				const instructionOutput = formatInstructionSummary(instructionsSummary, false);
				if (instructionOutput.length > 0) {
					outputs.push(instructionOutput);
				}
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
				if (missingIgnoreRules) {
					const warningRules = ignoreRules ?? buildAgentsIgnoreRules(repoRoot, agentsDir);
					outputs.push(
						`Warning: Missing ignore rules for local sources (${warningRules.join(", ")}).`,
					);
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
