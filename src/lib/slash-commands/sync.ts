import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyAgentTemplating } from "../agent-templating.js";
import { SUPPORTED_AGENT_NAMES } from "../supported-targets.js";
import { loadCommandCatalog, type SlashCommandDefinition } from "./catalog.js";
import {
	renderClaudeCommand,
	renderCodexPrompt,
	renderGeminiCommand,
	renderSkillFromCommand,
} from "./formatting.js";
import { extractFrontmatter } from "./frontmatter.js";
import {
	type ManagedCommand,
	readManifest,
	resolveManifestPath,
	type SyncStateManifest,
	writeManifest,
} from "./manifest.js";
import {
	getDefaultScope,
	getTargetProfile,
	resolveCommandDestination,
	type Scope,
	SLASH_COMMAND_TARGETS,
	type TargetName,
} from "./targets.js";

export type ConflictResolution = "overwrite" | "rename" | "skip";
export type UnsupportedFallback = "convert_to_skills" | "skip";
export type CodexOption = "prompts" | "convert_to_skills" | "skip";
export type CodexConversionScope = "global" | "project" | "skip";

export type SyncRequest = {
	repoRoot: string;
	targets?: TargetName[];
	scopeByTarget?: Partial<Record<TargetName, Scope>>;
	conflictResolution?: ConflictResolution;
	removeMissing?: boolean;
	unsupportedFallback?: UnsupportedFallback;
	codexOption?: CodexOption;
	codexConversionScope?: CodexConversionScope;
	nonInteractive?: boolean;
	useDefaults?: boolean;
	validAgents?: string[];
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
	hadFailures: boolean;
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
};

const PROJECT_SKILL_PATHS: Record<TargetName, string> = {
	codex: path.join(".codex", "skills"),
	claude: path.join(".claude", "skills"),
	copilot: path.join(".github", "skills"),
	gemini: path.join(".gemini", "skills"),
};

const DEFAULT_CONFLICT_RESOLUTION: ConflictResolution = "skip";
const DEFAULT_UNSUPPORTED_FALLBACK: UnsupportedFallback = "skip";
const DEFAULT_CODEX_OPTION: CodexOption = "prompts";
const DEFAULT_CODEX_CONVERSION_SCOPE: CodexConversionScope = "global";

function emptySummaryCounts(): SummaryCounts {
	return { create: 0, update: 0, remove: 0, convert: 0, skip: 0 };
}

function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function hashIdentifier(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function normalizeName(name: string): string {
	return name.toLowerCase();
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

function getOutputExtension(targetName: TargetName, outputKind: OutputKind): string {
	if (outputKind === "command" && targetName === "gemini") {
		return ".toml";
	}
	return ".md";
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
	targetName: TargetName,
	outputKind: OutputKind,
): string {
	if (outputKind === "skill") {
		return renderSkillFromCommand(command);
	}
	if (targetName === "gemini") {
		return renderGeminiCommand(command);
	}
	if (targetName === "codex") {
		return renderCodexPrompt(command);
	}
	return renderClaudeCommand(command);
}

function resolveSkillDestination(
	targetName: TargetName,
	scope: Scope,
	repoRoot: string,
	homeDir: string,
): string {
	if (scope === "global") {
		if (targetName !== "codex") {
			throw new Error(`Global skills are only supported for codex right now (${targetName}).`);
		}
		return path.join(homeDir, PROJECT_SKILL_PATHS[targetName]);
	}
	return path.join(repoRoot, PROJECT_SKILL_PATHS[targetName]);
}

function isSkillScopeSupported(targetName: TargetName, scope: Scope): boolean {
	if (scope === "global") {
		return targetName === "codex";
	}
	return scope === "project";
}

function resolveTargetCommands(
	commands: SlashCommandDefinition[],
	targetName: TargetName,
): SlashCommandDefinition[] {
	return commands.filter((command) => {
		if (!command.targetAgents || command.targetAgents.length === 0) {
			return true;
		}
		return command.targetAgents.some((agent) => normalizeName(agent) === targetName);
	});
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

function resolveTargetMode(
	targetName: TargetName,
	profileSupportsSlash: boolean,
	unsupportedFallback: UnsupportedFallback,
	codexOption: CodexOption,
	codexConversionScope: CodexConversionScope,
): { mode: "commands" | "skills" | "skip"; scope: Scope | null; outputKind: OutputKind | null } {
	if (!profileSupportsSlash) {
		if (unsupportedFallback === "convert_to_skills") {
			return { mode: "skills", scope: "project", outputKind: "skill" };
		}
		return { mode: "skip", scope: null, outputKind: null };
	}

	if (targetName === "codex") {
		if (codexOption === "skip") {
			return { mode: "skip", scope: null, outputKind: null };
		}
		if (codexOption === "convert_to_skills") {
			const scope = codexConversionScope === "skip" ? null : codexConversionScope;
			if (!scope) {
				return { mode: "skip", scope: null, outputKind: null };
			}
			return { mode: "skills", scope, outputKind: "skill" };
		}
		return { mode: "commands", scope: "global", outputKind: "command" };
	}

	return { mode: "commands", scope: null, outputKind: "command" };
}

async function buildTargetPlan(
	params: {
		request: SyncRequest;
		commands: SlashCommandDefinition[];
		conflictResolution: ConflictResolution;
		unsupportedFallback: UnsupportedFallback;
		codexOption: CodexOption;
		codexConversionScope: CodexConversionScope;
		removeMissing: boolean;
		timestamp: string;
		validAgents: string[];
	},
	targetName: TargetName,
): Promise<{ plan: TargetPlan; conflicts: number }> {
	const {
		request,
		commands,
		conflictResolution,
		unsupportedFallback,
		codexOption,
		codexConversionScope,
		validAgents,
	} = params;
	const profile = getTargetProfile(targetName);
	const modeSelection = resolveTargetMode(
		targetName,
		profile.supportsSlashCommands,
		unsupportedFallback,
		codexOption,
		codexConversionScope,
	);
	const displayName = profile.displayName;
	const targetCommands = resolveTargetCommands(commands, targetName);
	const summary = emptySummaryCounts();
	const actions: PlannedAction[] = [];
	let conflicts = 0;

	if (modeSelection.mode === "skip" || !modeSelection.outputKind) {
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
				mode: "skip",
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

	let scope = modeSelection.scope;
	if (scope === null) {
		const requestedScope = request.scopeByTarget?.[targetName];
		if (requestedScope) {
			scope = requestedScope;
		} else {
			scope = getDefaultScope(profile);
		}
	}

	if (modeSelection.mode === "skills") {
		if (!isSkillScopeSupported(targetName, scope)) {
			throw new Error(`Target ${targetName} does not support ${scope} scope for skill conversion.`);
		}
	} else if (!profile.supportedScopes.includes(scope)) {
		throw new Error(`Target ${targetName} does not support ${scope} scope.`);
	}

	const homeDir = os.homedir();
	const destinationDir =
		modeSelection.mode === "skills"
			? resolveSkillDestination(targetName, scope, request.repoRoot, homeDir)
			: resolveCommandDestination(targetName, scope, request.repoRoot, homeDir);
	const manifestPath = resolveProjectManifestPath(targetName, scope, request.repoRoot, homeDir);
	const extension = getOutputExtension(targetName, modeSelection.outputKind);
	const existingNames =
		modeSelection.outputKind === "skill"
			? new Set<string>()
			: await listExistingNames(destinationDir, extension);
	const reservedNames = new Set(existingNames);

	const legacyManifestPaths = new Set<string>();
	legacyManifestPaths.add(resolveManifestPath(destinationDir));
	legacyManifestPaths.add(
		path.join(request.repoRoot, ".omniagent", "slash-commands", `${targetName}-${scope}.toml`),
	);
	legacyManifestPaths.add(
		resolveLegacyProjectManifestPath(targetName, scope, request.repoRoot, homeDir),
	);
	if (modeSelection.outputKind === "skill") {
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

		const output = renderOutput(templatedCommand, targetName, modeSelection.outputKind);
		const outputHash = hashContent(output);
		const { destinationPath } = resolveOutputPath(
			command.name,
			destinationDir,
			modeSelection.outputKind,
			extension,
		);
		const existingContent = await readFileIfExists(destinationPath);
		const existingHash = existingContent ? hashContent(existingContent) : null;
		const previousEntry = previousManaged.get(nameKey);

		if (modeSelection.outputKind === "skill") {
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
			const actionType = modeSelection.outputKind === "skill" ? "convert" : "create";
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
			const actionType = modeSelection.outputKind === "skill" ? "convert" : "update";
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
			if (modeSelection.outputKind === "skill") {
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

		const actionType = modeSelection.outputKind === "skill" ? "convert" : "update";
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
				modeSelection.outputKind,
				extension,
			);
			const removalPath = modeSelection.outputKind === "skill" ? containerDir : destinationPath;
			actions.push({
				targetName,
				action: "remove",
				commandName: entry.name,
				scope,
				destinationPath: removalPath,
			});
			summary.remove += 1;

			if (modeSelection.outputKind === "skill") {
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
			mode: modeSelection.mode,
			outputKind: modeSelection.outputKind,
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
	const catalog = await loadCommandCatalog(request.repoRoot);
	const selectedTargets =
		request.targets && request.targets.length > 0
			? request.targets
			: SLASH_COMMAND_TARGETS.map((target) => target.name);
	const validAgents = request.validAgents ?? [...SUPPORTED_AGENT_NAMES];
	const conflictResolution = request.conflictResolution ?? DEFAULT_CONFLICT_RESOLUTION;
	const unsupportedFallback = request.unsupportedFallback ?? DEFAULT_UNSUPPORTED_FALLBACK;
	const codexOption = request.codexOption ?? DEFAULT_CODEX_OPTION;
	const codexConversionScope = request.codexConversionScope ?? DEFAULT_CODEX_CONVERSION_SCOPE;
	const removeMissing = request.removeMissing ?? true;
	const timestamp = new Date().toISOString();

	const targetPlans: TargetPlan[] = [];
	let conflicts = 0;
	for (const targetName of selectedTargets) {
		const { plan, conflicts: targetConflicts } = await buildTargetPlan(
			{
				request: {
					...request,
					removeMissing,
				},
				commands: catalog.commands,
				conflictResolution,
				unsupportedFallback,
				codexOption,
				codexConversionScope,
				removeMissing,
				timestamp,
				validAgents,
			},
			targetName,
		);
		conflicts += targetConflicts;
		targetPlans.push(plan);
	}

	const actions = targetPlans.flatMap((plan) => plan.actions);
	const planSummary = buildActionSummary(actions, selectedTargets);
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
		hadFailures,
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
	return summary.results.map((result) => result.message).join("\n");
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
