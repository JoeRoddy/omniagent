import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { extractFrontmatter, type FrontmatterValue } from "../slash-commands/frontmatter.js";
import { isTargetName, resolveFrontmatterTargets, type TargetName } from "../sync-targets.js";

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

function resolveSkillName(
	frontmatter: Record<string, FrontmatterValue>,
	fallback: string,
): string {
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
		const { targets, invalidTargets } = resolveFrontmatterTargets(
			[frontmatter.targets, frontmatter.targetAgents],
			isTargetName,
		);

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
