import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveAgentsDirPath } from "../agents-dir.js";
import { resolveSharedCategoryRoot } from "../local-sources.js";
import {
	buildSummary,
	type SyncResult,
	type SyncSourceCounts,
	type SyncSummary,
} from "../sync-results.js";
import { resolveEffectiveTargets, type TargetName } from "../sync-targets.js";
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
import { normalizeOutputDefinition, resolveOutputPath } from "../targets/output-resolver.js";
import {
	defaultSkillWriter,
	resolveWriter,
	type SkillWriterItem,
	type WriterRegistry,
	writeFileOutput,
} from "../targets/writers.js";
import { loadSkillCatalog, type SkillDefinition } from "./catalog.js";

export type SkillSyncRequest = {
	repoRoot: string;
	agentsDir?: string | null;
	targets: ResolvedTarget[];
	overrideOnly?: TargetName[] | null;
	overrideSkip?: TargetName[] | null;
	validAgents: string[];
	excludeLocal?: boolean;
	removeMissing?: boolean;
	resolveTargetName?: (value: string) => string | null;
	hooks?: SyncHooks;
};

function formatDisplayPath(repoRoot: string, absolutePath: string): string {
	const relative = path.relative(repoRoot, absolutePath);
	const isWithinRepo = relative && !relative.startsWith("..") && !path.isAbsolute(relative);
	return isWithinRepo ? relative : absolutePath;
}

function buildInvalidTargetWarnings(skills: SkillDefinition[]): string[] {
	const warnings: string[] = [];
	for (const skill of skills) {
		if (skill.invalidTargets.length === 0) {
			continue;
		}
		const invalidList = skill.invalidTargets.join(", ");
		warnings.push(
			`Skill "${skill.name}" has unsupported targets (${invalidList}) in ${skill.sourcePath}.`,
		);
	}
	return warnings;
}

type SkillOutputCandidate = {
	target: ResolvedTarget;
	skill: SkillDefinition;
	outputPath: string;
	outputDef: ReturnType<typeof normalizeOutputDefinition>;
	writer: OutputWriter;
	converter: ConverterRule | null;
};

export async function syncSkills(request: SkillSyncRequest): Promise<SyncSummary> {
	const sourcePath = resolveSharedCategoryRoot(request.repoRoot, "skills", request.agentsDir);
	const skillTargets = request.targets.filter(
		(target) => normalizeOutputDefinition(target.outputs.skills) !== null,
	);
	if (skillTargets.length === 0) {
		return buildSummary(sourcePath, [], [], {
			shared: 0,
			local: 0,
			excludedLocal: request.excludeLocal ?? false,
		});
	}

	const catalog = await loadSkillCatalog(request.repoRoot, {
		includeLocal: !request.excludeLocal,
		agentsDir: request.agentsDir,
		resolveTargetName: request.resolveTargetName,
	});
	const warnings = buildInvalidTargetWarnings(catalog.skills);
	const allTargetIds = request.targets.map((target) => target.id);
	const targetNames = new Set(skillTargets.map((target) => target.id));
	const effectiveTargetsBySkill = new Map<SkillDefinition, TargetName[]>();
	const activeSourcesByTarget = new Map<string, Set<string>>();
	for (const skill of catalog.skills) {
		const effectiveTargets = resolveEffectiveTargets({
			defaultTargets: skill.targetAgents,
			overrideOnly: request.overrideOnly ?? undefined,
			overrideSkip: request.overrideSkip ?? undefined,
			allTargets: allTargetIds,
		});
		effectiveTargetsBySkill.set(skill, effectiveTargets);
		for (const targetId of effectiveTargets) {
			if (!targetNames.has(targetId)) {
				continue;
			}
			const existing = activeSourcesByTarget.get(targetId) ?? new Set<string>();
			existing.add(skill.relativePath);
			activeSourcesByTarget.set(targetId, existing);
		}
	}
	const sourceCounts: SyncSourceCounts = {
		shared: 0,
		local: 0,
		excludedLocal: request.excludeLocal ?? false,
	};
	for (const skill of catalog.skills) {
		const effectiveTargets = effectiveTargetsBySkill.get(skill) ?? [];
		if (!effectiveTargets.some((targetName) => targetNames.has(targetName))) {
			continue;
		}
		if (skill.sourceType === "local") {
			sourceCounts.local += 1;
		} else {
			sourceCounts.shared += 1;
		}
	}

	const results: SyncResult[] = [];
	const agentsDirPath = resolveAgentsDirPath(request.repoRoot, request.agentsDir);
	const homeDir = os.homedir();
	const sourceDisplay = formatDisplayPath(request.repoRoot, sourcePath);
	const removeMissing = request.removeMissing ?? false;
	const converterRegistry: ConverterRegistry = new Map();
	const writerRegistry: WriterRegistry = new Map([[defaultSkillWriter.id, defaultSkillWriter]]);
	const managedManifest = (await readManagedOutputs(request.repoRoot, homeDir)) ?? { entries: [] };
	const nextManaged = new Map<string, ManagedOutputRecord>();
	const activeOutputPaths = new Set<string>();

	const outputDefs = new Map<string, NonNullable<ReturnType<typeof normalizeOutputDefinition>>>();
	for (const target of skillTargets) {
		const normalized = normalizeOutputDefinition(target.outputs.skills);
		if (normalized) {
			outputDefs.set(target.id, normalized);
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

	const candidatesByPath = new Map<string, SkillOutputCandidate[]>();
	for (const skill of catalog.skills) {
		const effectiveTargets = effectiveTargetsBySkill.get(skill) ?? [];
		if (effectiveTargets.length === 0) {
			continue;
		}
		for (const target of skillTargets) {
			if (!effectiveTargets.includes(target.id)) {
				continue;
			}
			const outputDef = outputDefs.get(target.id);
			if (!outputDef) {
				continue;
			}
			const outputPath = resolveOutputPath({
				template: outputDef.path,
				context: {
					repoRoot: request.repoRoot,
					agentsDir: agentsDirPath,
					homeDir,
					targetId: target.id,
					itemName: skill.relativePath,
				},
				item: skill,
				baseDir: request.repoRoot,
			});
			const key = path.normalize(outputPath).replace(/\\\\/g, "/").toLowerCase();
			const writer = resolveWriter(outputDef.writer, writerRegistry) ?? defaultSkillWriter;
			const converter = resolveConverter(outputDef.converter, converterRegistry);
			const list = candidatesByPath.get(key) ?? [];
			list.push({ target, skill, outputPath, outputDef, writer, converter });
			candidatesByPath.set(key, list);
		}
	}

	for (const target of skillTargets) {
		await runSyncHook(request.hooks, "preSync", {
			repoRoot: request.repoRoot,
			agentsDir: agentsDirPath,
			targetId: target.id,
			outputType: "skills",
		});
		await runSyncHook(target.hooks, "preSync", {
			repoRoot: request.repoRoot,
			agentsDir: agentsDirPath,
			targetId: target.id,
			outputType: "skills",
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
		const writer = useDefaultWriter ? defaultSkillWriter : selected.writer;
		const converter = selected.converter;
		const target = selected.target;
		const itemLabel = selected.skill.relativePath || selected.skill.name;
		const recordManagedOutput = (entry: ManagedOutputRecord) => {
			const key = buildManagedOutputKey(entry);
			nextManaged.set(key, entry);
			activeOutputPaths.add(normalizeManagedOutputPath(entry.outputPath));
		};

		let converterActive = false;
		try {
			if (converter) {
				converterActive = true;
				await runConvertHook(request.hooks, "preConvert", {
					repoRoot: request.repoRoot,
					agentsDir: agentsDirPath,
					targetId: target.id,
					outputType: "skills",
				});
				await runConvertHook(target.hooks, "preConvert", {
					repoRoot: request.repoRoot,
					agentsDir: agentsDirPath,
					targetId: target.id,
					outputType: "skills",
				});
				const decision = await converter.convert(selected.skill, {
					repoRoot: request.repoRoot,
					agentsDir: agentsDirPath,
					homeDir,
					targetId: target.id,
					outputType: "skills",
					validAgents: request.validAgents,
				});
				const normalized = normalizeConverterDecision(decision);
				await runConvertHook(request.hooks, "postConvert", {
					repoRoot: request.repoRoot,
					agentsDir: agentsDirPath,
					targetId: target.id,
					outputType: "skills",
				});
				await runConvertHook(target.hooks, "postConvert", {
					repoRoot: request.repoRoot,
					agentsDir: agentsDirPath,
					targetId: target.id,
					outputType: "skills",
				});
				if (normalized.error) {
					recordConverterError(target.id, itemLabel, normalized.error);
					converterActive = false;
					continue;
				}
				if (normalized.skip) {
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
							sourceType: "skill",
							sourceId: selected.skill.relativePath,
							checksum,
							lastSyncedAt: new Date().toISOString(),
						});
					}
				}
				converterActive = false;
				continue;
			}

			const item: SkillWriterItem = {
				directoryPath: selected.skill.directoryPath,
				skillFileName: selected.skill.skillFileName,
				outputFileName: selected.skill.outputFileName,
				sourcePath: selected.skill.sourcePath,
			};
			await writer.write({
				outputPath: selected.outputPath,
				content: selected.skill.rawContents,
				item,
				context: {
					repoRoot: request.repoRoot,
					agentsDir: agentsDirPath,
					homeDir,
					targetId: target.id,
					outputType: "skills",
					validAgents: request.validAgents,
				},
			});
			const checksum = await hashOutputPath(selected.outputPath);
			if (checksum) {
				recordManagedOutput({
					targetId: target.id,
					outputPath: selected.outputPath,
					sourceType: "skill",
					sourceId: selected.skill.relativePath,
					checksum,
					lastSyncedAt: new Date().toISOString(),
					writerId: writer.id,
				});
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

	for (const target of skillTargets) {
		await runSyncHook(request.hooks, "postSync", {
			repoRoot: request.repoRoot,
			agentsDir: agentsDirPath,
			targetId: target.id,
			outputType: "skills",
		});
		await runSyncHook(target.hooks, "postSync", {
			repoRoot: request.repoRoot,
			agentsDir: agentsDirPath,
			targetId: target.id,
			outputType: "skills",
		});
	}

	if (managedManifest.entries.length > 0 || nextManaged.size > 0) {
		const updatedEntries: ManagedOutputRecord[] = [];
		const managedTargetIds = new Set(skillTargets.map((target) => target.id));
		for (const entry of managedManifest.entries) {
			if (entry.sourceType !== "skill" || !managedTargetIds.has(entry.targetId)) {
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

	for (const target of skillTargets) {
		const items = converterErrorsByTarget.get(target.id);
		if (items && items.size > 0) {
			warnings.push(
				`Converter errors in skills for ${target.displayName}: ${[...items].sort().join(", ")}.`,
			);
		}
	}

	for (const target of skillTargets) {
		const errors = targetErrors.get(target.id);
		if (errors && errors.length > 0) {
			const combined = errors.join("; ");
			results.push({
				targetName: target.id,
				status: "failed",
				message: `Failed ${sourceDisplay} for ${target.displayName}: ${combined}`,
				error: combined,
			});
		} else {
			results.push({
				targetName: target.id,
				status: "synced",
				message: `Synced ${sourceDisplay} for ${target.displayName}.`,
			});
		}
	}

	return buildSummary(sourcePath, results, warnings, sourceCounts);
}
