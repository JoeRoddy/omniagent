import { readFile } from "node:fs/promises";
import path from "node:path";
import { listSkillDirectories, readDirectoryStats } from "../catalog-utils.js";
import { resolveLocalPrecedence } from "../local-precedence.js";
import {
	buildSourceMetadata,
	type LocalMarkerType,
	resolveLocalCategoryRoot,
	resolveSharedCategoryRoot,
	type SourceType,
	stripLocalPathSuffix,
	stripLocalSuffix,
} from "../local-sources.js";
import { extractFrontmatter, type FrontmatterValue } from "../slash-commands/frontmatter.js";
import {
	createTargetNameResolver,
	hasRawTargetValues,
	InvalidFrontmatterTargetsError,
	resolveFrontmatterTargets,
	type TargetName,
} from "../sync-targets.js";
import { BUILTIN_TARGETS } from "../targets/builtins.js";

export type SkillDefinition = {
	name: string;
	relativePath: string;
	directoryPath: string;
	sourcePath: string;
	sourceType: SourceType;
	markerType?: LocalMarkerType;
	isLocalFallback: boolean;
	skillFileName: string;
	outputFileName: string;
	rawContents: string;
	frontmatter: Record<string, FrontmatterValue>;
	body: string;
	targetAgents: TargetName[] | null;
	invalidTargets: string[];
};

export type SkillCatalog = {
	repoRoot: string;
	skillsRoot: string;
	localSkillsRoot: string;
	skills: SkillDefinition[];
	sharedSkills: SkillDefinition[];
	localSkills: SkillDefinition[];
	localEffectiveSkills: SkillDefinition[];
};

export type LoadSkillCatalogOptions = {
	includeLocal?: boolean;
	agentsDir?: string | null;
	resolveTargetName?: (value: string) => string | null;
};

function resolveSkillName(frontmatter: Record<string, FrontmatterValue>, fallback: string): string {
	const rawName = frontmatter.name;
	if (typeof rawName === "string") {
		const trimmed = rawName.trim();
		if (trimmed) {
			return trimmed;
		}
	}
	return fallback;
}

function normalizeSkillKey(relativePath: string): string {
	return path.normalize(relativePath).replace(/\\/g, "/").toLowerCase();
}

function resolveSkillRelativePath(
	skillsRoot: string,
	directoryPath: string,
): { relativePath: string; hadLocalSuffix: boolean } {
	const relativePath = path.relative(skillsRoot, directoryPath);
	if (!relativePath) {
		return { relativePath, hadLocalSuffix: false };
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

async function buildSkillDefinition(options: {
	directoryPath: string;
	skillsRoot: string;
	relativePath?: string;
	skillFileName: string;
	sourceType: SourceType;
	markerType?: LocalMarkerType;
	resolveTargetName: (value: string) => string | null;
}): Promise<SkillDefinition> {
	let metadata: ReturnType<typeof buildSourceMetadata>;
	if (options.sourceType === "local") {
		const markerType = options.markerType;
		if (!markerType) {
			throw new Error("Local sources must include a marker type.");
		}
		metadata = buildSourceMetadata("local", markerType);
	} else {
		metadata = buildSourceMetadata("shared");
	}
	const sourcePath = path.join(options.directoryPath, options.skillFileName);
	const rawContents = await readFile(sourcePath, "utf8");
	const { frontmatter, body } = extractFrontmatter(rawContents);
	const relativePath =
		options.relativePath ?? path.relative(options.skillsRoot, options.directoryPath);
	const name = resolveSkillName(frontmatter, relativePath || path.basename(options.directoryPath));
	const rawTargets = [frontmatter.targets, frontmatter.targetAgents];
	const { targets, invalidTargets } = resolveFrontmatterTargets(
		rawTargets,
		options.resolveTargetName,
	);
	if (invalidTargets.length > 0) {
		const invalidList = invalidTargets.join(", ");
		throw new InvalidFrontmatterTargetsError(
			`Skill "${name}" has unsupported targets (${invalidList}) in ${sourcePath}.`,
		);
	}
	if (hasRawTargetValues(rawTargets) && (!targets || targets.length === 0)) {
		throw new InvalidFrontmatterTargetsError(`Skill "${name}" has empty targets in ${sourcePath}.`);
	}
	const { outputFileName } = stripLocalSuffix(options.skillFileName, ".md");

	return {
		name,
		relativePath,
		directoryPath: options.directoryPath,
		sourcePath,
		sourceType: metadata.sourceType,
		markerType: metadata.markerType,
		isLocalFallback: metadata.isLocalFallback,
		skillFileName: options.skillFileName,
		outputFileName,
		rawContents,
		frontmatter,
		body,
		targetAgents: targets,
		invalidTargets,
	};
}

export async function loadSkillCatalog(
	repoRoot: string,
	options: LoadSkillCatalogOptions = {},
): Promise<SkillCatalog> {
	const includeLocal = options.includeLocal ?? true;
	const fallbackResolver = createTargetNameResolver(BUILTIN_TARGETS).resolveTargetName;
	const resolveTargetName = options.resolveTargetName ?? fallbackResolver;
	const skillsRoot = resolveSharedCategoryRoot(repoRoot, "skills", options.agentsDir);
	const localSkillsRoot = resolveLocalCategoryRoot(repoRoot, "skills", options.agentsDir);

	const sharedStats = await readDirectoryStats(skillsRoot);
	if (sharedStats && !sharedStats.isDirectory()) {
		throw new Error(`Skills root is not a directory: ${skillsRoot}.`);
	}

	const localStats = includeLocal ? await readDirectoryStats(localSkillsRoot) : null;
	if (localStats && !localStats.isDirectory()) {
		throw new Error(`Local skills root is not a directory: ${localSkillsRoot}.`);
	}

	const sharedEntries = sharedStats ? await listSkillDirectories(skillsRoot) : [];
	const localEntries = localStats ? await listSkillDirectories(localSkillsRoot) : [];

	const sharedSkills: SkillDefinition[] = [];
	const localPathSkills: SkillDefinition[] = [];
	const localSuffixSkills: SkillDefinition[] = [];

	for (const entry of sharedEntries) {
		const { relativePath, hadLocalSuffix } = resolveSkillRelativePath(
			skillsRoot,
			entry.directoryPath,
		);
		if (hadLocalSuffix) {
			if (!includeLocal) {
				continue;
			}
			const skillFileName = entry.localSkillFile ?? entry.sharedSkillFile;
			if (!skillFileName) {
				continue;
			}
			localSuffixSkills.push(
				await buildSkillDefinition({
					directoryPath: entry.directoryPath,
					skillsRoot,
					relativePath,
					skillFileName,
					sourceType: "local",
					markerType: "suffix",
					resolveTargetName,
				}),
			);
			continue;
		}
		if (entry.sharedSkillFile) {
			sharedSkills.push(
				await buildSkillDefinition({
					directoryPath: entry.directoryPath,
					skillsRoot,
					relativePath,
					skillFileName: entry.sharedSkillFile,
					sourceType: "shared",
					resolveTargetName,
				}),
			);
		}
		if (includeLocal && entry.localSkillFile) {
			localSuffixSkills.push(
				await buildSkillDefinition({
					directoryPath: entry.directoryPath,
					skillsRoot,
					relativePath,
					skillFileName: entry.localSkillFile,
					sourceType: "local",
					markerType: "suffix",
					resolveTargetName,
				}),
			);
		}
	}

	if (includeLocal) {
		for (const entry of localEntries) {
			const skillFileName = entry.sharedSkillFile ?? entry.localSkillFile;
			if (!skillFileName) {
				continue;
			}
			const { relativePath } = resolveSkillRelativePath(localSkillsRoot, entry.directoryPath);
			localPathSkills.push(
				await buildSkillDefinition({
					directoryPath: entry.directoryPath,
					skillsRoot: localSkillsRoot,
					relativePath,
					skillFileName,
					sourceType: "local",
					markerType: "path",
					resolveTargetName,
				}),
			);
		}
	}

	const {
		local: localSkills,
		localEffective: localEffectiveSkills,
		sharedEffective: sharedEffectiveSkills,
	} = resolveLocalPrecedence({
		shared: sharedSkills,
		localPath: localPathSkills,
		localSuffix: localSuffixSkills,
		key: (skill) => normalizeSkillKey(skill.relativePath),
	});

	const skills = includeLocal ? [...sharedEffectiveSkills, ...localEffectiveSkills] : sharedSkills;

	return {
		repoRoot,
		skillsRoot,
		localSkillsRoot,
		skills,
		sharedSkills,
		localSkills,
		localEffectiveSkills,
	};
}
