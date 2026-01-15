import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
	buildSourceMetadata,
	type LocalMarkerType,
	resolveLocalCategoryRoot,
	resolveSharedCategoryRoot,
	type SourceType,
	stripLocalSuffix,
} from "../local-sources.js";
import { extractFrontmatter, type FrontmatterValue } from "../slash-commands/frontmatter.js";
import {
	hasRawTargetValues,
	InvalidFrontmatterTargetsError,
	isTargetName,
	resolveFrontmatterTargets,
	type TargetName,
} from "../sync-targets.js";

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
};

type SkillDirectoryEntry = {
	directoryPath: string;
	sharedSkillFile: string | null;
	localSkillFile: string | null;
};

async function listSkillDirectories(root: string): Promise<SkillDirectoryEntry[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const directories: SkillDirectoryEntry[] = [];
	let sharedSkillFile: string | null = null;
	let localSkillFile: string | null = null;

	for (const entry of entries) {
		if (!entry.isFile()) {
			continue;
		}
		const lowerName = entry.name.toLowerCase();
		if (lowerName === "skill.md") {
			sharedSkillFile = entry.name;
		} else if (lowerName === "skill.local.md") {
			localSkillFile = entry.name;
		}
	}

	if (sharedSkillFile || localSkillFile) {
		directories.push({
			directoryPath: root,
			sharedSkillFile,
			localSkillFile,
		});
	}

	for (const entry of entries) {
		if (entry.isDirectory()) {
			directories.push(...(await listSkillDirectories(path.join(root, entry.name))));
		}
	}

	return directories;
}

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

async function readDirectoryStats(
	directory: string,
): Promise<Awaited<ReturnType<typeof stat>> | null> {
	try {
		return await stat(directory);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

function normalizeSkillKey(name: string): string {
	return name.trim().toLowerCase();
}

async function buildSkillDefinition(options: {
	directoryPath: string;
	skillsRoot: string;
	skillFileName: string;
	sourceType: SourceType;
	markerType?: LocalMarkerType;
}): Promise<SkillDefinition> {
	const metadata = buildSourceMetadata(options.sourceType, options.markerType);
	const sourcePath = path.join(options.directoryPath, options.skillFileName);
	const rawContents = await readFile(sourcePath, "utf8");
	const { frontmatter, body } = extractFrontmatter(rawContents);
	const relativePath = path.relative(options.skillsRoot, options.directoryPath);
	const name = resolveSkillName(frontmatter, relativePath || path.basename(options.directoryPath));
	const rawTargets = [frontmatter.targets, frontmatter.targetAgents];
	const { targets, invalidTargets } = resolveFrontmatterTargets(rawTargets, isTargetName);
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
	const skillsRoot = resolveSharedCategoryRoot(repoRoot, "skills");
	const localSkillsRoot = resolveLocalCategoryRoot(repoRoot, "skills");

	const sharedStats = await readDirectoryStats(skillsRoot);
	if (sharedStats && !sharedStats.isDirectory()) {
		throw new Error(`Skills root is not a directory: ${skillsRoot}.`);
	}

	const localStats = await readDirectoryStats(localSkillsRoot);
	if (localStats && !localStats.isDirectory()) {
		throw new Error(`Local skills root is not a directory: ${localSkillsRoot}.`);
	}

	const sharedEntries = sharedStats ? await listSkillDirectories(skillsRoot) : [];
	const localEntries = localStats ? await listSkillDirectories(localSkillsRoot) : [];

	const sharedSkills: SkillDefinition[] = [];
	const localPathSkills: SkillDefinition[] = [];
	const localSuffixSkills: SkillDefinition[] = [];

	for (const entry of sharedEntries) {
		if (entry.sharedSkillFile) {
			sharedSkills.push(
				await buildSkillDefinition({
					directoryPath: entry.directoryPath,
					skillsRoot,
					skillFileName: entry.sharedSkillFile,
					sourceType: "shared",
				}),
			);
		}
		if (entry.localSkillFile) {
			localSuffixSkills.push(
				await buildSkillDefinition({
					directoryPath: entry.directoryPath,
					skillsRoot,
					skillFileName: entry.localSkillFile,
					sourceType: "local",
					markerType: "suffix",
				}),
			);
		}
	}

	for (const entry of localEntries) {
		const skillFileName = entry.sharedSkillFile ?? entry.localSkillFile;
		if (!skillFileName) {
			continue;
		}
		localPathSkills.push(
			await buildSkillDefinition({
				directoryPath: entry.directoryPath,
				skillsRoot: localSkillsRoot,
				skillFileName,
				sourceType: "local",
				markerType: "path",
			}),
		);
	}

	const localSkills = [...localPathSkills, ...localSuffixSkills];
	const localPathNames = new Set(localPathSkills.map((skill) => normalizeSkillKey(skill.name)));
	const localEffectiveSkills = [
		...localPathSkills,
		...localSuffixSkills.filter((skill) => !localPathNames.has(normalizeSkillKey(skill.name))),
	];
	const localEffectiveNames = new Set(
		localEffectiveSkills.map((skill) => normalizeSkillKey(skill.name)),
	);
	const sharedEffectiveSkills = sharedSkills.filter(
		(skill) => !localEffectiveNames.has(normalizeSkillKey(skill.name)),
	);

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
