import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyAgentTemplating } from "../agent-templating.js";
import { resolveAgentsDirPath } from "../agents-dir.js";
import { resolveLocalPrecedence } from "../local-precedence.js";
import type { SyncSourceCounts } from "../sync-results.js";
import { resolveEffectiveTargets, TARGETS } from "../sync-targets.js";
import { loadInstructionTemplateCatalog } from "./catalog.js";
import { type InstructionManifestEntry, readManifest, writeManifest } from "./manifest.js";
import { resolveInstructionOutputPath, resolveRepoInstructionOutputPath } from "./paths.js";
import { scanRepoInstructionSources } from "./scan.js";
import {
	buildInstructionResultMessage,
	emptyOutputCounts,
	type InstructionOutputCounts,
	type InstructionSyncResult,
	type InstructionSyncSummary,
} from "./summary.js";
import {
	type InstructionTargetGroup,
	type InstructionTargetName,
	isAgentsTarget,
	resolveInstructionTargetGroup,
} from "./targets.js";
import type { InstructionRepoSource, InstructionSource } from "./types.js";

export type { InstructionSyncSummary } from "./summary.js";

export type InstructionSyncRequest = {
	repoRoot: string;
	agentsDir?: string | null;
	targets: InstructionTargetName[];
	overrideOnly?: InstructionTargetName[] | null;
	overrideSkip?: InstructionTargetName[] | null;
	excludeLocal?: boolean;
	removeMissing?: boolean;
	nonInteractive?: boolean;
	validAgents: string[];
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
};

type GroupResult = {
	counts: InstructionOutputCounts;
	warnings: string[];
	hadFailure: boolean;
};

const ALL_TARGET_NAMES = TARGETS.map((target) => target.name);

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

async function loadRepoSources(options: {
	repoRoot: string;
	includeLocal: boolean;
	agentsDir?: string | null;
}): Promise<InstructionRepoSource[]> {
	const entries = await scanRepoInstructionSources({
		repoRoot: options.repoRoot,
		includeLocal: options.includeLocal,
		agentsDir: options.agentsDir,
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
	overrideOnly?: InstructionTargetName[] | null,
	overrideSkip?: InstructionTargetName[] | null,
): InstructionTargetName[] {
	const defaultTargets = source.kind === "template" ? source.targets : null;
	const effective = resolveEffectiveTargets({
		defaultTargets,
		overrideOnly: overrideOnly ?? undefined,
		overrideSkip: overrideSkip ?? undefined,
		allTargets: ALL_TARGET_NAMES,
	});
	return effective.filter((target) => selectedTargets.has(target as InstructionTargetName)) as
		InstructionTargetName[];
}

async function readExistingBuffer(filePath: string): Promise<Buffer | null> {
	try {
		return await readFile(filePath);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

async function writeOutputFile(
	outputPath: string,
	content: string,
): Promise<{ status: "created" | "updated" | "skipped"; hash: string }> {
	const buffer = Buffer.from(content, "utf8");
	const hash = hashContent(buffer);
	const existing = await readExistingBuffer(outputPath);
	if (existing?.equals(buffer)) {
		return { status: "skipped", hash };
	}
	await mkdir(path.dirname(outputPath), { recursive: true });
	await writeFile(outputPath, buffer);
	return { status: existing ? "updated" : "created", hash };
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

export async function syncInstructions(
	request: InstructionSyncRequest,
): Promise<InstructionSyncSummary> {
	const selectedTargets = new Set(request.targets);
	const includeLocal = !(request.excludeLocal ?? false);
	const summarySourcePath = request.repoRoot;
	const agentsRoot = resolveAgentsDirPath(request.repoRoot, request.agentsDir);
	const rootTemplatePath = path.join(agentsRoot, "AGENTS.md");
	const rootTemplateDisplay = formatDisplayPath(request.repoRoot, rootTemplatePath);
	const warnings: string[] = [];
	const primaryAgentsTarget: InstructionTargetName | null = selectedTargets.has("codex")
		? "codex"
		: selectedTargets.has("copilot")
			? "copilot"
			: null;

	if (request.targets.length === 0) {
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

	const [templateCatalog, repoSources] = await Promise.all([
		loadInstructionTemplateCatalog({
			repoRoot: request.repoRoot,
			includeLocal,
			agentsDir: request.agentsDir,
		}),
		loadRepoSources({
			repoRoot: request.repoRoot,
			includeLocal,
			agentsDir: request.agentsDir,
		}),
	]);

	const templateCandidates: InstructionOutputCandidate[] = [];
	for (const template of templateCatalog.templates) {
		const resolvedOutputDir = template.resolvedOutputDir;
		if (!resolvedOutputDir) {
			const display = formatDisplayPath(request.repoRoot, template.sourcePath);
			warnings.push(
				`Instruction template missing outPutPath (required outside ${rootTemplateDisplay}): ${display}.`,
			);
			continue;
		}
		const effectiveTargets = resolveEffectiveTargetsForSource(
			template,
			selectedTargets,
			request.overrideOnly,
			request.overrideSkip,
		);
		if (effectiveTargets.length === 0) {
			continue;
		}
		for (const targetName of effectiveTargets) {
			const outputGroup = resolveInstructionTargetGroup(targetName);
			const outputPath = resolveInstructionOutputPath(resolvedOutputDir, targetName);
			const key = buildOutputKey(outputPath, outputGroup);
			const content = applyAgentTemplating({
				content: template.body,
				target: targetName,
				validAgents: request.validAgents,
				sourcePath: template.sourcePath,
			});
			templateCandidates.push({
				key,
				outputGroup,
				outputPath,
				targetName,
				source: template,
				content,
				kind: "generated",
			});
		}
	}

	const repoCandidates: InstructionOutputCandidate[] = [];
	for (const source of repoSources) {
		const effectiveTargets = resolveEffectiveTargetsForSource(
			source,
			selectedTargets,
			request.overrideOnly,
			request.overrideSkip,
		);
		if (effectiveTargets.length === 0) {
			continue;
		}
		for (const targetName of effectiveTargets) {
			const outputGroup = resolveInstructionTargetGroup(targetName);
			const outputPath = resolveRepoInstructionOutputPath(source.sourcePath, targetName);
			const key = buildOutputKey(outputPath, outputGroup);
			const isAgentsOutput = isAgentsTarget(targetName);
			repoCandidates.push({
				key,
				outputGroup,
				outputPath,
				targetName,
				source,
				content: isAgentsOutput ? null : source.body,
				kind: isAgentsOutput ? "satisfied" : "generated",
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
		const preferred = outputGroup === "agents" ? primaryAgentsTarget : null;
		const selected = selectCandidate(candidates, preferred);
		if (selected) {
			templateWinners.set(key, selected);
		}
	}
	const repoWinners = new Map<string, InstructionOutputCandidate>();
	for (const [key, candidates] of repoGroups) {
		const outputGroup = candidates[0]?.outputGroup;
		const preferred = outputGroup === "agents" ? primaryAgentsTarget : null;
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
	for (const key of finalCandidates.keys()) {
		activeOutputKeys.add(key);
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
		Array.from(selectedTargets).map((target) => resolveInstructionTargetGroup(target)),
	);

	const nextManifestEntries = new Map<string, InstructionManifestEntry>();
	const usedSources = new Map<string, InstructionSource>();

	for (const candidate of finalCandidates.values()) {
		const groupResult = getGroupResult(candidate.outputGroup);
		const targetForManifest =
			candidate.outputGroup === "agents" ? primaryAgentsTarget : candidate.targetName;
		activeOutputKeys.add(candidate.key);
		usedSources.set(candidate.source.sourcePath, candidate.source);

		if (candidate.kind === "satisfied" || !targetForManifest || candidate.content === null) {
			recordCount(groupResult.counts, "skipped");
			continue;
		}

		try {
			const writeResult = await writeOutputFile(candidate.outputPath, candidate.content);
			recordCount(groupResult.counts, writeResult.status);
			nextManifestEntries.set(candidate.key, {
				outputPath: candidate.outputPath,
				targetName: targetForManifest,
				sourcePath: candidate.source.sourcePath,
				contentHash: writeResult.hash,
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
	const removeMissing = request.removeMissing ?? false;
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

	for (const targetName of request.targets) {
		const group = resolveInstructionTargetGroup(targetName);
		const groupResult = groupResults.get(group) ?? createGroupResult();
		const isAgentsGroup = group === "agents";
		const isPrimaryAgents = !isAgentsGroup || targetName === primaryAgentsTarget;
		const counts = isPrimaryAgents ? groupResult.counts : emptyOutputCounts();
		const status = groupResult.hadFailure
			? groupResult.counts.total > 0
				? "partial"
				: "failed"
			: "synced";
		const message = isPrimaryAgents
			? buildInstructionResultMessage({
					targetName,
					status,
					counts,
				})
			: `Shared AGENTS.md output with ${primaryAgentsTarget}.`;
		if (groupResult.hadFailure) {
			hadFailures = true;
		}
		results.push({
			targetName,
			status: isPrimaryAgents ? status : "skipped",
			message,
			counts,
			warnings: isPrimaryAgents ? groupResult.warnings : [],
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
