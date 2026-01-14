import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
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
	rawContents: string;
	frontmatter: Record<string, FrontmatterValue>;
	body: string;
	targetAgents: TargetName[] | null;
	invalidTargets: string[];
};

export type SkillCatalog = {
	repoRoot: string;
	skillsRoot: string;
	skills: SkillDefinition[];
};

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

export async function loadSkillCatalog(repoRoot: string): Promise<SkillCatalog> {
	const skillsRoot = path.join(repoRoot, "agents", "skills");
	let stats: Awaited<ReturnType<typeof stat>> | null = null;
	try {
		stats = await stat(skillsRoot);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return {
				repoRoot,
				skillsRoot,
				skills: [],
			};
		}
		throw error;
	}

	if (!stats.isDirectory()) {
		throw new Error(`Skills root is not a directory: ${skillsRoot}.`);
	}

	const directories = await listSkillDirectories(skillsRoot);
	if (directories.length === 0) {
		return {
			repoRoot,
			skillsRoot,
			skills: [],
		};
	}

	const skills: SkillDefinition[] = [];
	for (const directory of directories) {
		const sourcePath = path.join(directory, "SKILL.md");
		const rawContents = await readFile(sourcePath, "utf8");
		const { frontmatter, body } = extractFrontmatter(rawContents);
		const relativePath = path.relative(skillsRoot, directory);
		const name = resolveSkillName(frontmatter, relativePath || path.basename(directory));
		const rawTargets = [frontmatter.targets, frontmatter.targetAgents];
		const { targets, invalidTargets } = resolveFrontmatterTargets(rawTargets, isTargetName);
		if (invalidTargets.length > 0) {
			const invalidList = invalidTargets.join(", ");
			throw new InvalidFrontmatterTargetsError(
				`Skill "${name}" has unsupported targets (${invalidList}) in ${sourcePath}.`,
			);
		}
		if (hasRawTargetValues(rawTargets) && (!targets || targets.length === 0)) {
			throw new InvalidFrontmatterTargetsError(
				`Skill "${name}" has empty targets in ${sourcePath}.`,
			);
		}

		skills.push({
			name,
			relativePath,
			directoryPath: directory,
			sourcePath,
			rawContents,
			frontmatter,
			body,
			targetAgents: targets,
			invalidTargets,
		});
	}

	return {
		repoRoot,
		skillsRoot,
		skills,
	};
}
