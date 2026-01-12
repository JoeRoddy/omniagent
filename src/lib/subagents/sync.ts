import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSubagentCatalog, type SubagentDefinition } from "./catalog.js";
import {
	type ManagedSubagent,
	readManifest,
	resolveManifestPath,
	type SubagentSyncManifest,
	writeManifest,
} from "./manifest.js";
import {
	getSubagentProfile,
	resolveSkillDirectory,
	resolveSubagentDirectory,
	SUBAGENT_TARGETS,
	type SubagentTargetName,
} from "./targets.js";

export type SubagentSyncRequest = {
	repoRoot: string;
	targets?: SubagentTargetName[];
	removeMissing?: boolean;
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

const SKILL_FRONTMATTER_KEYS_TO_REMOVE = new Set(["tools", "model", "color"]);

function emptySummaryCounts(): SummaryCounts {
	return { created: 0, updated: 0, removed: 0, converted: 0, skipped: 0 };
}

function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function normalizeName(name: string): string {
	return name.toLowerCase();
}

function normalizeSkillKey(name: string): string {
	return path.normalize(name).replace(/\\/g, "/").toLowerCase();
}

function stripFrontmatterFields(contents: string, keysToRemove: Set<string>): string {
	const lines = contents.split(/\r?\n/);
	if (lines[0]?.trim() !== "---") {
		return contents;
	}

	let endIndex = -1;
	for (let i = 1; i < lines.length; i += 1) {
		if (lines[i].trim() === "---") {
			endIndex = i;
			break;
		}
	}

	if (endIndex === -1) {
		return contents;
	}

	const frontmatterLines = lines.slice(1, endIndex);
	const filtered: string[] = [];
	let skippingList = false;

	for (const line of frontmatterLines) {
		const trimmed = line.trim();
		const match = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);

		if (skippingList) {
			if (match && !keysToRemove.has(match[1])) {
				skippingList = false;
			} else if (!match) {
				const shouldSkip = trimmed === "" || trimmed.startsWith("-") || trimmed.startsWith("#");
				if (shouldSkip) {
					continue;
				}
				skippingList = false;
			} else {
				continue;
			}
		}

		if (match) {
			const [, key, rawValue] = match;
			if (keysToRemove.has(key)) {
				const rest = rawValue.trim();
				if (!rest || rest.startsWith("#")) {
					skippingList = true;
				}
				continue;
			}
		}

		if (!skippingList) {
			filtered.push(line);
		}
	}

	const eol = contents.includes("\r\n") ? "\r\n" : "\n";
	const outputLines = [lines[0], ...filtered, ...lines.slice(endIndex)];
	return outputLines.join(eol);
}

async function listSkillDirectories(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const directories: string[] = [];
	let hasSkillFile = false;

	for (const entry of entries) {
		if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
			hasSkillFile = true;
		}
	}

	if (hasSkillFile) {
		directories.push(root);
	}

	for (const entry of entries) {
		if (entry.isDirectory()) {
			directories.push(...(await listSkillDirectories(path.join(root, entry.name))));
		}
	}

	return directories;
}

async function loadCanonicalSkillIndex(repoRoot: string): Promise<Map<string, string>> {
	const skillsRoot = path.join(repoRoot, "agents", "skills");
	let directories: string[] = [];
	try {
		directories = await listSkillDirectories(skillsRoot);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") {
			return new Map();
		}
		throw error;
	}

	const index = new Map<string, string>();
	for (const directory of directories) {
		const relative = path.relative(skillsRoot, directory);
		if (!relative) {
			continue;
		}
		const key = normalizeSkillKey(relative);
		if (!index.has(key)) {
			index.set(key, relative);
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
		destinationPath: path.join(destinationDir, `${subagentName}.md`),
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

async function buildTargetPlan(
	params: {
		request: SubagentSyncRequest;
		subagents: SubagentDefinition[];
		removeMissing: boolean;
		timestamp: string;
		canonicalSkills: Map<string, string>;
	},
	targetName: SubagentTargetName,
): Promise<TargetPlan> {
	const { request, subagents, removeMissing } = params;
	const profile = getSubagentProfile(targetName);
	const outputKind: OutputKind = profile.supportsSubagents ? "subagent" : "skill";
	const destinationDir = profile.supportsSubagents
		? resolveSubagentDirectory(targetName, request.repoRoot)
		: resolveSkillDirectory(targetName, request.repoRoot);
	const manifestPath = resolveManifestPath(request.repoRoot, targetName, os.homedir());
	const warnings: string[] = [];
	const summary = emptySummaryCounts();
	const actions: SubagentSyncPlanAction[] = [];
	const canonicalSkillsRoot = path.join(request.repoRoot, "agents", "skills");

	if (!profile.supportsSubagents && subagents.length > 0) {
		warnings.push(
			`${profile.displayName} does not support Claude-format subagents; converting to skills.`,
		);
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
		const nameKey = normalizeName(subagent.resolvedName);
		catalogNames.add(nameKey);
		const canonicalSkillKey =
			outputKind === "skill" ? normalizeSkillKey(subagent.resolvedName) : null;
		const canonicalSkillRelative =
			canonicalSkillKey && params.canonicalSkills.get(canonicalSkillKey);
		if (outputKind === "skill" && canonicalSkillRelative) {
			const { destinationPath } = resolveOutputPaths(
				outputKind,
				destinationDir,
				subagent.resolvedName,
			);
			const canonicalSkillPath = path.join(canonicalSkillsRoot, canonicalSkillRelative, "SKILL.md");
			actions.push({
				targetName,
				action: "skip",
				subagentName: subagent.resolvedName,
				destinationPath,
				conflict: true,
			});
			summary.skipped += 1;
			warnings.push(
				`Skipped ${profile.displayName} skill "${
					subagent.resolvedName
				}" because canonical skill exists at ${canonicalSkillPath}.`,
			);
			continue;
		}

		const output =
			outputKind === "skill"
				? stripFrontmatterFields(subagent.rawContents, SKILL_FRONTMATTER_KEYS_TO_REMOVE)
				: subagent.rawContents;
		const outputHash = hashContent(output);
		const { destinationPath } = resolveOutputPaths(
			outputKind,
			destinationDir,
			subagent.resolvedName,
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
			`Skipped ${profile.displayName} ${
				outputKind === "skill" ? "skill" : "subagent"
			} "${subagent.resolvedName}" because an unmanaged file exists at ${destinationPath}.`,
		);
	}

	if (removeMissing && previousManaged.size > 0) {
		for (const entry of previousManaged.values()) {
			if (catalogNames.has(normalizeName(entry.name))) {
				continue;
			}
			const removalBase = outputKind === "skill" ? entry.name : `${entry.name}.md`;
			const removalPath =
				outputKind === "skill"
					? path.join(destinationDir, entry.name)
					: path.join(destinationDir, removalBase);
			if (outputKind === "skill") {
				const canonicalSkillKey = normalizeSkillKey(entry.name);
				const canonicalSkillRelative = params.canonicalSkills.get(canonicalSkillKey);
				if (canonicalSkillRelative) {
					const canonicalSkillPath = path.join(
						canonicalSkillsRoot,
						canonicalSkillRelative,
						"SKILL.md",
					);
					actions.push({
						targetName,
						action: "skip",
						subagentName: entry.name,
						destinationPath: removalPath,
						conflict: true,
					});
					summary.skipped += 1;
					warnings.push(
						`Skipped removing ${profile.displayName} skill "${
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
		displayName: profile.displayName,
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
	const catalog = await loadSubagentCatalog(request.repoRoot);
	const canonicalSkills = await loadCanonicalSkillIndex(request.repoRoot);
	const selectedTargets =
		request.targets && request.targets.length > 0
			? request.targets
			: SUBAGENT_TARGETS.map((target) => target.name);
	const removeMissing = request.removeMissing ?? true;
	const timestamp = new Date().toISOString();

	const targetPlans: TargetPlan[] = [];
	for (const targetName of selectedTargets) {
		targetPlans.push(
			await buildTargetPlan(
				{ request, subagents: catalog.subagents, removeMissing, timestamp, canonicalSkills },
				targetName,
			),
		);
	}

	const actions = targetPlans.flatMap((plan) => plan.actions);
	const planSummary = buildActionSummary(actions, selectedTargets);
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

	const warnings = results.flatMap((result) => result.warnings);

	return {
		sourcePath: planDetails.sourcePath,
		results,
		warnings,
		hadFailures,
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
	return lines.join("\n");
}
