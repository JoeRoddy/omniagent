import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyAgentTemplating } from "../agent-templating.js";
import { resolveAgentsDirPath } from "../agents-dir.js";
import { normalizeName } from "../catalog-utils.js";
import { buildSupportedAgentNames } from "../supported-targets.js";
import type { SyncSourceCounts } from "../sync-results.js";
import { createTargetNameResolver, resolveEffectiveTargets } from "../sync-targets.js";
import { BUILTIN_TARGETS } from "../targets/builtins.js";
import type {
	ConverterRule,
	OmniagentConfig,
	OutputWriter,
	ResolvedTarget,
	SyncHooks,
} from "../targets/config-types.js";
import {
	type ConverterRegistry,
	normalizeConverterDecision,
	resolveConverter,
} from "../targets/converters.js";
import { runConvertHook, runSyncHook } from "../targets/hooks.js";
import {
	buildManagedOutputKey,
	hashOutputPath,
	type ManagedOutputRecord,
	normalizeManagedOutputPath,
	readManagedOutputs,
	writeManagedOutputs,
} from "../targets/managed-outputs.js";
import {
	normalizeCommandOutputDefinition,
	normalizeOutputDefinition,
	resolveCommandOutputPath,
	resolveOutputPath as resolveTargetOutputPath,
} from "../targets/output-resolver.js";
import { resolveTargets } from "../targets/resolve-targets.js";
import { resolveWriter, type WriterRegistry, writeFileOutput } from "../targets/writers.js";
import { loadCommandCatalog, type SlashCommandDefinition } from "./catalog.js";
import { renderMarkdownCommand, renderSkillFromCommand, renderTomlCommand } from "./formatting.js";
import { extractFrontmatter } from "./frontmatter.js";
import {
	type ManagedCommand,
	readManifest,
	resolveManifestPath,
	type SyncStateManifest,
	writeManifest,
} from "./manifest.js";
import type { Scope, TargetName } from "./targets.js";

export type ConflictResolution = "overwrite" | "rename" | "skip";

export type SyncRequest = {
	repoRoot: string;
	agentsDir?: string | null;
	config?: OmniagentConfig | null;
	resolvedTargets?: ResolvedTarget[];
	resolveTargetName?: (value: string) => string | null;
	targets?: TargetName[];
	overrideOnly?: TargetName[] | null;
	overrideSkip?: TargetName[] | null;
	scopeByTarget?: Partial<Record<TargetName, Scope>>;
	conflictResolution?: ConflictResolution;
	removeMissing?: boolean;
	nonInteractive?: boolean;
	useDefaults?: boolean;
	validAgents?: string[];
	excludeLocal?: boolean;
};

export type SyncRequestV2 = {
	repoRoot: string;
	agentsDir?: string | null;
	targets: ResolvedTarget[];
	overrideOnly?: string[] | null;
	overrideSkip?: string[] | null;
	conflictResolution?: ConflictResolution;
	removeMissing?: boolean;
	nonInteractive?: boolean;
	validAgents?: string[];
	excludeLocal?: boolean;
	resolveTargetName?: (value: string) => string | null;
	hooks?: SyncHooks;
};

export type SyncPlanAction = {
	targetName: TargetName;
	action: "create" | "update" | "remove" | "convert" | "skip" | "fail";
	commandName: string;
	scope: Scope | null;
};

export type SummaryCounts = {
	create: number;
	update: number;
	remove: number;
	convert: number;
	skip: number;
};

export type SyncPlan = {
	actions: SyncPlanAction[];
	summary: Record<TargetName, SummaryCounts>;
};

export type SyncResult = {
	targetName: TargetName;
	status: "synced" | "skipped" | "failed" | "partial";
	message: string;
	error?: string | null;
	counts: {
		created: number;
		updated: number;
		removed: number;
		converted: number;
		skipped: number;
	};
};

export type SyncSummary = {
	sourcePath: string;
	results: SyncResult[];
	warnings: string[];
	hadFailures: boolean;
	sourceCounts?: SyncSourceCounts;
};

type OutputKind = "command" | "skill";

type PlannedAction = SyncPlanAction & {
	destinationPath?: string;
	contents?: string;
	hash?: string;
	backupPath?: string;
	conflict?: boolean;
};

type TargetPlan = {
	targetName: TargetName;
	displayName: string;
	scope: Scope | null;
	mode: "commands" | "skills" | "skip";
	outputKind: OutputKind | null;
	destinationDir: string | null;
	manifestPath: string | null;
	legacyManifestPaths: string[];
	actions: PlannedAction[];
	summary: SummaryCounts;
	nextManaged: Map<string, ManagedCommand>;
	previousManaged: Map<string, ManagedCommand>;
	removeMissing: boolean;
};

export type TargetPlanSummary = {
	targetName: TargetName;
	displayName: string;
	scope: Scope | null;
	mode: "commands" | "skills" | "skip";
	counts: SummaryCounts;
};

export type SyncPlanDetails = {
	sourcePath: string;
	plan: SyncPlan;
	targetPlans: TargetPlan[];
	targetSummaries: TargetPlanSummary[];
	conflicts: number;
	warnings: string[];
	sourceCounts?: SyncSourceCounts;
};

const DEFAULT_CONFLICT_RESOLUTION: ConflictResolution = "skip";

function emptySummaryCounts(): SummaryCounts {
	return { create: 0, update: 0, remove: 0, convert: 0, skip: 0 };
}

function emptyResultCounts(): SyncResult["counts"] {
	return { created: 0, updated: 0, removed: 0, converted: 0, skipped: 0 };
}

function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function formatDisplayPath(repoRoot: string, absolutePath: string): string {
	const relative = path.relative(repoRoot, absolutePath);
	const isWithinRepo = relative && !relative.startsWith("..") && !path.isAbsolute(relative);
	return isWithinRepo ? relative : absolutePath;
}

function hashIdentifier(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function areManagedCommandsEqual(
	left: Map<string, ManagedCommand>,
	right: Map<string, ManagedCommand>,
): boolean {
	if (left.size !== right.size) {
		return false;
	}
	for (const [key, leftEntry] of left) {
		const rightEntry = right.get(key);
		if (!rightEntry) {
			return false;
		}
		if (
			leftEntry.name !== rightEntry.name ||
			leftEntry.hash !== rightEntry.hash ||
			leftEntry.lastSyncedAt !== rightEntry.lastSyncedAt
		) {
			return false;
		}
	}
	return true;
}

async function readFileIfExists(filePath: string): Promise<string | null> {
	try {
		return await readFile(filePath, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

async function pathExists(candidate: string): Promise<boolean> {
	try {
		await stat(candidate);
		return true;
	} catch {
		return false;
	}
}

async function listExistingNames(destinationDir: string, extension: string): Promise<Set<string>> {
	if (!(await pathExists(destinationDir))) {
		return new Set();
	}
	const entries = await readdir(destinationDir, { withFileTypes: true });
	const names = new Set<string>();
	for (const entry of entries) {
		if (!entry.isFile()) {
			continue;
		}
		if (!entry.name.toLowerCase().endsWith(extension)) {
			continue;
		}
		const base = entry.name.slice(0, -extension.length);
		names.add(normalizeName(base));
	}
	return names;
}

function getCommandFormat(outputPath: string): "markdown" | "toml" {
	return path.extname(outputPath).toLowerCase() === ".toml" ? "toml" : "markdown";
}

function resolveProjectManifestPath(
	targetName: TargetName,
	scope: Scope,
	repoRoot: string,
	homeDir: string,
): string {
	const repoHash = hashIdentifier(repoRoot);
	const baseDir = path.join(homeDir, ".omniagent", "state", "slash-commands", "projects", repoHash);
	return path.join(baseDir, `${targetName}-${scope}.toml`);
}

function resolveLegacyProjectManifestPath(
	targetName: TargetName,
	scope: Scope,
	repoRoot: string,
	homeDir: string,
): string {
	const repoHash = hashIdentifier(repoRoot);
	const baseDir = path.join(homeDir, ".omniagent", "slash-commands", "projects", repoHash);
	return path.join(baseDir, `${targetName}-${scope}.toml`);
}

function resolveLegacySkillManifestPath(
	targetName: TargetName,
	scope: Scope,
	repoRoot: string,
	homeDir: string,
): string {
	const baseDir = path.join(homeDir, ".omniagent", "slash-commands", "skills");
	if (scope === "project") {
		const repoHash = hashIdentifier(repoRoot);
		return path.join(baseDir, "projects", repoHash, `${targetName}-project.toml`);
	}
	return path.join(baseDir, "global", `${targetName}-global.toml`);
}

function resolveOutputPath(
	commandName: string,
	destinationDir: string,
	outputKind: OutputKind,
	extension: string,
): { destinationPath: string; containerDir: string } {
	if (outputKind === "skill") {
		const containerDir = path.join(destinationDir, commandName);
		return {
			containerDir,
			destinationPath: path.join(containerDir, "SKILL.md"),
		};
	}
	return {
		containerDir: destinationDir,
		destinationPath: path.join(destinationDir, `${commandName}${extension}`),
	};
}

async function resolveSkillBackupPath(destinationPath: string): Promise<string> {
	const dir = path.dirname(destinationPath);
	let suffix = 0;
	while (true) {
		const fileName = suffix === 0 ? "SKILL-backup.md" : `SKILL-backup-${suffix}.md`;
		const candidate = path.join(dir, fileName);
		if (!(await pathExists(candidate))) {
			return candidate;
		}
		suffix += 1;
	}
}

function renderOutput(
	command: SlashCommandDefinition,
	outputKind: OutputKind,
	outputPath: string,
): string {
	if (outputKind === "skill") {
		return renderSkillFromCommand(command);
	}
	return getCommandFormat(outputPath) === "toml"
		? renderTomlCommand(command)
		: renderMarkdownCommand(command);
}

function isWithinDir(baseDir: string, candidate: string): boolean {
	const relative = path.relative(baseDir, candidate);
	if (relative === "") {
		return true;
	}
	return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function resolveCommandTemplatePath(options: {
	commandDef: NonNullable<ReturnType<typeof normalizeCommandOutputDefinition>>;
	scope: Scope;
	repoRoot: string;
	homeDir: string;
	agentsDir: string;
	targetId: string;
}): string {
	const template =
		options.scope === "project" ? options.commandDef.projectPath : options.commandDef.userPath;
	if (!template) {
		throw new Error(`No ${options.scope} command destination for target ${options.targetId}.`);
	}
	return resolveCommandOutputPath({
		template,
		context: {
			repoRoot: options.repoRoot,
			agentsDir: options.agentsDir,
			homeDir: options.homeDir,
			targetId: options.targetId,
			itemName: "__placeholder__",
			commandLocation: options.scope === "project" ? "project" : "user",
		},
		item: { name: "__placeholder__" },
		baseDir: options.scope === "project" ? options.repoRoot : options.homeDir,
	});
}

function resolveSkillTemplatePath(options: {
	skillDef: NonNullable<ReturnType<typeof normalizeOutputDefinition>>;
	repoRoot: string;
	homeDir: string;
	agentsDir: string;
	targetId: string;
}): string {
	return resolveTargetOutputPath({
		template: options.skillDef.path,
		context: {
			repoRoot: options.repoRoot,
			agentsDir: options.agentsDir,
			homeDir: options.homeDir,
			targetId: options.targetId,
			itemName: "__placeholder__",
		},
		item: { name: "__placeholder__" },
		baseDir: options.repoRoot,
	});
}

function resolveTargetCommands(
	commands: SlashCommandDefinition[],
	targetName: TargetName,
	request: SyncRequest,
	allTargets: string[],
): SlashCommandDefinition[] {
	return commands.filter((command) => {
		const effectiveTargets = resolveEffectiveTargets({
			defaultTargets: command.targetAgents,
			overrideOnly: request.overrideOnly ?? undefined,
			overrideSkip: request.overrideSkip ?? undefined,
			allTargets,
		});
		if (effectiveTargets.length === 0) {
			return false;
		}
		return effectiveTargets.some((agent) => normalizeName(agent) === targetName);
	});
}

type SourceCountRequest = Pick<SyncRequest, "overrideOnly" | "overrideSkip" | "excludeLocal">;

function buildSourceCounts(
	commands: SlashCommandDefinition[],
	targets: TargetName[],
	allTargets: string[],
	request: SourceCountRequest,
): SyncSourceCounts {
	const targetSet = new Set(targets.map((target) => normalizeName(target)));
	const counts: SyncSourceCounts = {
		shared: 0,
		local: 0,
		excludedLocal: request.excludeLocal ?? false,
	};
	for (const command of commands) {
		const effectiveTargets = resolveEffectiveTargets({
			defaultTargets: command.targetAgents,
			overrideOnly: request.overrideOnly ?? undefined,
			overrideSkip: request.overrideSkip ?? undefined,
			allTargets,
		});
		if (effectiveTargets.length === 0) {
			continue;
		}
		if (!effectiveTargets.some((agent) => targetSet.has(normalizeName(agent)))) {
			continue;
		}
		if (command.sourceType === "local") {
			counts.local += 1;
		} else {
			counts.shared += 1;
		}
	}
	return counts;
}

function buildInvalidTargetWarnings(commands: SlashCommandDefinition[]): string[] {
	const warnings: string[] = [];
	for (const command of commands) {
		if (command.invalidTargets.length === 0) {
			continue;
		}
		const invalidList = command.invalidTargets.join(", ");
		warnings.push(
			`Slash command "${command.name}" has unsupported targets (${invalidList}) in ${command.sourcePath}.`,
		);
	}
	return warnings;
}

function applyTemplatingToCommand(
	command: SlashCommandDefinition,
	targetName: TargetName,
	validAgents: string[],
): SlashCommandDefinition {
	const templatedContents = applyAgentTemplating({
		content: command.rawContents,
		target: targetName,
		validAgents,
		sourcePath: command.sourcePath,
	});
	const { frontmatter, body } = extractFrontmatter(templatedContents);
	return {
		...command,
		rawContents: templatedContents,
		frontmatter,
		prompt: body.trimEnd(),
	};
}

function buildActionSummary(actions: PlannedAction[], targets: TargetName[]): SyncPlan {
	const summary: Record<TargetName, SummaryCounts> = Object.fromEntries(
		targets.map((name) => [name, emptySummaryCounts()]),
	) as Record<TargetName, SummaryCounts>;
	for (const action of actions) {
		const counts = summary[action.targetName] ?? emptySummaryCounts();
		if (action.action === "create") {
			counts.create += 1;
		} else if (action.action === "update") {
			counts.update += 1;
		} else if (action.action === "remove") {
			counts.remove += 1;
		} else if (action.action === "convert") {
			counts.convert += 1;
		} else if (action.action === "skip") {
			counts.skip += 1;
		}
		summary[action.targetName] = counts;
	}

	const planActions: SyncPlanAction[] = actions.map((action) => ({
		targetName: action.targetName,
		action: action.action,
		commandName: action.commandName,
		scope: action.scope,
	}));

	return { actions: planActions, summary };
}

async function buildTargetPlan(
	params: {
		request: SyncRequest;
		commands: SlashCommandDefinition[];
		conflictResolution: ConflictResolution;
		removeMissing: boolean;
		timestamp: string;
		validAgents: string[];
		allTargets: string[];
	},
	target: ResolvedTarget,
): Promise<{ plan: TargetPlan; conflicts: number }> {
	const { request, commands, conflictResolution, validAgents, allTargets } = params;
	const targetName = target.id;
	const displayName = target.displayName;
	const commandDef = normalizeCommandOutputDefinition(target.outputs.commands);
	const skillDef = normalizeOutputDefinition(target.outputs.skills);
	const targetCommands = resolveTargetCommands(commands, targetName, request, allTargets);
	const summary = emptySummaryCounts();
	const actions: PlannedAction[] = [];
	let conflicts = 0;

	let mode: "commands" | "skills" | "skip" = "commands";
	let outputKind: OutputKind | null = "command";

	if (!commandDef || commandDef.fallback?.mode === "skip") {
		mode = "skip";
		outputKind = null;
	} else if (
		commandDef.fallback?.mode === "convert" &&
		commandDef.fallback.targetType === "skills"
	) {
		if (!skillDef) {
			throw new Error(`Missing skills output for ${targetName} fallback.`);
		}
		mode = "skills";
		outputKind = "skill";
	}

	if (mode === "skip" || !outputKind) {
		for (const command of targetCommands) {
			actions.push({
				targetName,
				action: "skip",
				commandName: command.name,
				scope: null,
			});
			summary.skip += 1;
		}
		return {
			plan: {
				targetName,
				displayName,
				scope: null,
				mode,
				outputKind: null,
				destinationDir: null,
				manifestPath: null,
				legacyManifestPaths: [],
				actions,
				summary,
				nextManaged: new Map(),
				previousManaged: new Map(),
				removeMissing: params.removeMissing,
			},
			conflicts,
		};
	}

	const homeDir = os.homedir();
	const agentsDirPath = resolveAgentsDirPath(request.repoRoot, request.agentsDir);
	let scope: Scope | null = null;
	let destinationDir: string | null = null;
	let extension = ".md";

	if (mode === "commands" && commandDef) {
		const supportedScopes: Scope[] = [];
		if (commandDef.projectPath) {
			supportedScopes.push("project");
		}
		if (commandDef.userPath) {
			supportedScopes.push("global");
		}
		if (supportedScopes.length === 0) {
			throw new Error(`Target ${targetName} does not define a command output path.`);
		}
		const requestedScope = request.scopeByTarget?.[targetName];
		scope = requestedScope ?? (supportedScopes.includes("project") ? "project" : "global");
		if (!supportedScopes.includes(scope)) {
			throw new Error(`Target ${targetName} does not support ${scope} scope.`);
		}
		const templatePath = resolveCommandTemplatePath({
			commandDef,
			scope,
			repoRoot: request.repoRoot,
			homeDir,
			agentsDir: agentsDirPath,
			targetId: targetName,
		});
		destinationDir = path.dirname(templatePath);
		extension = path.extname(templatePath);
	} else if (mode === "skills" && skillDef) {
		const templatePath = resolveSkillTemplatePath({
			skillDef,
			repoRoot: request.repoRoot,
			homeDir,
			agentsDir: agentsDirPath,
			targetId: targetName,
		});
		destinationDir = path.dirname(templatePath);
		scope = isWithinDir(homeDir, destinationDir) ? "global" : "project";
		if (commandDef) {
			const fallbackScope: Scope = commandDef.projectPath ? "project" : "global";
			const commandTemplate = resolveCommandTemplatePath({
				commandDef,
				scope: fallbackScope,
				repoRoot: request.repoRoot,
				homeDir,
				agentsDir: agentsDirPath,
				targetId: targetName,
			});
			extension = path.extname(commandTemplate);
		}
	}

	if (!scope || !destinationDir) {
		throw new Error(`Unable to resolve command outputs for target ${targetName}.`);
	}
	const manifestPath = resolveProjectManifestPath(targetName, scope, request.repoRoot, homeDir);
	const existingNames =
		outputKind === "skill" ? new Set<string>() : await listExistingNames(destinationDir, extension);
	const reservedNames = new Set(existingNames);

	const legacyManifestPaths = new Set<string>();
	legacyManifestPaths.add(resolveManifestPath(destinationDir));
	legacyManifestPaths.add(
		path.join(request.repoRoot, ".omniagent", "slash-commands", `${targetName}-${scope}.toml`),
	);
	legacyManifestPaths.add(
		resolveLegacyProjectManifestPath(targetName, scope, request.repoRoot, homeDir),
	);
	if (outputKind === "skill") {
		legacyManifestPaths.add(resolveManifestPath(path.dirname(destinationDir)));
		legacyManifestPaths.add(
			resolveLegacySkillManifestPath(targetName, scope, request.repoRoot, homeDir),
		);
	}
	legacyManifestPaths.delete(manifestPath);

	const manifest = await readManifest(manifestPath);
	const previousManaged = new Map<string, ManagedCommand>();
	const legacyManagedNames = new Set<string>();
	if (manifest && manifest.targetName === targetName && manifest.scope === scope) {
		for (const entry of manifest.managedCommands) {
			previousManaged.set(normalizeName(entry.name), entry);
		}
	}
	for (const legacyPath of legacyManifestPaths) {
		const legacyManifest = await readManifest(legacyPath);
		if (
			legacyManifest &&
			legacyManifest.targetName === targetName &&
			legacyManifest.scope === scope
		) {
			for (const entry of legacyManifest.managedCommands) {
				const nameKey = normalizeName(entry.name);
				if (!previousManaged.has(nameKey)) {
					previousManaged.set(nameKey, entry);
				}
				legacyManagedNames.add(nameKey);
			}
		}
	}

	const nextManaged = new Map<string, ManagedCommand>();
	const catalogNames = new Set<string>();
	const legacyCleanupPaths = new Set<string>();

	for (const command of targetCommands) {
		const templatedCommand = applyTemplatingToCommand(command, targetName, validAgents);
		const nameKey = normalizeName(command.name);
		catalogNames.add(nameKey);

		const { destinationPath } = resolveOutputPath(
			command.name,
			destinationDir,
			outputKind,
			extension,
		);
		const output = renderOutput(templatedCommand, outputKind, destinationPath);
		const outputHash = hashContent(output);
		const existingContent = await readFileIfExists(destinationPath);
		const existingHash = existingContent ? hashContent(existingContent) : null;
		const previousEntry = previousManaged.get(nameKey);

		if (outputKind === "skill") {
			const legacyPath = path.join(destinationDir, `${command.name}${extension}`);
			const legacyContent = await readFileIfExists(legacyPath);
			if (legacyContent) {
				const legacyHash = hashContent(legacyContent);
				if (legacyHash === outputHash || legacyManagedNames.has(nameKey)) {
					legacyCleanupPaths.add(legacyPath);
				}
			}
		}

		if (!existingContent) {
			const actionType = outputKind === "skill" ? "convert" : "create";
			const managedEntry = {
				name: command.name,
				hash: outputHash,
				lastSyncedAt: params.timestamp,
			};
			actions.push({
				targetName,
				action: actionType,
				commandName: command.name,
				scope,
				destinationPath,
				contents: output,
				hash: outputHash,
			});
			if (actionType === "create") {
				summary.create += 1;
			} else {
				summary.convert += 1;
			}
			nextManaged.set(nameKey, managedEntry);
			reservedNames.add(nameKey);
			continue;
		}

		if (existingHash === outputHash) {
			if (previousEntry && previousEntry.hash === outputHash) {
				nextManaged.set(nameKey, previousEntry);
			} else {
				const managedEntry = {
					name: command.name,
					hash: outputHash,
					lastSyncedAt: params.timestamp,
				};
				nextManaged.set(nameKey, managedEntry);
			}
			reservedNames.add(nameKey);
			continue;
		}

		if (previousEntry) {
			const actionType = outputKind === "skill" ? "convert" : "update";
			const managedEntry = {
				name: command.name,
				hash: outputHash,
				lastSyncedAt: params.timestamp,
			};
			actions.push({
				targetName,
				action: actionType,
				commandName: command.name,
				scope,
				destinationPath,
				contents: output,
				hash: outputHash,
			});
			if (actionType === "update") {
				summary.update += 1;
			} else {
				summary.convert += 1;
			}
			nextManaged.set(nameKey, managedEntry);
			reservedNames.add(nameKey);
			continue;
		}

		conflicts += 1;
		if (conflictResolution === "skip") {
			actions.push({
				targetName,
				action: "skip",
				commandName: command.name,
				scope,
				conflict: true,
			});
			summary.skip += 1;
			if (previousEntry) {
				nextManaged.set(nameKey, previousEntry);
			}
			continue;
		}

		let backupPath: string | undefined;
		if (conflictResolution === "rename") {
			if (outputKind === "skill") {
				backupPath = await resolveSkillBackupPath(destinationPath);
			} else {
				let suffix = 1;
				let candidate = `${command.name}-backup`;
				while (reservedNames.has(normalizeName(candidate))) {
					suffix += 1;
					candidate = `${command.name}-backup-${suffix}`;
				}
				reservedNames.add(normalizeName(candidate));
				backupPath = path.join(destinationDir, `${candidate}${extension}`);
			}
		}

		const actionType = outputKind === "skill" ? "convert" : "update";
		const managedEntry = {
			name: command.name,
			hash: outputHash,
			lastSyncedAt: params.timestamp,
		};
		actions.push({
			targetName,
			action: actionType,
			commandName: command.name,
			scope,
			destinationPath,
			contents: output,
			hash: outputHash,
			backupPath,
			conflict: true,
		});
		if (actionType === "update") {
			summary.update += 1;
		} else {
			summary.convert += 1;
		}
		nextManaged.set(nameKey, managedEntry);
		reservedNames.add(nameKey);
	}

	if (legacyCleanupPaths.size > 0) {
		for (const cleanupPath of legacyCleanupPaths) {
			actions.push({
				targetName,
				action: "remove",
				commandName: path.basename(cleanupPath, extension),
				scope,
				destinationPath: cleanupPath,
			});
			summary.remove += 1;
		}
	}

	if (params.removeMissing && previousManaged.size > 0) {
		for (const entry of previousManaged.values()) {
			if (catalogNames.has(normalizeName(entry.name))) {
				continue;
			}
			const { destinationPath, containerDir } = resolveOutputPath(
				entry.name,
				destinationDir,
				outputKind,
				extension,
			);
			const removalPath = outputKind === "skill" ? containerDir : destinationPath;
			actions.push({
				targetName,
				action: "remove",
				commandName: entry.name,
				scope,
				destinationPath: removalPath,
			});
			summary.remove += 1;

			if (outputKind === "skill") {
				const legacyPath = path.join(destinationDir, `${entry.name}${extension}`);
				if (legacyManagedNames.has(normalizeName(entry.name)) || (await pathExists(legacyPath))) {
					actions.push({
						targetName,
						action: "remove",
						commandName: entry.name,
						scope,
						destinationPath: legacyPath,
					});
					summary.remove += 1;
				}
			}
		}
	} else if (!params.removeMissing && previousManaged.size > 0) {
		for (const entry of previousManaged.values()) {
			if (!catalogNames.has(normalizeName(entry.name))) {
				nextManaged.set(normalizeName(entry.name), entry);
			}
		}
	}

	return {
		plan: {
			targetName,
			displayName,
			scope,
			mode: mode,
			outputKind: outputKind,
			destinationDir,
			manifestPath,
			legacyManifestPaths: Array.from(legacyManifestPaths),
			actions,
			summary,
			nextManaged,
			previousManaged,
			removeMissing: params.removeMissing,
		},
		conflicts,
	};
}

export async function planSlashCommandSync(request: SyncRequest): Promise<SyncPlanDetails> {
	const resolvedTargets =
		request.resolvedTargets ??
		resolveTargets({
			config: request.config ?? null,
			builtIns: BUILTIN_TARGETS,
		}).targets;
	const targetResolver = createTargetNameResolver(resolvedTargets);
	const resolveTargetName = request.resolveTargetName ?? targetResolver.resolveTargetName;
	const catalog = await loadCommandCatalog(request.repoRoot, {
		includeLocal: !request.excludeLocal,
		agentsDir: request.agentsDir,
		resolveTargetName,
	});
	const allTargetIds = resolvedTargets.map((target) => target.id);
	const selectedTargets: ResolvedTarget[] =
		request.targets && request.targets.length > 0
			? request.targets.map((targetName) => {
					const resolved = resolveTargetName(targetName);
					if (!resolved) {
						throw new Error(`Unknown slash command target: ${targetName}`);
					}
					const target = resolvedTargets.find((entry) => entry.id === resolved);
					if (!target) {
						throw new Error(`Unknown slash command target: ${targetName}`);
					}
					return target;
				})
			: resolvedTargets;
	const selectedTargetIds = selectedTargets.map((target) => target.id);
	const validAgents = request.validAgents ?? buildSupportedAgentNames(resolvedTargets);
	const conflictResolution = request.conflictResolution ?? DEFAULT_CONFLICT_RESOLUTION;
	const removeMissing = request.removeMissing ?? true;
	const timestamp = new Date().toISOString();

	const targetPlans: TargetPlan[] = [];
	let conflicts = 0;
	for (const target of selectedTargets) {
		const { plan, conflicts: targetConflicts } = await buildTargetPlan(
			{
				request: {
					...request,
					removeMissing,
				},
				commands: catalog.commands,
				conflictResolution,
				removeMissing,
				timestamp,
				validAgents,
				allTargets: allTargetIds,
			},
			target,
		);
		conflicts += targetConflicts;
		targetPlans.push(plan);
	}

	const actions = targetPlans.flatMap((plan) => plan.actions);
	const planSummary = buildActionSummary(actions, selectedTargetIds);
	const targetSummaries: TargetPlanSummary[] = targetPlans.map((plan) => ({
		targetName: plan.targetName,
		displayName: plan.displayName,
		scope: plan.scope,
		mode: plan.mode,
		counts: plan.summary,
	}));

	return {
		sourcePath: catalog.commandsPath,
		plan: planSummary,
		targetPlans,
		targetSummaries,
		conflicts,
		warnings: buildInvalidTargetWarnings(catalog.commands),
		sourceCounts: buildSourceCounts(catalog.commands, selectedTargetIds, allTargetIds, request),
	};
}

async function ensureDirectory(dirPath: string): Promise<void> {
	await mkdir(dirPath, { recursive: true });
}

async function applyAction(action: PlannedAction): Promise<void> {
	if (!action.destinationPath) {
		return;
	}
	const destinationDir = path.dirname(action.destinationPath);
	await ensureDirectory(destinationDir);

	if (action.action === "remove") {
		await rm(action.destinationPath, { force: true, recursive: true });
		return;
	}

	if (action.backupPath) {
		try {
			await rename(action.destinationPath, action.backupPath);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "ENOENT") {
				throw error;
			}
		}
	}

	if (action.contents !== undefined) {
		await writeFile(action.destinationPath, action.contents, "utf8");
	}
}

export async function applySlashCommandSync(planDetails: SyncPlanDetails): Promise<SyncSummary> {
	const results: SyncResult[] = [];
	let hadFailures = false;

	for (const targetPlan of planDetails.targetPlans) {
		const counts = {
			created: 0,
			updated: 0,
			removed: 0,
			converted: 0,
			skipped: 0,
		};
		let hadError = false;
		let errorMessage: string | null = null;
		const managed = new Map(targetPlan.nextManaged);

		if (targetPlan.mode === "skip") {
			counts.skipped = targetPlan.summary.skip;
			results.push({
				targetName: targetPlan.targetName,
				status: "skipped",
				message: `Skipped ${targetPlan.displayName}.`,
				counts,
			});
			continue;
		}

		for (const action of targetPlan.actions) {
			if (action.action === "skip") {
				counts.skipped += 1;
				continue;
			}

			try {
				await applyAction(action);
				if (action.action === "create") {
					counts.created += 1;
				} else if (action.action === "update") {
					counts.updated += 1;
				} else if (action.action === "remove") {
					counts.removed += 1;
				} else if (action.action === "convert") {
					counts.converted += 1;
				}
			} catch (error) {
				hadError = true;
				hadFailures = true;
				const message = error instanceof Error ? error.message : String(error);
				errorMessage = errorMessage ? `${errorMessage}; ${message}` : message;
				const nameKey = normalizeName(action.commandName);
				if (action.action === "remove") {
					const previous = targetPlan.previousManaged.get(nameKey);
					if (previous) {
						managed.set(nameKey, previous);
					}
				} else {
					managed.delete(nameKey);
				}
			}
		}

		const totalApplied = counts.created + counts.updated + counts.removed + counts.converted;
		const managedChanged = !areManagedCommandsEqual(targetPlan.previousManaged, managed);

		if (targetPlan.manifestPath && targetPlan.scope) {
			if (totalApplied > 0 || managedChanged) {
				try {
					const manifest: SyncStateManifest = {
						targetName: targetPlan.targetName,
						scope: targetPlan.scope,
						managedCommands: Array.from(managed.values()),
					};
					await ensureDirectory(path.dirname(targetPlan.manifestPath));
					await writeManifest(targetPlan.manifestPath, manifest);
				} catch (error) {
					hadError = true;
					hadFailures = true;
					const message = error instanceof Error ? error.message : String(error);
					errorMessage = errorMessage ? `${errorMessage}; ${message}` : message;
				}
			}
		}

		if (!hadError && targetPlan.legacyManifestPaths.length > 0) {
			for (const legacyPath of targetPlan.legacyManifestPaths) {
				await rm(legacyPath, { force: true });
			}
		}

		const status = hadError ? (totalApplied > 0 ? "partial" : "failed") : "synced";
		results.push({
			targetName: targetPlan.targetName,
			status,
			message: formatResultMessage(
				targetPlan.displayName,
				status,
				targetPlan.scope,
				counts,
				errorMessage,
			),
			error: errorMessage,
			counts,
		});
	}

	return {
		sourcePath: planDetails.sourcePath,
		results,
		warnings: planDetails.warnings,
		hadFailures,
		sourceCounts: planDetails.sourceCounts,
	};
}

function formatResultMessage(
	displayName: string,
	status: SyncResult["status"],
	scope: Scope | null,
	counts: SyncResult["counts"],
	error?: string | null,
): string {
	const scopeLabel = scope ? ` (${scope})` : "";
	const verb =
		status === "synced"
			? "Synced"
			: status === "skipped"
				? "Skipped"
				: status === "partial"
					? "Partially synced"
					: "Failed";
	const countMessage =
		`created ${counts.created}, updated ${counts.updated}, removed ${counts.removed}, ` +
		`converted ${counts.converted}, skipped ${counts.skipped}`;
	const suffix = error ? ` (${error})` : "";
	if (
		status === "synced" &&
		counts.created === 0 &&
		counts.updated === 0 &&
		counts.removed === 0 &&
		counts.converted === 0 &&
		counts.skipped === 0
	) {
		return `No changes for ${displayName}${scopeLabel}.`;
	}
	return `${verb} ${displayName}${scopeLabel}: ${countMessage}${suffix}`;
}

export function formatSyncSummary(summary: SyncSummary, jsonOutput: boolean): string {
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

export function formatPlanSummary(plan: SyncPlan, targetSummaries: TargetPlanSummary[]): string {
	const lines: string[] = ["Planned actions:"];
	const ordered = targetSummaries.length > 0 ? targetSummaries : [];
	for (const target of ordered) {
		const counts = target.counts;
		const scopeLabel = target.scope ? ` (${target.scope})` : "";
		const modeLabel =
			target.mode === "skills" ? " [skills]" : target.mode === "skip" ? " [skip]" : "";
		lines.push(
			`${target.displayName}${scopeLabel}${modeLabel}: ` +
				`create ${counts.create}, update ${counts.update}, remove ${counts.remove}, ` +
				`convert ${counts.convert}, skip ${counts.skip}`,
		);
	}
	if (ordered.length === 0) {
		for (const [targetName, counts] of Object.entries(plan.summary)) {
			lines.push(
				`${targetName}: ` +
					`create ${counts.create}, update ${counts.update}, remove ${counts.remove}, ` +
					`convert ${counts.convert}, skip ${counts.skip}`,
			);
		}
	}
	return lines.join("\n");
}

type CommandOutputCandidate = {
	target: ResolvedTarget;
	command: SlashCommandDefinition;
	templated: SlashCommandDefinition;
	outputPath: string;
	outputKind: "command" | "skill";
	location: "project" | "user";
	writer: OutputWriter | null;
	converter: ConverterRule | null;
};

function renderCommandOutput(
	command: SlashCommandDefinition,
	outputKind: "command" | "skill",
	outputPath: string,
): string {
	if (outputKind === "skill") {
		return renderSkillFromCommand(command);
	}
	return getCommandFormat(outputPath) === "toml"
		? renderTomlCommand(command)
		: renderMarkdownCommand(command);
}

async function ensureBackupPath(outputPath: string): Promise<string> {
	const dir = path.dirname(outputPath);
	const ext = path.extname(outputPath);
	const base = path.basename(outputPath, ext);
	let suffix = 0;
	while (true) {
		const backupName = suffix === 0 ? `${base}-backup${ext}` : `${base}-backup-${suffix}${ext}`;
		const candidate = path.join(dir, backupName);
		try {
			await stat(candidate);
			suffix += 1;
		} catch {
			return candidate;
		}
	}
}

export async function syncSlashCommands(request: SyncRequestV2): Promise<SyncSummary> {
	const catalog = await loadCommandCatalog(request.repoRoot, {
		includeLocal: !request.excludeLocal,
		agentsDir: request.agentsDir,
		resolveTargetName: request.resolveTargetName,
	});
	const targets = request.targets.filter(
		(target) => normalizeCommandOutputDefinition(target.outputs.commands) !== null,
	);
	if (targets.length === 0) {
		return {
			sourcePath: catalog.commandsPath,
			results: [],
			warnings: [],
			hadFailures: false,
			sourceCounts: {
				shared: 0,
				local: 0,
				excludedLocal: request.excludeLocal ?? false,
			},
		};
	}

	const warnings = buildInvalidTargetWarnings(catalog.commands);
	const removeMissing = request.removeMissing ?? false;
	const allTargetIds = request.targets.map((target) => target.id);
	const activeTargetIds = new Set(targets.map((target) => target.id));
	const effectiveTargetsByCommand = new Map<SlashCommandDefinition, string[]>();
	const activeSourcesByTarget = new Map<string, Set<string>>();
	for (const command of catalog.commands) {
		const effectiveTargets = resolveEffectiveTargets({
			defaultTargets: command.targetAgents,
			overrideOnly: request.overrideOnly ?? undefined,
			overrideSkip: request.overrideSkip ?? undefined,
			allTargets: allTargetIds,
		});
		effectiveTargetsByCommand.set(command, effectiveTargets);
		for (const targetId of effectiveTargets) {
			if (!activeTargetIds.has(targetId)) {
				continue;
			}
			const existing = activeSourcesByTarget.get(targetId) ?? new Set<string>();
			existing.add(command.name);
			activeSourcesByTarget.set(targetId, existing);
		}
	}

	const sourceCounts: SyncSourceCounts = buildSourceCounts(
		catalog.commands,
		targets.map((target) => target.id),
		allTargetIds,
		{
			overrideOnly: request.overrideOnly ?? undefined,
			overrideSkip: request.overrideSkip ?? undefined,
			excludeLocal: request.excludeLocal,
		},
	);

	const agentsDirPath = resolveAgentsDirPath(request.repoRoot, request.agentsDir);
	const homeDir = os.homedir();
	const managedManifest = (await readManagedOutputs(request.repoRoot, homeDir)) ?? { entries: [] };
	const nextManaged = new Map<string, ManagedOutputRecord>();
	const activeOutputPaths = new Set<string>();
	const countsByTarget = new Map<string, SyncResult["counts"]>();
	const getCounts = (targetId: string): SyncResult["counts"] => {
		const existing = countsByTarget.get(targetId) ?? emptyResultCounts();
		countsByTarget.set(targetId, existing);
		return existing;
	};
	const converterRegistry: ConverterRegistry = new Map();
	const writerRegistry: WriterRegistry = new Map();
	const validAgents = request.validAgents ?? buildSupportedAgentNames(request.targets);
	const commandDefs = new Map<
		string,
		NonNullable<ReturnType<typeof normalizeCommandOutputDefinition>>
	>();
	const skillDefs = new Map<string, NonNullable<ReturnType<typeof normalizeOutputDefinition>>>();
	for (const target of targets) {
		const commandDef = normalizeCommandOutputDefinition(target.outputs.commands);
		if (commandDef) {
			commandDefs.set(target.id, commandDef);
		}
		const skillDef = normalizeOutputDefinition(target.outputs.skills);
		if (skillDef) {
			skillDefs.set(target.id, skillDef);
		}
	}

	const targetErrors = new Map<string, string[]>();
	const recordError = (targetId: string, message: string) => {
		const existing = targetErrors.get(targetId) ?? [];
		existing.push(message);
		targetErrors.set(targetId, existing);
	};
	const converterErrorsByTarget = new Map<string, Set<string>>();
	const formatItemError = (itemLabel: string, message: string) => `${itemLabel}: ${message}`;
	const recordItemError = (targetId: string, itemLabel: string, message: string) => {
		recordError(targetId, formatItemError(itemLabel, message));
	};
	const recordConverterError = (targetId: string, itemLabel: string, message: string) => {
		recordItemError(targetId, itemLabel, message);
		const existing = converterErrorsByTarget.get(targetId) ?? new Set<string>();
		existing.add(itemLabel);
		converterErrorsByTarget.set(targetId, existing);
	};

	const candidatesByPath = new Map<string, CommandOutputCandidate[]>();
	for (const command of catalog.commands) {
		const effectiveTargets = effectiveTargetsByCommand.get(command) ?? [];
		if (effectiveTargets.length === 0) {
			continue;
		}
		for (const target of targets) {
			if (!effectiveTargets.includes(target.id)) {
				continue;
			}
			const commandDef = commandDefs.get(target.id);
			if (!commandDef) {
				continue;
			}
			if (commandDef.fallback?.mode === "skip") {
				continue;
			}
			let outputKind: "command" | "skill" = "command";
			let commandPaths: Array<{ location: "project" | "user"; path: string }> = [];
			if (commandDef.fallback?.mode === "convert" && commandDef.fallback.targetType === "skills") {
				const skillDef = skillDefs.get(target.id);
				if (!skillDef) {
					recordError(target.id, `Missing skills output for ${target.id} fallback.`);
					continue;
				}
				outputKind = "skill";
				const basePath = resolveTargetOutputPath({
					template: skillDef.path,
					context: {
						repoRoot: request.repoRoot,
						agentsDir: agentsDirPath,
						homeDir,
						targetId: target.id,
						itemName: command.name,
					},
					item: command,
					baseDir: request.repoRoot,
				});
				commandPaths = [{ location: "project", path: path.join(basePath, "SKILL.md") }];
			} else {
				if (commandDef.projectPath) {
					const resolved = resolveCommandOutputPath({
						template: commandDef.projectPath,
						context: {
							repoRoot: request.repoRoot,
							agentsDir: agentsDirPath,
							homeDir,
							targetId: target.id,
							itemName: command.name,
							commandLocation: "project",
						},
						item: command,
						baseDir: request.repoRoot,
					});
					commandPaths.push({ location: "project", path: resolved });
				}
				if (commandDef.userPath) {
					const resolved = resolveCommandOutputPath({
						template: commandDef.userPath,
						context: {
							repoRoot: request.repoRoot,
							agentsDir: agentsDirPath,
							homeDir,
							targetId: target.id,
							itemName: command.name,
							commandLocation: "user",
						},
						item: command,
						baseDir: homeDir,
					});
					commandPaths.push({ location: "user", path: resolved });
				}
			}
			const templated = applyTemplatingToCommand(command, target.id, validAgents);
			const writer = resolveWriter(commandDef.writer, writerRegistry);
			const converter = resolveConverter(commandDef.converter, converterRegistry);
			for (const entry of commandPaths) {
				const key = path.normalize(entry.path).replace(/\\/g, "/").toLowerCase();
				const list = candidatesByPath.get(key) ?? [];
				list.push({
					target,
					command,
					templated,
					outputPath: entry.path,
					outputKind,
					location: entry.location,
					writer,
					converter,
				});
				candidatesByPath.set(key, list);
			}
		}
	}

	for (const target of targets) {
		await runSyncHook(request.hooks, "preSync", {
			repoRoot: request.repoRoot,
			agentsDir: agentsDirPath,
			targetId: target.id,
			outputType: "commands",
		});
		await runSyncHook(target.hooks, "preSync", {
			repoRoot: request.repoRoot,
			agentsDir: agentsDirPath,
			targetId: target.id,
			outputType: "commands",
		});
	}

	for (const candidates of candidatesByPath.values()) {
		if (candidates.length === 0) {
			continue;
		}
		if (candidates.length > 1) {
			for (const candidate of candidates) {
				recordError(candidate.target.id, `Command output collision at ${candidate.outputPath}.`);
			}
			continue;
		}
		const selected = candidates[0];
		const target = selected.target;
		const itemLabel = selected.command.name;
		const recordManagedOutput = (entry: ManagedOutputRecord) => {
			const managedKey = buildManagedOutputKey(entry);
			nextManaged.set(managedKey, entry);
			activeOutputPaths.add(normalizeManagedOutputPath(entry.outputPath));
		};
		const counts = getCounts(target.id);

		let converterActive = false;
		try {
			if (selected.converter) {
				converterActive = true;
				await runConvertHook(request.hooks, "preConvert", {
					repoRoot: request.repoRoot,
					agentsDir: agentsDirPath,
					targetId: target.id,
					outputType: "commands",
				});
				await runConvertHook(target.hooks, "preConvert", {
					repoRoot: request.repoRoot,
					agentsDir: agentsDirPath,
					targetId: target.id,
					outputType: "commands",
				});
				const decision = await selected.converter.convert(selected.templated, {
					repoRoot: request.repoRoot,
					agentsDir: agentsDirPath,
					homeDir,
					targetId: target.id,
					outputType: "commands",
					commandLocation: selected.location,
					validAgents,
				});
				const normalized = normalizeConverterDecision(decision);
				await runConvertHook(request.hooks, "postConvert", {
					repoRoot: request.repoRoot,
					agentsDir: agentsDirPath,
					targetId: target.id,
					outputType: "commands",
				});
				await runConvertHook(target.hooks, "postConvert", {
					repoRoot: request.repoRoot,
					agentsDir: agentsDirPath,
					targetId: target.id,
					outputType: "commands",
				});
				if (normalized.error) {
					recordConverterError(target.id, itemLabel, normalized.error);
					converterActive = false;
					continue;
				}
				if (normalized.skip) {
					counts.skipped += 1;
					converterActive = false;
					continue;
				}
				for (const output of normalized.outputs) {
					const outputPath = path.isAbsolute(output.outputPath)
						? output.outputPath
						: path.resolve(request.repoRoot, output.outputPath);
					const result = await writeFileOutput(outputPath, output.content);
					const checksum = result.contentHash ?? (await hashOutputPath(outputPath));
					if (checksum) {
						recordManagedOutput({
							targetId: target.id,
							outputPath,
							sourceType: "command",
							sourceId: selected.command.name,
							checksum,
							lastSyncedAt: new Date().toISOString(),
						});
					}
				}
				counts.converted += 1;
				converterActive = false;
				continue;
			}

			const content = renderCommandOutput(
				selected.templated,
				selected.outputKind,
				selected.outputPath,
			);
			if (selected.writer) {
				const writeResult = await selected.writer.write({
					outputPath: selected.outputPath,
					content,
					item: selected.templated,
					context: {
						repoRoot: request.repoRoot,
						agentsDir: agentsDirPath,
						homeDir,
						targetId: target.id,
						outputType: "commands",
						commandLocation: selected.location,
						validAgents,
					},
				});
				const checksum = writeResult.contentHash ?? (await hashOutputPath(selected.outputPath));
				if (checksum) {
					recordManagedOutput({
						targetId: target.id,
						outputPath: selected.outputPath,
						sourceType: "command",
						sourceId: selected.command.name,
						checksum,
						lastSyncedAt: new Date().toISOString(),
						writerId: selected.writer.id,
					});
				}
				if (selected.outputKind === "skill") {
					if (writeResult.status === "skipped") {
						counts.skipped += 1;
					} else {
						counts.converted += 1;
					}
				} else if (writeResult.status === "created") {
					counts.created += 1;
				} else if (writeResult.status === "updated") {
					counts.updated += 1;
				} else {
					counts.skipped += 1;
				}
			} else {
				const exists = await pathExists(selected.outputPath);
				if (exists && request.conflictResolution === "skip") {
					counts.skipped += 1;
					continue;
				}
				if (exists && request.conflictResolution === "rename") {
					const backupPath = await ensureBackupPath(selected.outputPath);
					await rename(selected.outputPath, backupPath);
				}
				const writeResult = await writeFileOutput(selected.outputPath, content);
				const checksum = writeResult.contentHash ?? (await hashOutputPath(selected.outputPath));
				if (checksum) {
					recordManagedOutput({
						targetId: target.id,
						outputPath: selected.outputPath,
						sourceType: "command",
						sourceId: selected.command.name,
						checksum,
						lastSyncedAt: new Date().toISOString(),
					});
				}
				if (selected.outputKind === "skill") {
					if (writeResult.status === "skipped") {
						counts.skipped += 1;
					} else {
						counts.converted += 1;
					}
				} else if (writeResult.status === "created") {
					counts.created += 1;
				} else if (writeResult.status === "updated") {
					counts.updated += 1;
				} else {
					counts.skipped += 1;
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (converterActive) {
				recordConverterError(target.id, itemLabel, message);
			} else {
				recordItemError(target.id, itemLabel, message);
			}
		}
	}

	for (const target of targets) {
		await runSyncHook(request.hooks, "postSync", {
			repoRoot: request.repoRoot,
			agentsDir: agentsDirPath,
			targetId: target.id,
			outputType: "commands",
		});
		await runSyncHook(target.hooks, "postSync", {
			repoRoot: request.repoRoot,
			agentsDir: agentsDirPath,
			targetId: target.id,
			outputType: "commands",
		});
	}

	if (managedManifest.entries.length > 0 || nextManaged.size > 0) {
		const updatedEntries: ManagedOutputRecord[] = [];
		for (const entry of managedManifest.entries) {
			if (entry.sourceType !== "command" || !activeTargetIds.has(entry.targetId)) {
				updatedEntries.push(entry);
				continue;
			}
			const key = buildManagedOutputKey(entry);
			if (nextManaged.has(key)) {
				continue;
			}
			const activeSources = activeSourcesByTarget.get(entry.targetId);
			const sourceStillActive = activeSources?.has(entry.sourceId) ?? false;
			if (!removeMissing || sourceStillActive) {
				updatedEntries.push(entry);
				continue;
			}
			const outputKey = normalizeManagedOutputPath(entry.outputPath);
			if (activeOutputPaths.has(outputKey)) {
				continue;
			}
			const existingHash = await hashOutputPath(entry.outputPath);
			if (!existingHash) {
				continue;
			}
			if (existingHash !== entry.checksum) {
				const display = formatDisplayPath(request.repoRoot, entry.outputPath);
				warnings.push(`Output modified since last sync; skipping removal of ${display}.`);
				updatedEntries.push(entry);
				continue;
			}
			try {
				await rm(entry.outputPath, { recursive: true, force: true });
				getCounts(entry.targetId).removed += 1;
			} catch (error) {
				const display = formatDisplayPath(request.repoRoot, entry.outputPath);
				warnings.push(`Failed to remove ${display}: ${String(error)}`);
				updatedEntries.push(entry);
			}
		}
		for (const entry of nextManaged.values()) {
			updatedEntries.push(entry);
		}
		await writeManagedOutputs(request.repoRoot, { entries: updatedEntries }, homeDir);
	}

	for (const target of targets) {
		const items = converterErrorsByTarget.get(target.id);
		if (items && items.size > 0) {
			warnings.push(
				`Converter errors in commands for ${target.displayName}: ${[...items].sort().join(", ")}.`,
			);
		}
	}

	const results: SyncResult[] = [];
	let hadFailures = false;
	for (const target of targets) {
		const errors = targetErrors.get(target.id);
		if (errors && errors.length > 0) {
			hadFailures = true;
			const combined = errors.join("; ");
			const counts = getCounts(target.id);
			const total =
				counts.created + counts.updated + counts.removed + counts.converted + counts.skipped;
			const status: SyncResult["status"] = total > 0 ? "partial" : "failed";
			results.push({
				targetName: target.id,
				status,
				message: formatResultMessage(target.displayName, status, null, counts, combined),
				error: combined,
				counts,
			});
		} else {
			const counts = getCounts(target.id);
			const status: SyncResult["status"] = "synced";
			results.push({
				targetName: target.id,
				status,
				message: formatResultMessage(target.displayName, status, null, counts),
				counts,
			});
		}
	}

	return {
		sourcePath: catalog.commandsPath,
		results,
		warnings,
		hadFailures,
		sourceCounts,
	};
}
