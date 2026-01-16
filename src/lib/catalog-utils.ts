import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Read directory stats, returning null if the directory does not exist.
 */
export async function readDirectoryStats(
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

/**
 * Normalize a name for case-insensitive comparison.
 */
export function normalizeName(name: string): string {
	return name.toLowerCase();
}

/**
 * Represents a skill directory entry with both shared and local skill file variants.
 */
export type SkillDirectoryEntry = {
	directoryPath: string;
	sharedSkillFile: string | null;
	localSkillFile: string | null;
};

/**
 * Recursively list skill directories, returning entries with both shared (SKILL.md)
 * and local (SKILL.local.md) file variants.
 */
export async function listSkillDirectories(root: string): Promise<SkillDirectoryEntry[]> {
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
