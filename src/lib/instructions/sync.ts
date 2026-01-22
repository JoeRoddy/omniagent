import { createHash } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyAgentTemplating } from "../agent-templating.js";
import { resolveAgentsDirPath } from "../agents-dir.js";
import { resolveLocalPrecedence } from "../local-precedence.js";
import type { SyncSourceCounts } from "../sync-results.js";
import { resolveEffectiveTargets } from "../sync-targets.js";
import { BUILTIN_TARGETS } from "../targets/builtins.js";
import type {
	ConverterRule,
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
	normalizeInstructionOutputDefinition,
	resolveInstructionFilename,
} from "../targets/output-resolver.js";
import {
	defaultInstructionWriter,
	resolveWriter,
	type WriterRegistry,
	writeFileOutput,
} from "../targets/writers.js";
import { loadInstructionTemplateCatalog } from "./catalog.js";
import { type InstructionManifestEntry, readManifest, writeManifest } from "./manifest.js";
import { resolveInstructionOutputPath } from "./paths.js";
import { type InstructionScanTarget, scanRepoInstructionSources } from "./scan.js";
import {
	buildInstructionResultMessage,
	emptyOutputCounts,
	type InstructionOutputCounts,
	type InstructionSyncResult,
	type InstructionSyncSummary,
} from "./summary.js";
import type { InstructionTargetGroup, InstructionTargetName } from "./targets.js";
import { resolveInstructionTargetGroup } from "./targets.js";
import type { InstructionRepoSource, InstructionSource } from "./types.js";

export type { InstructionSyncSummary } from "./summary.js";

export type InstructionSyncRequest = {
	repoRoot: string;
	agentsDir?: string | null;
	targets: Array<ResolvedTarget | InstructionTargetName>;
	overrideOnly?: InstructionTargetName[] | null;
	overrideSkip?: InstructionTargetName[] | null;
	excludeLocal?: boolean;
	removeMissing?: boolean;
	nonInteractive?: boolean;
	validAgents: string[];
	resolveTargetName?: (value: string) => string | null;
	hooks?: SyncHooks;
	confirmRemoval?: (options: {
		outputPath: string;
		sourcePath: string;
		targetName: InstructionTargetName;
	}) => Promise<boolean>;
};

type InstructionOutputCandidate = {
	key: string;
	outputGroup: InstructionTargetGroup;
	outputPath: string;
	targetName: InstructionTargetName;
	source: InstructionSource;
	content: string | null;
	kind: "generated" | "satisfied";
	writer: OutputWriter;
	converter: ConverterRule | null;
};

type GroupResult = {
	counts: InstructionOutputCounts;
	warnings: string[];
	hadFailure: boolean;
};

type InstructionTargetSelection = {
	target: ResolvedTarget;
	group: InstructionTargetGroup;
	primary: boolean;
	definition: NonNullable<ReturnType<typeof normalizeInstructionOutputDefinition>>;
};

function hashContent(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function normalizeKeyPath(value: string): string {
	// Normalize for cross-platform dedupe on case-insensitive filesystems.
	return path.normalize(value).replace(/\\/g, "/").toLowerCase();
}

function buildOutputKey(outputPath: string, group: InstructionTargetGroup): string {
	return `${group}:${normalizeKeyPath(outputPath)}`;
}

function formatDisplayPath(repoRoot: string, absolutePath: string): string {
	const relative = path.relative(repoRoot, absolutePath);
	const isWithinRepo = relative && !relative.startsWith("..") && !path.isAbsolute(relative);
	return isWithinRepo ? relative : absolutePath;
}

function sortCandidates(candidates: InstructionOutputCandidate[]): InstructionOutputCandidate[] {
	return [...candidates].sort((left, right) =>
		left.source.sourcePath.localeCompare(right.source.sourcePath),
	);
}

function selectCandidateBySource(
	candidates: InstructionOutputCandidate[],
): InstructionOutputCandidate | null {
	if (candidates.length === 0) {
		return null;
	}
	const satisfied = sortCandidates(
		candidates.filter((candidate) => candidate.kind === "satisfied"),
	);
	if (satisfied.length > 0) {
		return satisfied[0];
	}
	const shared = sortCandidates(
		candidates.filter((candidate) => candidate.source.sourceType === "shared"),
	);
	const localPath = sortCandidates(
		candidates.filter(
			(candidate) =>
				candidate.source.sourceType === "local" &&
				(candidate.source.markerType === "path" || !candidate.source.markerType),
		),
	);
	const localSuffix = sortCandidates(
		candidates.filter(
			(candidate) =>
				candidate.source.sourceType === "local" && candidate.source.markerType === "suffix",
		),
	);

	const { localEffective, sharedEffective } = resolveLocalPrecedence({
		shared,
		localPath,
		localSuffix,
		key: (candidate) => candidate.source.sourcePath,
	});

	if (localEffective.length > 0) {
		return localEffective[0];
	}
	if (sharedEffective.length > 0) {
		return sharedEffective[0];
	}
	return null;
}

function selectCandidate(
	candidates: InstructionOutputCandidate[],
	preferredTargetName: InstructionTargetName | null,
): InstructionOutputCandidate | null {
	if (!preferredTargetName) {
		return selectCandidateBySource(candidates);
	}
	const preferred = selectCandidateBySource(
		candidates.filter((candidate) => candidate.targetName === preferredTargetName),
	);
	return preferred ?? selectCandidateBySource(candidates);
}

function selectCollisionCandidate(
	candidates: InstructionOutputCandidate[],
): InstructionOutputCandidate | null {
	if (candidates.length === 0) {
		return null;
	}
	const templates = candidates.filter((candidate) => candidate.source.kind === "template");
	const pool = templates.length > 0 ? templates : candidates;
	return selectCandidateBySource(pool);
}

async function loadRepoSources(options: {
	repoRoot: string;
	includeLocal: boolean;
	agentsDir?: string | null;
	targets?: InstructionScanTarget[];
}): Promise<InstructionRepoSource[]> {
	const entries = await scanRepoInstructionSources({
		repoRoot: options.repoRoot,
		includeLocal: options.includeLocal,
		agentsDir: options.agentsDir,
		targets: options.targets,
	});
	const sources: InstructionRepoSource[] = [];
	for (const entry of entries) {
		const rawContents = await readFile(entry.sourcePath, "utf8");
		sources.push({
			kind: "repo",
			sourcePath: entry.sourcePath,
			sourceType: entry.sourceType,
			markerType: entry.markerType,
			isLocalFallback: entry.isLocalFallback,
			rawContents,
			body: rawContents,
			resolvedOutputDir: path.dirname(entry.sourcePath),
		});
	}
	return sources;
}

function resolveEffectiveTargetsForSource(
	source: InstructionSource,
	selectedTargets: Set<InstructionTargetName>,
	allTargets: InstructionTargetName[],
	overrideOnly?: InstructionTargetName[] | null,
	overrideSkip?: InstructionTargetName[] | null,
): InstructionTargetName[] {
	const defaultTargets = source.kind === "template" ? source.targets : null;
	const effective = resolveEffectiveTargets({
		defaultTargets,
		overrideOnly: overrideOnly ?? undefined,
		overrideSkip: overrideSkip ?? undefined,
		allTargets,
	});
	return effective.filter((target) => selectedTargets.has(target));
}

function createGroupResult(): GroupResult {
	return {
		counts: emptyOutputCounts(),
		warnings: [],
		hadFailure: false,
	};
}

function recordCount(counts: InstructionOutputCounts, field: keyof InstructionOutputCounts): void {
	if (field !== "total") {
		counts[field] += 1;
	}
	counts.total += 1;
}

function normalizeInstructionTargets(
	targets: Array<ResolvedTarget | InstructionTargetName>,
): ResolvedTarget[] {
	const resolved: ResolvedTarget[] = [];
	for (const target of targets) {
		if (typeof target !== "string") {
			resolved.push(target);
			continue;
		}
		const normalized = target.trim().toLowerCase();
		if (!normalized) {
			continue;
		}
		const builtin = BUILTIN_TARGETS.find(
			(entry) => entry.id === normalized || entry.aliases?.includes(normalized),
		);
		if (!builtin) {
			continue;
		}
		resolved.push({
			id: builtin.id,
			displayName: builtin.displayName ?? builtin.id,
			aliases: builtin.aliases ?? [],
			outputs: builtin.outputs ?? {},
			hooks: builtin.hooks,
			isBuiltIn: true,
			isCustomized: false,
		});
	}
	return resolved;
}

export async function syncInstructions(
	request: InstructionSyncRequest,
): Promise<InstructionSyncSummary> {
	const targets = normalizeInstructionTargets(request.targets);
	const includeLocal = !(request.excludeLocal ?? false);
	const summarySourcePath = request.repoRoot;
	const warnings: string[] = [];
	const homeDir = os.homedir();
	const agentsRoot = resolveAgentsDirPath(request.repoRoot, request.agentsDir);
	const managedManifest = (await readManagedOutputs(request.repoRoot, homeDir)) ?? { entries: [] };
	const nextManaged = new Map<string, ManagedOutputRecord>();
	const activeOutputPaths = new Set<string>();
	const activeSourcesByTarget = new Map<string, Set<string>>();
	const removeMissing = request.removeMissing ?? false;

	const selections: InstructionTargetSelection[] = [];
	for (const target of targets) {
		const normalized = normalizeInstructionOutputDefinition(target.outputs.instructions);
		if (!normalized) {
			continue;
		}
		selections.push({
			target,
			group: resolveInstructionTargetGroup(target.id, normalized.group),
			primary: false,
			definition: normalized,
		});
	}

	if (selections.length === 0) {
		return {
			sourcePath: summarySourcePath,
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

	const selectionById = new Map<string, InstructionTargetSelection>();
	for (const selection of selections) {
		selectionById.set(selection.target.id, selection);
	}

	const primaryByGroup = new Map<InstructionTargetGroup, string>();
	for (const target of targets) {
		const selection = selectionById.get(target.id);
		if (!selection) {
			continue;
		}
		if (!primaryByGroup.has(selection.group)) {
			primaryByGroup.set(selection.group, target.id);
		}
	}
	for (const selection of selections) {
		selection.primary = primaryByGroup.get(selection.group) === selection.target.id;
	}

	const selectedTargetIds = new Set(selections.map((selection) => selection.target.id));
	const allTargetIds = targets.map((target) => target.id);

	const [templateCatalog, repoSources] = await Promise.all([
		loadInstructionTemplateCatalog({
			repoRoot: request.repoRoot,
			includeLocal,
			agentsDir: request.agentsDir,
			resolveTargetName: request.resolveTargetName,
		}),
		loadRepoSources({
			repoRoot: request.repoRoot,
			includeLocal,
			agentsDir: request.agentsDir,
			targets,
		}),
	]);

	const converterRegistry: ConverterRegistry = new Map();
	const writerRegistry: WriterRegistry = new Map([
		[defaultInstructionWriter.id, defaultInstructionWriter],
	]);

	const templateCandidates: InstructionOutputCandidate[] = [];
	for (const template of templateCatalog.templates) {
		const resolvedOutputDir = template.resolvedOutputDir;
		if (!resolvedOutputDir) {
			const display = formatDisplayPath(request.repoRoot, template.sourcePath);
			warnings.push(`Instruction template missing outPutPath: ${display}.`);
			continue;
		}
		const effectiveTargets = resolveEffectiveTargetsForSource(
			template,
			selectedTargetIds,
			allTargetIds,
			request.overrideOnly,
			request.overrideSkip,
		);
		if (effectiveTargets.length === 0) {
			continue;
		}
		for (const targetName of effectiveTargets) {
			const selection = selectionById.get(targetName);
			if (!selection) {
				continue;
			}
			const itemName = path.basename(template.sourcePath, path.extname(template.sourcePath));
			const filename = resolveInstructionFilename({
				template: selection.definition.filename,
				context: {
					repoRoot: request.repoRoot,
					agentsDir: agentsRoot,
					homeDir,
					targetId: targetName,
					itemName,
				},
				item: template,
			});
			const outputPath = resolveInstructionOutputPath(resolvedOutputDir, filename);
			const key = buildOutputKey(outputPath, selection.group);
			const content = applyAgentTemplating({
				content: template.body,
				target: targetName,
				validAgents: request.validAgents,
				sourcePath: template.sourcePath,
			});
			const writer =
				resolveWriter(selection.definition.writer, writerRegistry) ?? defaultInstructionWriter;
			const converter = resolveConverter(selection.definition.converter, converterRegistry);
			templateCandidates.push({
				key,
				outputGroup: selection.group,
				outputPath,
				targetName,
				source: template,
				content,
				kind: "generated",
				writer,
				converter,
			});
		}
	}

	const repoCandidates: InstructionOutputCandidate[] = [];
	for (const source of repoSources) {
		const effectiveTargets = resolveEffectiveTargetsForSource(
			source,
			selectedTargetIds,
			allTargetIds,
			request.overrideOnly,
			request.overrideSkip,
		);
		if (effectiveTargets.length === 0) {
			continue;
		}
		for (const targetName of effectiveTargets) {
			const selection = selectionById.get(targetName);
			if (!selection) {
				continue;
			}
			const itemName = path.basename(source.sourcePath, path.extname(source.sourcePath));
			const filename = resolveInstructionFilename({
				template: selection.definition.filename,
				context: {
					repoRoot: request.repoRoot,
					agentsDir: agentsRoot,
					homeDir,
					targetId: targetName,
					itemName,
				},
				item: source,
			});
			const outputPath = resolveInstructionOutputPath(source.resolvedOutputDir, filename);
			const key = buildOutputKey(outputPath, selection.group);
			const normalizedOutput = path.normalize(outputPath);
			const normalizedSource = path.normalize(source.sourcePath);
			const isSatisfied = normalizedOutput === normalizedSource;
			const writer =
				resolveWriter(selection.definition.writer, writerRegistry) ?? defaultInstructionWriter;
			const converter = resolveConverter(selection.definition.converter, converterRegistry);
			repoCandidates.push({
				key,
				outputGroup: selection.group,
				outputPath,
				targetName,
				source,
				content: isSatisfied ? null : source.body,
				kind: isSatisfied ? "satisfied" : "generated",
				writer,
				converter,
			});
		}
	}

	const templateGroups = new Map<string, InstructionOutputCandidate[]>();
	for (const candidate of templateCandidates) {
		const list = templateGroups.get(candidate.key) ?? [];
		list.push(candidate);
		templateGroups.set(candidate.key, list);
	}
	const repoGroups = new Map<string, InstructionOutputCandidate[]>();
	for (const candidate of repoCandidates) {
		const list = repoGroups.get(candidate.key) ?? [];
		list.push(candidate);
		repoGroups.set(candidate.key, list);
	}

	const templateWinners = new Map<string, InstructionOutputCandidate>();
	for (const [key, candidates] of templateGroups) {
		const outputGroup = candidates[0]?.outputGroup;
		const preferred = outputGroup ? (primaryByGroup.get(outputGroup) ?? null) : null;
		const selected = selectCandidate(candidates, preferred);
		if (selected) {
			templateWinners.set(key, selected);
		}
	}
	const repoWinners = new Map<string, InstructionOutputCandidate>();
	for (const [key, candidates] of repoGroups) {
		const outputGroup = candidates[0]?.outputGroup;
		const preferred = outputGroup ? (primaryByGroup.get(outputGroup) ?? null) : null;
		const selected = selectCandidate(candidates, preferred);
		if (selected) {
			repoWinners.set(key, selected);
		}
	}

	const activeOutputKeys = new Set<string>();
	const finalCandidates = new Map<string, InstructionOutputCandidate>();
	for (const [key, candidate] of repoWinners) {
		finalCandidates.set(key, candidate);
	}
	for (const [key, candidate] of templateWinners) {
		finalCandidates.set(key, candidate);
	}

	const outputPathGroups = new Map<string, InstructionOutputCandidate[]>();
	for (const candidate of finalCandidates.values()) {
		const outputKey = normalizeKeyPath(candidate.outputPath);
		const list = outputPathGroups.get(outputKey) ?? [];
		list.push(candidate);
		outputPathGroups.set(outputKey, list);
	}
	for (const candidates of outputPathGroups.values()) {
		if (candidates.length < 2) {
			continue;
		}
		const selected = selectCollisionCandidate(candidates);
		if (!selected) {
			continue;
		}
		selected.writer = defaultInstructionWriter;
		for (const candidate of candidates) {
			if (candidate === selected) {
				continue;
			}
			candidate.kind = "satisfied";
			candidate.content = null;
			candidate.writer = defaultInstructionWriter;
		}
	}

	for (const key of finalCandidates.keys()) {
		activeOutputKeys.add(key);
	}

	for (const selection of selections) {
		await runSyncHook(request.hooks, "preSync", {
			repoRoot: request.repoRoot,
			agentsDir: agentsRoot,
			targetId: selection.target.id,
			outputType: "instructions",
		});
		await runSyncHook(selection.target.hooks, "preSync", {
			repoRoot: request.repoRoot,
			agentsDir: agentsRoot,
			targetId: selection.target.id,
			outputType: "instructions",
		});
	}

	const groupResults = new Map<InstructionTargetGroup, GroupResult>();
	const getGroupResult = (group: InstructionTargetGroup): GroupResult => {
		const existing = groupResults.get(group);
		if (existing) {
			return existing;
		}
		const created = createGroupResult();
		groupResults.set(group, created);
		return created;
	};

	const now = new Date().toISOString();
	const activeGroups = new Set<InstructionTargetGroup>(
		selections.map((selection) => selection.group),
	);

	const nextManifestEntries = new Map<string, InstructionManifestEntry>();
	const usedSources = new Map<string, InstructionSource>();
	const recordManagedOutput = (entry: ManagedOutputRecord) => {
		const key = buildManagedOutputKey(entry);
		nextManaged.set(key, entry);
		activeOutputPaths.add(normalizeManagedOutputPath(entry.outputPath));
	};

	for (const candidate of finalCandidates.values()) {
		const groupResult = getGroupResult(candidate.outputGroup);
		const targetForManifest = primaryByGroup.get(candidate.outputGroup) ?? candidate.targetName;
		activeOutputKeys.add(candidate.key);
		if (targetForManifest) {
			const existing = activeSourcesByTarget.get(targetForManifest) ?? new Set<string>();
			existing.add(candidate.source.sourcePath);
			activeSourcesByTarget.set(targetForManifest, existing);
		}
		usedSources.set(candidate.source.sourcePath, candidate.source);

		if (candidate.kind === "satisfied" || !targetForManifest || candidate.content === null) {
			recordCount(groupResult.counts, "skipped");
			continue;
		}

		try {
			if (candidate.converter) {
				await runConvertHook(request.hooks, "preConvert", {
					repoRoot: request.repoRoot,
					agentsDir: agentsRoot,
					targetId: candidate.targetName,
					outputType: "instructions",
				});
				await runConvertHook(selectionById.get(candidate.targetName)?.target.hooks, "preConvert", {
					repoRoot: request.repoRoot,
					agentsDir: agentsRoot,
					targetId: candidate.targetName,
					outputType: "instructions",
				});
				const decision = await candidate.converter.convert(candidate.source, {
					repoRoot: request.repoRoot,
					agentsDir: agentsRoot,
					homeDir,
					targetId: candidate.targetName,
					outputType: "instructions",
					validAgents: request.validAgents,
				});
				const normalized = normalizeConverterDecision(decision);
				await runConvertHook(request.hooks, "postConvert", {
					repoRoot: request.repoRoot,
					agentsDir: agentsRoot,
					targetId: candidate.targetName,
					outputType: "instructions",
				});
				await runConvertHook(selectionById.get(candidate.targetName)?.target.hooks, "postConvert", {
					repoRoot: request.repoRoot,
					agentsDir: agentsRoot,
					targetId: candidate.targetName,
					outputType: "instructions",
				});
				if (normalized.error) {
					groupResult.warnings.push(normalized.error);
					groupResult.hadFailure = true;
					continue;
				}
				if (normalized.skip) {
					recordCount(groupResult.counts, "skipped");
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
							targetId: targetForManifest,
							outputPath,
							sourceType: "instruction",
							sourceId: candidate.source.sourcePath,
							checksum,
							lastSyncedAt: now,
						});
					}
				}
				recordCount(groupResult.counts, "created");
				continue;
			}
			const writeResult = await candidate.writer.write({
				outputPath: candidate.outputPath,
				content: candidate.content,
				item: { sourcePath: candidate.source.sourcePath, content: candidate.content },
				context: {
					repoRoot: request.repoRoot,
					agentsDir: agentsRoot,
					homeDir,
					targetId: candidate.targetName,
					outputType: "instructions",
					validAgents: request.validAgents,
				},
			});
			recordCount(groupResult.counts, writeResult.status);
			const contentHash =
				writeResult.contentHash ??
				(await hashOutputPath(candidate.outputPath)) ??
				hashContent(candidate.content);
			nextManifestEntries.set(candidate.key, {
				outputPath: candidate.outputPath,
				targetName: targetForManifest,
				sourcePath: candidate.source.sourcePath,
				contentHash,
				lastSyncedAt: now,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const display = formatDisplayPath(request.repoRoot, candidate.outputPath);
			groupResult.warnings.push(`Failed to write ${display}: ${message}`);
			groupResult.hadFailure = true;
		}
	}

	const previousManifest = (await readManifest(request.repoRoot)) ?? { entries: [] };
	const previousEntries = new Map<string, InstructionManifestEntry>();
	for (const entry of previousManifest.entries) {
		const group = resolveInstructionTargetGroup(entry.targetName);
		const key = buildOutputKey(entry.outputPath, group);
		const existing = previousEntries.get(key);
		if (!existing || existing.lastSyncedAt < entry.lastSyncedAt) {
			previousEntries.set(key, entry);
		}
	}

	const mergedEntries = new Map<string, InstructionManifestEntry>();
	const nonInteractive = request.nonInteractive ?? false;

	const recordRemoval = (group: InstructionTargetGroup, status: "removed" | "skipped") => {
		const groupResult = getGroupResult(group);
		recordCount(groupResult.counts, status);
	};

	const handleRemovalFailure = (group: InstructionTargetGroup, message: string) => {
		const groupResult = getGroupResult(group);
		groupResult.warnings.push(message);
		groupResult.hadFailure = true;
	};

	for (const [key, entry] of previousEntries) {
		const group = resolveInstructionTargetGroup(entry.targetName);
		const groupSelected = activeGroups.has(group);
		if (!groupSelected) {
			mergedEntries.set(key, entry);
			continue;
		}

		if (activeOutputKeys.has(key)) {
			if (!nextManifestEntries.has(key)) {
				continue;
			}
			continue;
		}

		if (!removeMissing) {
			mergedEntries.set(key, entry);
			continue;
		}

		try {
			const stats = await stat(entry.outputPath);
			if (!stats.isFile()) {
				const display = formatDisplayPath(request.repoRoot, entry.outputPath);
				handleRemovalFailure(group, `Skipping removal of non-file output: ${display}.`);
				mergedEntries.set(key, entry);
				recordRemoval(group, "skipped");
				continue;
			}
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT") {
				recordRemoval(group, "removed");
				continue;
			}
			const display = formatDisplayPath(request.repoRoot, entry.outputPath);
			handleRemovalFailure(group, `Failed to stat output ${display}: ${String(error)}`);
			mergedEntries.set(key, entry);
			recordRemoval(group, "skipped");
			continue;
		}

		let existingBuffer: Buffer;
		try {
			existingBuffer = await readFile(entry.outputPath);
		} catch (error) {
			const display = formatDisplayPath(request.repoRoot, entry.outputPath);
			handleRemovalFailure(group, `Failed to read output ${display}: ${String(error)}`);
			mergedEntries.set(key, entry);
			recordRemoval(group, "skipped");
			continue;
		}

		const existingHash = hashContent(existingBuffer);
		if (existingHash !== entry.contentHash) {
			const display = formatDisplayPath(request.repoRoot, entry.outputPath);
			if (nonInteractive || !request.confirmRemoval) {
				warnings.push(
					`Output modified since last sync; skipping removal of ${display} (non-interactive).`,
				);
				mergedEntries.set(key, entry);
				recordRemoval(group, "skipped");
				continue;
			}
			const confirmed = await request.confirmRemoval({
				outputPath: entry.outputPath,
				sourcePath: entry.sourcePath,
				targetName: entry.targetName,
			});
			if (!confirmed) {
				warnings.push(`Output modified; keeping ${display}.`);
				mergedEntries.set(key, entry);
				recordRemoval(group, "skipped");
				continue;
			}
		}

		try {
			await rm(entry.outputPath, { force: true });
			recordRemoval(group, "removed");
		} catch (error) {
			const display = formatDisplayPath(request.repoRoot, entry.outputPath);
			handleRemovalFailure(group, `Failed to remove output ${display}: ${String(error)}`);
			mergedEntries.set(key, entry);
			recordRemoval(group, "skipped");
		}
	}

	for (const [key, entry] of nextManifestEntries) {
		mergedEntries.set(key, entry);
	}

	await writeManifest(request.repoRoot, { entries: Array.from(mergedEntries.values()) });

	for (const selection of selections) {
		await runSyncHook(request.hooks, "postSync", {
			repoRoot: request.repoRoot,
			agentsDir: agentsRoot,
			targetId: selection.target.id,
			outputType: "instructions",
		});
		await runSyncHook(selection.target.hooks, "postSync", {
			repoRoot: request.repoRoot,
			agentsDir: agentsRoot,
			targetId: selection.target.id,
			outputType: "instructions",
		});
	}

	if (managedManifest.entries.length > 0 || nextManaged.size > 0) {
		const updatedEntries: ManagedOutputRecord[] = [];
		for (const entry of managedManifest.entries) {
			if (entry.sourceType !== "instruction" || !selectedTargetIds.has(entry.targetId)) {
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
				const group = resolveInstructionTargetGroup(entry.targetId);
				recordCount(getGroupResult(group).counts, "removed");
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

	const sourceCounts: SyncSourceCounts = {
		shared: 0,
		local: 0,
		excludedLocal: request.excludeLocal ?? false,
	};
	for (const source of usedSources.values()) {
		if (source.sourceType === "local") {
			sourceCounts.local += 1;
		} else {
			sourceCounts.shared += 1;
		}
	}

	const results: InstructionSyncResult[] = [];
	let hadFailures = false;

	for (const selection of selections) {
		const targetName = selection.target.id;
		const group = selection.group;
		const groupResult = groupResults.get(group) ?? createGroupResult();
		const primaryTarget = primaryByGroup.get(group);
		const isPrimary = !primaryTarget || targetName === primaryTarget;
		const counts = isPrimary ? groupResult.counts : emptyOutputCounts();
		const status = groupResult.hadFailure
			? groupResult.counts.total > 0
				? "partial"
				: "failed"
			: "synced";
		const sharedLabel =
			typeof selection.definition.filename === "string"
				? selection.definition.filename
				: "instruction";
		const message = isPrimary
			? buildInstructionResultMessage({
					targetName,
					status,
					counts,
				})
			: `Shared ${sharedLabel} output with ${primaryTarget}.`;
		if (groupResult.hadFailure) {
			hadFailures = true;
		}
		results.push({
			targetName,
			status: isPrimary ? status : "skipped",
			message,
			counts,
			warnings: isPrimary ? groupResult.warnings : [],
		});
	}

	return {
		sourcePath: summarySourcePath,
		results,
		warnings,
		hadFailures,
		sourceCounts,
	};
}
