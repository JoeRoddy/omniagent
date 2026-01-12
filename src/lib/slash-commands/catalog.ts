import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { extractFrontmatter, type FrontmatterValue, normalizeTargetList } from "./frontmatter.js";
import type { TargetName } from "./targets.js";

export type { FrontmatterValue } from "./frontmatter.js";

export type SlashCommandDefinition = {
	name: string;
	prompt: string;
	sourcePath: string;
	rawContents: string;
	targetAgents: TargetName[] | null;
	frontmatter: Record<string, FrontmatterValue>;
};

export type CommandCatalog = {
	repoRoot: string;
	commandsPath: string;
	canonicalStandard: "claude_code";
	commands: SlashCommandDefinition[];
};

async function listMarkdownFiles(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const entryPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listMarkdownFiles(entryPath)));
			continue;
		}
		if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
			files.push(entryPath);
		}
	}
	return files;
}

export async function loadCommandCatalog(repoRoot: string): Promise<CommandCatalog> {
	const commandsPath = path.join(repoRoot, "agents", "commands");
	let stats: Awaited<ReturnType<typeof stat>>;
	try {
		stats = await stat(commandsPath);
	} catch {
		throw new Error(`Command catalog directory not found at ${commandsPath}.`);
	}
	if (!stats.isDirectory()) {
		throw new Error(`Command catalog path is not a directory: ${commandsPath}.`);
	}

	const files = await listMarkdownFiles(commandsPath);
	if (files.length === 0) {
		throw new Error(`No slash command definitions found in ${commandsPath}.`);
	}

	const commands: SlashCommandDefinition[] = [];
	const seen = new Map<string, string>();

	for (const filePath of files) {
		const fileName = path.basename(filePath, ".md");
		const lowerName = fileName.toLowerCase();
		if (seen.has(lowerName)) {
			const existing = seen.get(lowerName);
			throw new Error(
				`Duplicate command name "${fileName}" (case-insensitive). Also found: ${existing}.`,
			);
		}
		seen.set(lowerName, filePath);

		const contents = await readFile(filePath, "utf8");
		const { frontmatter, body } = extractFrontmatter(contents);
		const prompt = body.trimEnd();
		if (!prompt.trim()) {
			throw new Error(`Slash command "${fileName}" has an empty prompt.`);
		}

		const rawTargets = frontmatter.targetAgents ?? frontmatter.targets;
		commands.push({
			name: fileName,
			prompt,
			sourcePath: filePath,
			rawContents: contents,
			targetAgents: normalizeTargetList(rawTargets),
			frontmatter,
		});
	}

	return {
		repoRoot,
		commandsPath,
		canonicalStandard: "claude_code",
		commands,
	};
}
