import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { applyAgentTemplating } from "../agent-templating.js";
import { listSkillDirectories, type SkillDirectoryEntry } from "../catalog-utils.js";
import { stripFrontmatterFields } from "../frontmatter-strip.js";
import {
	resolveLocalCategoryRoot,
	resolveSharedCategoryRoot,
	stripLocalPathSuffix,
} from "../local-sources.js";
import {
	buildSummary,
	type SyncResult,
	type SyncSourceCounts,
	type SyncSummary,
} from "../sync-results.js";
import {
	resolveEffectiveTargets,
	TARGETS,
	type TargetName,
	type TargetSpec,
} from "../sync-targets.js";
import { loadSkillCatalog, type SkillDefinition } from "./catalog.js";

export type SkillSyncRequest = {
	repoRoot: string;
	agentsDir?: string | null;
	targets: TargetSpec[];
	overrideOnly?: TargetName[] | null;
	overrideSkip?: TargetName[] | null;
	validAgents: string[];
	excludeLocal?: boolean;
	removeMissing?: boolean;
};

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const TARGET_FRONTMATTER_KEYS = new Set(["targets", "targetagents"]);
const ALL_TARGET_NAMES = TARGETS.map((target) => target.name);

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

function normalizeRelativePath(relativePath: string): string {
	return path.normalize(relativePath).replace(/\\/g, "/").toLowerCase();
}

function resolveSkillRelativePathForDirectory(
	skillsRoot: string,
	directoryPath: string,
): { relativePath: string; hadLocalSuffix: boolean } | null {
	const relativePath = path.relative(skillsRoot, directoryPath);
	if (!relativePath) {
		return null;
	}
	const baseName = path.basename(relativePath);
	const { baseName: strippedBase, hadLocalSuffix } = stripLocalPathSuffix(baseName);
	if (!hadLocalSuffix) {
		return { relativePath, hadLocalSuffix: false };
	}
	const parent = path.dirname(relativePath);
	const normalized = parent === "." ? strippedBase : path.join(parent, strippedBase);
	return { relativePath: normalized, hadLocalSuffix: true };
}

async function listSkillDirectoriesSafe(root: string): Promise<SkillDirectoryEntry[]> {
	try {
		return await listSkillDirectories(root);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") {
			return [];
		}
		throw error;
	}
}

async function resolveLocalOnlySkillPaths(
	repoRoot: string,
	agentsDir?: string | null,
): Promise<string[]> {
	const skillsRoot = resolveSharedCategoryRoot(repoRoot, "skills", agentsDir);
	const localSkillsRoot = resolveLocalCategoryRoot(repoRoot, "skills", agentsDir);
	const sharedEntries = await listSkillDirectoriesSafe(skillsRoot);
	const localEntries = await listSkillDirectoriesSafe(localSkillsRoot);

	const sharedRelativePaths = new Set<string>();
	for (const entry of sharedEntries) {
		if (!entry.sharedSkillFile) {
			continue;
		}
		const resolved = resolveSkillRelativePathForDirectory(skillsRoot, entry.directoryPath);
		if (!resolved || resolved.hadLocalSuffix) {
			continue;
		}
		sharedRelativePaths.add(normalizeRelativePath(resolved.relativePath));
	}

	const localOnly = new Map<string, string>();
	const considerLocal = (relativePath: string | null) => {
		if (!relativePath) {
			return;
		}
		const normalized = normalizeRelativePath(relativePath);
		if (sharedRelativePaths.has(normalized) || localOnly.has(normalized)) {
			return;
		}
		localOnly.set(normalized, relativePath);
	};

	for (const entry of localEntries) {
		const resolved = resolveSkillRelativePathForDirectory(localSkillsRoot, entry.directoryPath);
		if (!resolved) {
			continue;
		}
		considerLocal(resolved.relativePath);
	}

	for (const entry of sharedEntries) {
		const resolved = resolveSkillRelativePathForDirectory(skillsRoot, entry.directoryPath);
		if (!resolved) {
			continue;
		}
		if (resolved.hadLocalSuffix || entry.localSkillFile) {
			considerLocal(resolved.relativePath);
		}
	}

	return [...localOnly.values()];
}

function hasProtectedChildSkill(
	localRelativePath: string,
	selectedRelativePaths: string[],
): boolean {
	if (!localRelativePath || selectedRelativePaths.length === 0) {
		return false;
	}
	const normalizedLocal = normalizeRelativePath(localRelativePath).replace(/\/+$/, "");
	const prefix = `${normalizedLocal}/`;
	for (const selected of selectedRelativePaths) {
		const normalizedSelected = normalizeRelativePath(selected);
		if (normalizedSelected.startsWith(prefix)) {
			return true;
		}
	}
	return false;
}

async function copySkillDirectory(options: {
	source: string;
	destination: string;
	target: TargetName;
	validAgents: string[];
	skillFileName: string;
	outputFileName: string;
}): Promise<void> {
	await mkdir(options.destination, { recursive: true });
	const entries = await readdir(options.source, { withFileTypes: true });
	const selectedSkillFile = options.skillFileName.toLowerCase();
	const outputSkillFile = options.outputFileName;

	for (const entry of entries) {
		const sourcePath = path.join(options.source, entry.name);
		const entryLowerName = entry.name.toLowerCase();
		const isSkillFile = entryLowerName === "skill.md" || entryLowerName === "skill.local.md";
		if (isSkillFile && entryLowerName !== selectedSkillFile) {
			continue;
		}
		const destinationPath = isSkillFile
			? path.join(options.destination, outputSkillFile)
			: path.join(options.destination, entry.name);
		if (entry.isDirectory()) {
			await copySkillDirectory({
				...options,
				source: sourcePath,
				destination: path.join(options.destination, entry.name),
			});
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}

		const buffer = await readFile(sourcePath);
		const decoded = decodeUtf8(buffer);
		if (decoded === null) {
			await mkdir(path.dirname(destinationPath), { recursive: true });
			await writeFile(destinationPath, buffer);
			continue;
		}

		const templated = applyAgentTemplating({
			content: decoded,
			target: options.target,
			validAgents: options.validAgents,
			sourcePath,
		});
		const output = isSkillFile
			? stripFrontmatterFields(templated, TARGET_FRONTMATTER_KEYS)
			: templated;
		await mkdir(path.dirname(destinationPath), { recursive: true });
		await writeFile(destinationPath, output, "utf8");
	}
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

function resolveEffectiveTargetsForSkill(
	skill: SkillDefinition,
	overrideOnly?: TargetName[] | null,
	overrideSkip?: TargetName[] | null,
): TargetName[] {
	return resolveEffectiveTargets({
		defaultTargets: skill.targetAgents,
		overrideOnly: overrideOnly ?? undefined,
		overrideSkip: overrideSkip ?? undefined,
		allTargets: ALL_TARGET_NAMES,
	});
}

export async function syncSkills(request: SkillSyncRequest): Promise<SyncSummary> {
	const sourcePath = resolveSharedCategoryRoot(request.repoRoot, "skills", request.agentsDir);
	if (request.targets.length === 0) {
		return buildSummary(sourcePath, [], [], {
			shared: 0,
			local: 0,
			excludedLocal: request.excludeLocal ?? false,
		});
	}

	const catalog = await loadSkillCatalog(request.repoRoot, {
		includeLocal: !request.excludeLocal,
		agentsDir: request.agentsDir,
	});
	const warnings = buildInvalidTargetWarnings(catalog.skills);
	const effectiveTargetsBySkill = new Map<SkillDefinition, TargetName[]>();
	for (const skill of catalog.skills) {
		effectiveTargetsBySkill.set(
			skill,
			resolveEffectiveTargetsForSkill(skill, request.overrideOnly, request.overrideSkip),
		);
	}

	const targetNames = new Set(request.targets.map((target) => target.name));
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
	const sourceDisplay = formatDisplayPath(request.repoRoot, sourcePath);
	const removeMissing = request.removeMissing ?? false;
	const localOnlyPaths =
		request.excludeLocal && removeMissing
			? await resolveLocalOnlySkillPaths(request.repoRoot, request.agentsDir)
			: [];

	for (const target of request.targets) {
		const destPath = path.join(request.repoRoot, target.relativePath);
		const destDisplay = formatDisplayPath(request.repoRoot, destPath);
		const selectedSkills = catalog.skills.filter((skill) => {
			const effectiveTargets = effectiveTargetsBySkill.get(skill) ?? [];
			return effectiveTargets.includes(target.name);
		});

		try {
			for (const skill of selectedSkills) {
				const destinationDir = path.join(destPath, skill.relativePath);
				await copySkillDirectory({
					source: skill.directoryPath,
					destination: destinationDir,
					target: target.name,
					validAgents: request.validAgents,
					skillFileName: skill.skillFileName,
					outputFileName: skill.outputFileName,
				});
			}
			if (localOnlyPaths.length > 0) {
				const protectedPaths = selectedSkills.map((skill) => skill.relativePath);
				for (const localRelativePath of localOnlyPaths) {
					if (hasProtectedChildSkill(localRelativePath, protectedPaths)) {
						continue;
					}
					const removePath = path.join(destPath, localRelativePath);
					await rm(removePath, { recursive: true, force: true });
				}
			}
			results.push({
				targetName: target.name,
				status: "synced",
				message: `Synced ${sourceDisplay} -> ${destDisplay}`,
			});
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			results.push({
				targetName: target.name,
				status: "failed",
				message: `Failed ${sourceDisplay} -> ${destDisplay}: ${errorMessage}`,
				error: errorMessage,
			});
		}
	}

	return buildSummary(sourcePath, results, warnings, sourceCounts);
}
