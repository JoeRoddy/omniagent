import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyAgentTemplating } from "../agent-templating.js";
import { resolveAgentsDirPath } from "../agents-dir.js";
import { listSkillDirectories, normalizeName, type SkillDirectoryEntry } from "../catalog-utils.js";
import { stripFrontmatterFields } from "../frontmatter-strip.js";
import {
	resolveLocalCategoryRoot,
	resolveSharedCategoryRoot,
	stripLocalPathSuffix,
} from "../local-sources.js";
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
import { normalizeOutputDefinition, resolveOutputPath } from "../targets/output-resolver.js";
import { resolveTargets } from "../targets/resolve-targets.js";
import {
	defaultSubagentWriter,
	resolveWriter,
	type SubagentWriterItem,
	type WriterRegistry,
	writeFileOutput,
} from "../targets/writers.js";
import { loadSubagentCatalog, type SubagentDefinition } from "./catalog.js";
import {
	type ManagedSubagent,
	readManifest,
	resolveManifestPath,
	type SubagentSyncManifest,
	writeManifest,
} from "./manifest.js";
import type { SubagentTargetName } from "./targets.js";

export type SubagentSyncRequest = {
	repoRoot: string;
	agentsDir?: string | null;
	config?: OmniagentConfig | null;
	resolvedTargets?: ResolvedTarget[];
	resolveTargetName?: (value: string) => string | null;
	targets?: SubagentTargetName[];
	overrideOnly?: SubagentTargetName[] | null;
	overrideSkip?: SubagentTargetName[] | null;
	removeMissing?: boolean;
	validAgents?: string[];
	excludeLocal?: boolean;
	includeLocalSkills?: boolean;
};

export type SubagentSyncRequestV2 = {
	repoRoot: string;
	agentsDir?: string | null;
	targets: ResolvedTarget[];
	overrideOnly?: string[] | null;
	overrideSkip?: string[] | null;
	removeMissing?: boolean;
	validAgents?: string[];
	excludeLocal?: boolean;
	includeLocalSkills?: boolean;
	resolveTargetName?: (value: string) => string | null;
	hooks?: SyncHooks;
};

export type SubagentSyncPlanAction = {
	targetName: SubagentTargetName;
	action: "create" | "update" | "remove" | "convert" | "skip";
	subagentName: string;
	destinationPath?: string;
	contents?: string;
	hash?: string;
	conflict?: boolean;
};

export type SummaryCounts = {
	created: number;
	updated: number;
	removed: number;
	converted: number;
	skipped: number;
};

export type SubagentSyncPlan = {
	actions: SubagentSyncPlanAction[];
	summary: Record<SubagentTargetName, SummaryCounts>;
};

export type SubagentTargetSummary = {
	targetName: SubagentTargetName;
	displayName: string;
	outputKind: OutputKind;
	counts: SummaryCounts;
};

export type SubagentSyncPlanDetails = {
	sourcePath: string;
	plan: SubagentSyncPlan;
	targetPlans: TargetPlan[];
	targetSummaries: SubagentTargetSummary[];
	warnings: string[];
	sourceCounts?: SyncSourceCounts;
};

export type SubagentSyncResult = {
	targetName: SubagentTargetName;
	status: "synced" | "failed" | "partial";
	message: string;
	error?: string | null;
	counts: SummaryCounts;
	warnings: string[];
};

export type SubagentSyncSummary = {
	sourcePath: string;
	results: SubagentSyncResult[];
	warnings: string[];
	hadFailures: boolean;
	sourceCounts?: SyncSourceCounts;
};

type OutputKind = "subagent" | "skill";

type TargetPlan = {
	targetName: SubagentTargetName;
	displayName: string;
	outputKind: OutputKind;
	destinationDir: string | null;
	manifestPath: string | null;
	actions: SubagentSyncPlanAction[];
	summary: SummaryCounts;
	warnings: string[];
	nextManaged: Map<string, ManagedSubagent>;
	previousManaged: Map<string, ManagedSubagent>;
	removeMissing: boolean;
};

const TARGET_FRONTMATTER_KEYS = new Set(["targets", "targetagents"]);
const SKILL_FRONTMATTER_KEYS_TO_REMOVE = new Set([
	...TARGET_FRONTMATTER_KEYS,
	"tools",
	"model",
	"color",
]);

function emptySummaryCounts(): SummaryCounts {
	return { created: 0, updated: 0, removed: 0, converted: 0, skipped: 0 };
}

function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function normalizeSkillKey(name: string): string {
	return path.normalize(name).replace(/\\/g, "/").toLowerCase();
}

function normalizeSkillRelativePath(relativePath: string): string {
	if (!relativePath) {
		return relativePath;
	}
	const baseName = path.basename(relativePath);
	const { baseName: strippedBase } = stripLocalPathSuffix(baseName);
	const parent = path.dirname(relativePath);
	return parent === "." ? strippedBase : path.join(parent, strippedBase);
}

function formatDisplayPath(repoRoot: string, absolutePath: string): string {
	const relative = path.relative(repoRoot, absolutePath);
	const isWithinRepo = relative && !relative.startsWith("..") && !path.isAbsolute(relative);
	return isWithinRepo ? relative : absolutePath;
}

function resolveOutputTemplatePath(options: {
	outputDef: NonNullable<ReturnType<typeof normalizeOutputDefinition>>;
	repoRoot: string;
	homeDir: string;
	agentsDir: string;
	targetId: string;
}): string {
	return resolveOutputPath({
		template: options.outputDef.path,
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

function resolveOutputBaseDir(options: {
	outputDef: NonNullable<ReturnType<typeof normalizeOutputDefinition>>;
	repoRoot: string;
	homeDir: string;
	agentsDir: string;
	targetId: string;
}): { destinationDir: string; extension: string } {
	const templatePath = resolveOutputTemplatePath(options);
	return {
		destinationDir: path.dirname(templatePath),
		extension: path.extname(templatePath),
	};
}

type SourceCountRequest = Pick<
	SubagentSyncRequest,
	"overrideOnly" | "overrideSkip" | "excludeLocal"
>;

function buildSourceCounts(
	subagents: SubagentDefinition[],
	targets: SubagentTargetName[],
	allTargets: string[],
	request: SourceCountRequest,
): SyncSourceCounts {
	const targetSet = new Set(targets.map((target) => target.toLowerCase()));
	const counts: SyncSourceCounts = {
		shared: 0,
		local: 0,
		excludedLocal: request.excludeLocal ?? false,
	};
	for (const subagent of subagents) {
		const effectiveTargets = resolveEffectiveTargets({
			defaultTargets: subagent.targetAgents,
			overrideOnly: request.overrideOnly ?? undefined,
			overrideSkip: request.overrideSkip ?? undefined,
			allTargets,
		});
		if (effectiveTargets.length === 0) {
			continue;
		}
		if (!effectiveTargets.some((agent) => targetSet.has(agent.toLowerCase()))) {
			continue;
		}
		if (subagent.sourceType === "local") {
			counts.local += 1;
		} else {
			counts.shared += 1;
		}
	}
	return counts;
}

type CanonicalSkillIndexOptions = {
	includeLocal?: boolean;
	agentsDir?: string | null;
};

async function loadCanonicalSkillIndex(
	repoRoot: string,
	options: CanonicalSkillIndexOptions = {},
): Promise<Map<string, string>> {
	const includeLocal = options.includeLocal ?? true;
	const skillsRoot = resolveSharedCategoryRoot(repoRoot, "skills", options.agentsDir);
	const localSkillsRoot = resolveLocalCategoryRoot(repoRoot, "skills", options.agentsDir);
	let directories: SkillDirectoryEntry[] = [];
	try {
		directories = await listSkillDirectories(skillsRoot);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT" && code !== "ENOTDIR") {
			throw error;
		}
	}

	const index = new Map<string, string>();
	const addEntry = (relativePath: string, skillPath: string) => {
		if (!relativePath) {
			return;
		}
		const normalized = normalizeSkillKey(normalizeSkillRelativePath(relativePath));
		index.set(normalized, skillPath);
	};

	for (const entry of directories) {
		const relative = path.relative(skillsRoot, entry.directoryPath);
		if (!relative) {
			continue;
		}
		const isLocalDir = stripLocalPathSuffix(path.basename(entry.directoryPath)).hadLocalSuffix;
		if (!isLocalDir && entry.sharedSkillFile) {
			addEntry(relative, path.join(entry.directoryPath, entry.sharedSkillFile));
		}
		if (includeLocal) {
			if (isLocalDir) {
				const skillFileName = entry.localSkillFile ?? entry.sharedSkillFile;
				if (skillFileName) {
					addEntry(relative, path.join(entry.directoryPath, skillFileName));
				}
			} else if (entry.localSkillFile) {
				addEntry(relative, path.join(entry.directoryPath, entry.localSkillFile));
			}
		}
	}

	if (includeLocal) {
		let localDirectories: SkillDirectoryEntry[] = [];
		try {
			localDirectories = await listSkillDirectories(localSkillsRoot);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT" || code === "ENOTDIR") {
				return index;
			}
			throw error;
		}

		for (const entry of localDirectories) {
			const relative = path.relative(localSkillsRoot, entry.directoryPath);
			if (!relative) {
				continue;
			}
			const skillFileName = entry.sharedSkillFile ?? entry.localSkillFile;
			if (!skillFileName) {
				continue;
			}
			addEntry(relative, path.join(entry.directoryPath, skillFileName));
		}
	}

	return index;
}

function areManagedSubagentsEqual(
	left: Map<string, ManagedSubagent>,
	right: Map<string, ManagedSubagent>,
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

function resolveOutputPaths(
	outputKind: OutputKind,
	destinationDir: string,
	subagentName: string,
	outputExtension = ".md",
): { destinationPath: string; containerPath: string } {
	if (outputKind === "skill") {
		const containerPath = path.join(destinationDir, subagentName);
		return {
			containerPath,
			destinationPath: path.join(containerPath, "SKILL.md"),
		};
	}

	return {
		containerPath: destinationDir,
		destinationPath: path.join(destinationDir, `${subagentName}${outputExtension}`),
	};
}

function buildActionSummary(
	actions: SubagentSyncPlanAction[],
	targets: SubagentTargetName[],
): SubagentSyncPlan {
	const summary: Record<SubagentTargetName, SummaryCounts> = Object.fromEntries(
		targets.map((name) => [name, emptySummaryCounts()]),
	) as Record<SubagentTargetName, SummaryCounts>;

	for (const action of actions) {
		const counts = summary[action.targetName] ?? emptySummaryCounts();
		if (action.action === "create") {
			counts.created += 1;
		} else if (action.action === "update") {
			counts.updated += 1;
		} else if (action.action === "remove") {
			counts.removed += 1;
		} else if (action.action === "convert") {
			counts.converted += 1;
		} else if (action.action === "skip") {
			counts.skipped += 1;
		}
		summary[action.targetName] = counts;
	}

	return { actions, summary };
}

function buildInvalidTargetWarnings(subagents: SubagentDefinition[]): string[] {
	const warnings: string[] = [];
	for (const subagent of subagents) {
		if (subagent.invalidTargets.length === 0) {
			continue;
		}
		const invalidList = subagent.invalidTargets.join(", ");
		warnings.push(
			`Subagent "${subagent.resolvedName}" has unsupported targets (${invalidList}) in ${subagent.sourcePath}.`,
		);
	}
	return warnings;
}

async function buildTargetPlan(
	params: {
		request: SubagentSyncRequest;
		subagents: SubagentDefinition[];
		removeMissing: boolean;
		timestamp: string;
		canonicalSkills: Map<string, string>;
		validAgents: string[];
		allTargets: string[];
	},
	target: ResolvedTarget,
): Promise<TargetPlan> {
	const { request, subagents, removeMissing, validAgents, allTargets } = params;
	const targetName = target.id;
	const displayName = target.displayName;
	const outputDef = normalizeOutputDefinition(target.outputs.subagents);
	const skillDef = normalizeOutputDefinition(target.outputs.skills);
	const shouldSkip = !outputDef || outputDef.fallback?.mode === "skip";
	let outputKind: OutputKind = "subagent";
	let pathDef = outputDef;
	if (
		!shouldSkip &&
		outputDef &&
		outputDef.fallback?.mode === "convert" &&
		outputDef.fallback.targetType === "skills"
	) {
		if (!skillDef) {
			throw new Error(`Missing skills output for ${targetName} fallback.`);
		}
		outputKind = "skill";
		pathDef = skillDef;
	}

	if (shouldSkip) {
		const warnings: string[] = [];
		const summary = emptySummaryCounts();
		const actions: SubagentSyncPlanAction[] = [];
		for (const subagent of subagents) {
			const effectiveTargets = resolveEffectiveTargets({
				defaultTargets: subagent.targetAgents,
				overrideOnly: request.overrideOnly ?? undefined,
				overrideSkip: request.overrideSkip ?? undefined,
				allTargets,
			});
			if (effectiveTargets.length === 0 || !effectiveTargets.includes(targetName)) {
				continue;
			}
			actions.push({
				targetName,
				action: "skip",
				subagentName: subagent.resolvedName,
			});
			summary.skipped += 1;
		}
		return {
			targetName,
			displayName,
			outputKind: "subagent",
			destinationDir: null,
			manifestPath: null,
			actions,
			summary,
			warnings,
			nextManaged: new Map(),
			previousManaged: new Map(),
			removeMissing,
		};
	}
	const agentsDirPath = resolveAgentsDirPath(request.repoRoot, request.agentsDir);
	const homeDir = os.homedir();
	const baseDef = pathDef as NonNullable<ReturnType<typeof normalizeOutputDefinition>>;
	const { destinationDir, extension } = resolveOutputBaseDir({
		outputDef: baseDef,
		repoRoot: request.repoRoot,
		homeDir,
		agentsDir: agentsDirPath,
		targetId: targetName,
	});
	const outputExtension = outputKind === "subagent" ? extension || ".md" : ".md";
	const manifestPath = resolveManifestPath(request.repoRoot, targetName, os.homedir());
	const warnings: string[] = [];
	const summary = emptySummaryCounts();
	const actions: SubagentSyncPlanAction[] = [];

	if (outputKind === "skill" && subagents.length > 0) {
		warnings.push(`${displayName} does not support native subagents; converting to skills.`);
	}

	const manifest = await readManifest(manifestPath);
	const previousManaged = new Map<string, ManagedSubagent>();
	if (manifest && manifest.targetName === targetName) {
		for (const entry of manifest.managedSubagents) {
			previousManaged.set(normalizeName(entry.name), entry);
		}
	}

	const nextManaged = new Map<string, ManagedSubagent>();
	const catalogNames = new Set<string>();

	for (const subagent of subagents) {
		const effectiveTargets = resolveEffectiveTargets({
			defaultTargets: subagent.targetAgents,
			overrideOnly: request.overrideOnly ?? undefined,
			overrideSkip: request.overrideSkip ?? undefined,
			allTargets,
		});
		if (effectiveTargets.length === 0 || !effectiveTargets.includes(targetName)) {
			continue;
		}

		const nameKey = normalizeName(subagent.resolvedName);
		catalogNames.add(nameKey);
		const canonicalSkillKey =
			outputKind === "skill" ? normalizeSkillKey(subagent.resolvedName) : null;
		const canonicalSkillPath = canonicalSkillKey && params.canonicalSkills.get(canonicalSkillKey);
		if (outputKind === "skill" && canonicalSkillPath) {
			const { destinationPath } = resolveOutputPaths(
				outputKind,
				destinationDir,
				subagent.resolvedName,
				outputExtension,
			);
			actions.push({
				targetName,
				action: "skip",
				subagentName: subagent.resolvedName,
				destinationPath,
				conflict: true,
			});
			summary.skipped += 1;
			warnings.push(
				`Skipped ${displayName} skill "${
					subagent.resolvedName
				}" because canonical skill exists at ${canonicalSkillPath}.`,
			);
			continue;
		}

		const templatedContents = applyAgentTemplating({
			content: subagent.rawContents,
			target: targetName,
			validAgents,
			sourcePath: subagent.sourcePath,
		});
		const output =
			outputKind === "skill"
				? stripFrontmatterFields(templatedContents, SKILL_FRONTMATTER_KEYS_TO_REMOVE)
				: stripFrontmatterFields(templatedContents, TARGET_FRONTMATTER_KEYS);
		const outputHash = hashContent(output);
		const { destinationPath } = resolveOutputPaths(
			outputKind,
			destinationDir,
			subagent.resolvedName,
			outputExtension,
		);
		const existingContent = await readFileIfExists(destinationPath);
		const existingHash = existingContent ? hashContent(existingContent) : null;
		const previousEntry = previousManaged.get(nameKey);

		if (!existingContent) {
			const actionType = outputKind === "skill" ? "convert" : "create";
			const managedEntry = {
				name: subagent.resolvedName,
				hash: outputHash,
				lastSyncedAt: params.timestamp,
			};
			actions.push({
				targetName,
				action: actionType,
				subagentName: subagent.resolvedName,
				destinationPath,
				contents: output,
				hash: outputHash,
			});
			if (actionType === "create") {
				summary.created += 1;
			} else {
				summary.converted += 1;
			}
			nextManaged.set(nameKey, managedEntry);
			continue;
		}

		if (existingHash === outputHash) {
			if (previousEntry) {
				nextManaged.set(nameKey, previousEntry);
			} else {
				actions.push({
					targetName,
					action: "skip",
					subagentName: subagent.resolvedName,
					destinationPath,
				});
				summary.skipped += 1;
			}
			continue;
		}

		if (previousEntry) {
			const actionType = "update";
			const managedEntry = {
				name: subagent.resolvedName,
				hash: outputHash,
				lastSyncedAt: params.timestamp,
			};
			actions.push({
				targetName,
				action: actionType,
				subagentName: subagent.resolvedName,
				destinationPath,
				contents: output,
				hash: outputHash,
			});
			summary.updated += 1;
			nextManaged.set(nameKey, managedEntry);
			continue;
		}

		actions.push({
			targetName,
			action: "skip",
			subagentName: subagent.resolvedName,
			destinationPath,
			conflict: true,
		});
		summary.skipped += 1;
		warnings.push(
			`Skipped ${displayName} ${
				outputKind === "skill" ? "skill" : "subagent"
			} "${subagent.resolvedName}" because an unmanaged file exists at ${destinationPath}.`,
		);
	}

	if (removeMissing && previousManaged.size > 0) {
		for (const entry of previousManaged.values()) {
			if (catalogNames.has(normalizeName(entry.name))) {
				continue;
			}
			const removalBase = outputKind === "skill" ? entry.name : `${entry.name}${outputExtension}`;
			const removalPath =
				outputKind === "skill"
					? path.join(destinationDir, entry.name)
					: path.join(destinationDir, removalBase);
			if (outputKind === "skill") {
				const canonicalSkillKey = normalizeSkillKey(entry.name);
				const canonicalSkillPath = params.canonicalSkills.get(canonicalSkillKey);
				if (canonicalSkillPath) {
					actions.push({
						targetName,
						action: "skip",
						subagentName: entry.name,
						destinationPath: removalPath,
						conflict: true,
					});
					summary.skipped += 1;
					warnings.push(
						`Skipped removing ${displayName} skill "${
							entry.name
						}" because canonical skill exists at ${canonicalSkillPath}.`,
					);
					continue;
				}
			}
			actions.push({
				targetName,
				action: "remove",
				subagentName: entry.name,
				destinationPath: removalPath,
			});
			summary.removed += 1;
		}
	} else if (!removeMissing && previousManaged.size > 0) {
		for (const entry of previousManaged.values()) {
			if (!catalogNames.has(normalizeName(entry.name))) {
				nextManaged.set(normalizeName(entry.name), entry);
			}
		}
	}

	return {
		targetName,
		displayName,
		outputKind,
		destinationDir,
		manifestPath,
		actions,
		summary,
		warnings,
		nextManaged,
		previousManaged,
		removeMissing,
	};
}

export async function planSubagentSync(
	request: SubagentSyncRequest,
): Promise<SubagentSyncPlanDetails> {
	const resolvedTargets =
		request.resolvedTargets ??
		resolveTargets({
			config: request.config ?? null,
			builtIns: BUILTIN_TARGETS,
		}).targets;
	const targetResolver = createTargetNameResolver(resolvedTargets);
	const resolveTargetName = request.resolveTargetName ?? targetResolver.resolveTargetName;
	const catalog = await loadSubagentCatalog(request.repoRoot, {
		includeLocal: !request.excludeLocal,
		agentsDir: request.agentsDir,
		resolveTargetName,
	});
	const canonicalSkills = await loadCanonicalSkillIndex(request.repoRoot, {
		includeLocal: request.includeLocalSkills ?? true,
		agentsDir: request.agentsDir,
	});
	const allTargetIds = resolvedTargets.map((target) => target.id);
	const selectedTargets: ResolvedTarget[] =
		request.targets && request.targets.length > 0
			? request.targets.map((targetName) => {
					const resolved = resolveTargetName(targetName);
					if (!resolved) {
						throw new Error(`Unknown subagent target: ${targetName}`);
					}
					const target = resolvedTargets.find((entry) => entry.id === resolved);
					if (!target) {
						throw new Error(`Unknown subagent target: ${targetName}`);
					}
					return target;
				})
			: resolvedTargets;
	const selectedTargetIds = selectedTargets.map((target) => target.id);
	const validAgents = request.validAgents ?? buildSupportedAgentNames(resolvedTargets);
	const removeMissing = request.removeMissing ?? true;
	const timestamp = new Date().toISOString();

	const targetPlans: TargetPlan[] = [];
	for (const target of selectedTargets) {
		targetPlans.push(
			await buildTargetPlan(
				{
					request,
					subagents: catalog.subagents,
					removeMissing,
					timestamp,
					canonicalSkills,
					validAgents,
					allTargets: allTargetIds,
				},
				target,
			),
		);
	}

	const actions = targetPlans.flatMap((plan) => plan.actions);
	const planSummary = buildActionSummary(actions, selectedTargetIds);
	const targetSummaries: SubagentTargetSummary[] = targetPlans.map((plan) => ({
		targetName: plan.targetName,
		displayName: plan.displayName,
		outputKind: plan.outputKind,
		counts: plan.summary,
	}));

	return {
		sourcePath: catalog.catalogPath,
		plan: planSummary,
		targetPlans,
		targetSummaries,
		warnings: buildInvalidTargetWarnings(catalog.subagents),
		sourceCounts: buildSourceCounts(catalog.subagents, selectedTargetIds, allTargetIds, request),
	};
}

async function ensureDirectory(dirPath: string): Promise<void> {
	await mkdir(dirPath, { recursive: true });
}

async function applyAction(action: SubagentSyncPlanAction): Promise<void> {
	if (!action.destinationPath) {
		return;
	}

	if (action.action === "remove") {
		await rm(action.destinationPath, { force: true, recursive: true });
		return;
	}

	const destinationDir = path.dirname(action.destinationPath);
	await ensureDirectory(destinationDir);

	if (action.contents !== undefined) {
		await writeFile(action.destinationPath, action.contents, "utf8");
	}
}

export async function applySubagentSync(
	planDetails: SubagentSyncPlanDetails,
): Promise<SubagentSyncSummary> {
	const results: SubagentSyncResult[] = [];
	let hadFailures = false;

	for (const targetPlan of planDetails.targetPlans) {
		const counts: SummaryCounts = {
			created: 0,
			updated: 0,
			removed: 0,
			converted: 0,
			skipped: 0,
		};
		let hadError = false;
		let errorMessage: string | null = null;
		const managed = new Map(targetPlan.nextManaged);

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
				const nameKey = normalizeName(action.subagentName);
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
		const managedChanged = !areManagedSubagentsEqual(targetPlan.previousManaged, managed);

		if (targetPlan.manifestPath) {
			if (totalApplied > 0 || managedChanged) {
				try {
					const manifest: SubagentSyncManifest = {
						targetName: targetPlan.targetName,
						managedSubagents: Array.from(managed.values()),
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

		const status = hadError ? (totalApplied > 0 ? "partial" : "failed") : "synced";
		results.push({
			targetName: targetPlan.targetName,
			status,
			message: formatResultMessage(
				targetPlan.displayName,
				targetPlan.outputKind,
				status,
				counts,
				errorMessage,
			),
			error: errorMessage,
			counts,
			warnings: targetPlan.warnings,
		});
	}

	const warnings = [...planDetails.warnings, ...results.flatMap((result) => result.warnings)];

	return {
		sourcePath: planDetails.sourcePath,
		results,
		warnings,
		hadFailures,
		sourceCounts: planDetails.sourceCounts,
	};
}

function formatResultMessage(
	displayName: string,
	outputKind: OutputKind,
	status: SubagentSyncResult["status"],
	counts: SummaryCounts,
	error?: string | null,
): string {
	const verb =
		status === "synced" ? "Synced" : status === "partial" ? "Partially synced" : "Failed";
	const modeLabel = outputKind === "skill" ? " [skills]" : "";
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
		return `No changes for ${displayName} subagents${modeLabel}.`;
	}
	return `${verb} ${displayName} subagents${modeLabel}: ${countMessage}${suffix}`;
}

export function formatSubagentSummary(summary: SubagentSyncSummary, jsonOutput: boolean): string {
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

type SubagentOutputCandidate = {
	target: ResolvedTarget;
	subagent: SubagentDefinition;
	outputPath: string;
	outputKind: "subagent" | "skill";
	writer: OutputWriter;
	converter: ConverterRule | null;
};

export async function syncSubagents(request: SubagentSyncRequestV2): Promise<SubagentSyncSummary> {
	const catalog = await loadSubagentCatalog(request.repoRoot, {
		includeLocal: !request.excludeLocal,
		agentsDir: request.agentsDir,
		resolveTargetName: request.resolveTargetName,
	});
	const targets = request.targets.filter(
		(target) => normalizeOutputDefinition(target.outputs.subagents) !== null,
	);
	const warnings = buildInvalidTargetWarnings(catalog.subagents);
	const removeMissing = request.removeMissing ?? false;
	if (targets.length === 0) {
		return {
			sourcePath: catalog.catalogPath,
			results: [],
			warnings,
			hadFailures: false,
			sourceCounts: {
				shared: 0,
				local: 0,
				excludedLocal: request.excludeLocal ?? false,
			},
		};
	}

	const allTargetIds = request.targets.map((target) => target.id);
	const activeTargetIds = new Set(targets.map((target) => target.id));
	const effectiveTargetsBySubagent = new Map<SubagentDefinition, string[]>();
	const activeSourcesByTarget = new Map<string, Set<string>>();
	for (const subagent of catalog.subagents) {
		const effectiveTargets = resolveEffectiveTargets({
			defaultTargets: subagent.targetAgents,
			overrideOnly: request.overrideOnly ?? undefined,
			overrideSkip: request.overrideSkip ?? undefined,
			allTargets: allTargetIds,
		});
		effectiveTargetsBySubagent.set(subagent, effectiveTargets);
		for (const targetId of effectiveTargets) {
			if (!activeTargetIds.has(targetId)) {
				continue;
			}
			const existing = activeSourcesByTarget.get(targetId) ?? new Set<string>();
			existing.add(subagent.resolvedName);
			activeSourcesByTarget.set(targetId, existing);
		}
	}

	const sourceCounts: SyncSourceCounts = buildSourceCounts(
		catalog.subagents,
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
	const countsByTarget = new Map<string, SummaryCounts>();
	const getCounts = (targetId: string): SummaryCounts => {
		const existing = countsByTarget.get(targetId) ?? emptySummaryCounts();
		countsByTarget.set(targetId, existing);
		return existing;
	};
	const converterRegistry: ConverterRegistry = new Map();
	const writerRegistry: WriterRegistry = new Map([
		[defaultSubagentWriter.id, defaultSubagentWriter],
	]);
	const canonicalSkills = await loadCanonicalSkillIndex(request.repoRoot, {
		includeLocal: request.includeLocalSkills ?? true,
		agentsDir: request.agentsDir,
	});
	const validAgents = request.validAgents ?? buildSupportedAgentNames(request.targets);

	const outputDefs = new Map<string, NonNullable<ReturnType<typeof normalizeOutputDefinition>>>();
	const skillDefs = new Map<string, NonNullable<ReturnType<typeof normalizeOutputDefinition>>>();
	const outputKindByTarget = new Map<string, OutputKind>();
	for (const target of targets) {
		const normalized = normalizeOutputDefinition(target.outputs.subagents);
		if (normalized) {
			outputDefs.set(target.id, normalized);
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

	const candidatesByPath = new Map<string, SubagentOutputCandidate[]>();
	for (const subagent of catalog.subagents) {
		const effectiveTargets = effectiveTargetsBySubagent.get(subagent) ?? [];
		if (effectiveTargets.length === 0) {
			continue;
		}
		for (const target of targets) {
			if (!effectiveTargets.includes(target.id)) {
				continue;
			}
			const outputDef = outputDefs.get(target.id);
			if (!outputDef) {
				continue;
			}
			if (outputDef.fallback?.mode === "skip") {
				continue;
			}
			let outputKind: "subagent" | "skill" = "subagent";
			let pathDef = outputDef;
			if (outputDef.fallback?.mode === "convert" && outputDef.fallback.targetType === "skills") {
				const skillDef = skillDefs.get(target.id);
				if (!skillDef) {
					recordError(target.id, `Missing skills output for ${target.id} fallback.`);
					continue;
				}
				outputKind = "skill";
				pathDef = skillDef;
			}
			if (!outputKindByTarget.has(target.id)) {
				outputKindByTarget.set(target.id, outputKind);
			}

			if (outputKind === "skill") {
				const canonicalSkillKey = normalizeSkillKey(subagent.resolvedName);
				const canonicalSkillPath = canonicalSkills.get(canonicalSkillKey);
				if (canonicalSkillPath) {
					warnings.push(
						`Skipped ${target.displayName} skill "${subagent.resolvedName}" because canonical skill exists at ${canonicalSkillPath}.`,
					);
					continue;
				}
			}

			const outputPath = resolveOutputPath({
				template: pathDef.path,
				context: {
					repoRoot: request.repoRoot,
					agentsDir: agentsDirPath,
					homeDir,
					targetId: target.id,
					itemName: subagent.resolvedName,
				},
				item: subagent,
				baseDir: request.repoRoot,
			});
			const key = path.normalize(outputPath).replace(/\\/g, "/").toLowerCase();
			const writer = resolveWriter(outputDef.writer, writerRegistry) ?? defaultSubagentWriter;
			const converter = resolveConverter(outputDef.converter, converterRegistry);
			const list = candidatesByPath.get(key) ?? [];
			list.push({ target, subagent, outputPath, outputKind, writer, converter });
			candidatesByPath.set(key, list);
		}
	}

	for (const target of targets) {
		await runSyncHook(request.hooks, "preSync", {
			repoRoot: request.repoRoot,
			agentsDir: agentsDirPath,
			targetId: target.id,
			outputType: "subagents",
		});
		await runSyncHook(target.hooks, "preSync", {
			repoRoot: request.repoRoot,
			agentsDir: agentsDirPath,
			targetId: target.id,
			outputType: "subagents",
		});
	}

	for (const candidates of candidatesByPath.values()) {
		if (candidates.length === 0) {
			continue;
		}
		const sorted = [...candidates].sort((left, right) =>
			left.target.id.localeCompare(right.target.id),
		);
		const selected = sorted[0];
		const useDefaultWriter = sorted.length > 1;
		const writer = useDefaultWriter ? defaultSubagentWriter : selected.writer;
		const converter = selected.converter;
		const target = selected.target;
		const itemLabel = selected.subagent.resolvedName;
		const recordManagedOutput = (entry: ManagedOutputRecord) => {
			const key = buildManagedOutputKey(entry);
			nextManaged.set(key, entry);
			activeOutputPaths.add(normalizeManagedOutputPath(entry.outputPath));
		};
		const counts = getCounts(target.id);

		let converterActive = false;
		try {
			if (converter) {
				converterActive = true;
				await runConvertHook(request.hooks, "preConvert", {
					repoRoot: request.repoRoot,
					agentsDir: agentsDirPath,
					targetId: target.id,
					outputType: "subagents",
				});
				await runConvertHook(target.hooks, "preConvert", {
					repoRoot: request.repoRoot,
					agentsDir: agentsDirPath,
					targetId: target.id,
					outputType: "subagents",
				});
				const decision = await converter.convert(selected.subagent, {
					repoRoot: request.repoRoot,
					agentsDir: agentsDirPath,
					homeDir,
					targetId: target.id,
					outputType: "subagents",
					validAgents,
				});
				const normalized = normalizeConverterDecision(decision);
				await runConvertHook(request.hooks, "postConvert", {
					repoRoot: request.repoRoot,
					agentsDir: agentsDirPath,
					targetId: target.id,
					outputType: "subagents",
				});
				await runConvertHook(target.hooks, "postConvert", {
					repoRoot: request.repoRoot,
					agentsDir: agentsDirPath,
					targetId: target.id,
					outputType: "subagents",
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
							sourceType: "subagent",
							sourceId: selected.subagent.resolvedName,
							checksum,
							lastSyncedAt: new Date().toISOString(),
						});
					}
				}
				counts.converted += 1;
				converterActive = false;
				continue;
			}

			const item: SubagentWriterItem = {
				resolvedName: selected.subagent.resolvedName,
				rawContents: selected.subagent.rawContents,
				sourcePath: selected.subagent.sourcePath,
				outputKind: selected.outputKind,
			};
			const writeResult = await writer.write({
				outputPath: selected.outputPath,
				content: selected.subagent.rawContents,
				item,
				context: {
					repoRoot: request.repoRoot,
					agentsDir: agentsDirPath,
					homeDir,
					targetId: target.id,
					outputType: "subagents",
					validAgents,
				},
			});
			const checksum =
				selected.outputKind === "skill"
					? await hashOutputPath(selected.outputPath)
					: (writeResult.contentHash ?? (await hashOutputPath(selected.outputPath)));
			if (checksum) {
				recordManagedOutput({
					targetId: target.id,
					outputPath: selected.outputPath,
					sourceType: "subagent",
					sourceId: selected.subagent.resolvedName,
					checksum,
					lastSyncedAt: new Date().toISOString(),
					writerId: writer.id,
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
			outputType: "subagents",
		});
		await runSyncHook(target.hooks, "postSync", {
			repoRoot: request.repoRoot,
			agentsDir: agentsDirPath,
			targetId: target.id,
			outputType: "subagents",
		});
	}

	if (managedManifest.entries.length > 0 || nextManaged.size > 0) {
		const updatedEntries: ManagedOutputRecord[] = [];
		for (const entry of managedManifest.entries) {
			if (entry.sourceType !== "subagent" || !activeTargetIds.has(entry.targetId)) {
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
				`Converter errors in subagents for ${target.displayName}: ${[...items].sort().join(", ")}.`,
			);
		}
	}

	const results: SubagentSyncResult[] = [];
	let hadFailures = false;
	for (const target of targets) {
		const errors = targetErrors.get(target.id);
		if (errors && errors.length > 0) {
			hadFailures = true;
			const combined = errors.join("; ");
			const counts = getCounts(target.id);
			const total =
				counts.created + counts.updated + counts.removed + counts.converted + counts.skipped;
			const status: SubagentSyncResult["status"] = total > 0 ? "partial" : "failed";
			const outputKind = outputKindByTarget.get(target.id) ?? "subagent";
			results.push({
				targetName: target.id,
				status,
				message: formatResultMessage(target.displayName, outputKind, status, counts, combined),
				error: combined,
				counts,
				warnings: [],
			});
		} else {
			const counts = getCounts(target.id);
			const status: SubagentSyncResult["status"] = "synced";
			const outputKind = outputKindByTarget.get(target.id) ?? "subagent";
			results.push({
				targetName: target.id,
				status,
				message: formatResultMessage(target.displayName, outputKind, status, counts),
				counts,
				warnings: [],
			});
		}
	}

	return {
		sourcePath: catalog.catalogPath,
		results,
		warnings,
		hadFailures,
		sourceCounts,
	};
}
