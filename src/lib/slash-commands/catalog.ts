import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { TargetName } from "./targets.js";

export type SlashCommandDefinition = {
	name: string;
	description: string | null;
	prompt: string;
	sourcePath: string;
	targetAgents: TargetName[] | null;
};

export type CommandCatalog = {
	repoRoot: string;
	commandsPath: string;
	canonicalStandard: "claude_code";
	commands: SlashCommandDefinition[];
};

type FrontmatterData = {
	description?: string;
	targetAgents?: string[];
	targets?: string[];
};

const FRONTMATTER_MARKER = "---";

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

function parseScalar(rawValue: string): string {
	const trimmed = rawValue.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		// Unescape YAML double-quoted string escape sequences
		return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
	}
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
		// Single-quoted strings don't process escapes in YAML
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parseFrontmatter(lines: string[]): FrontmatterData {
	const data: Record<string, string | string[]> = {};
	let currentListKey: string | null = null;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}

		if (currentListKey) {
			const listMatch = trimmed.match(/^-\s+(.+)$/);
			if (listMatch) {
				const value = parseScalar(listMatch[1]);
				const existing = data[currentListKey];
				if (Array.isArray(existing)) {
					existing.push(value);
				} else {
					data[currentListKey] = [value];
				}
				continue;
			}
			currentListKey = null;
		}

		const match = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!match) {
			continue;
		}
		const [, key, rawValue] = match;
		if (!rawValue) {
			currentListKey = key;
			if (!data[key]) {
				data[key] = [];
			}
			continue;
		}
		data[key] = parseScalar(rawValue);
		currentListKey = null;
	}

	const result: FrontmatterData = {};
	if (typeof data.description === "string") {
		result.description = data.description.trim() || undefined;
	}
	const targetAgents = data.targetAgents;
	const targets = data.targets;
	if (Array.isArray(targetAgents)) {
		result.targetAgents = targetAgents.map((value) => value.trim()).filter(Boolean);
	}
	if (Array.isArray(targets)) {
		result.targets = targets.map((value) => value.trim()).filter(Boolean);
	}
	return result;
}

function extractFrontmatter(contents: string): { frontmatter: FrontmatterData; body: string } {
	const lines = contents.split(/\r?\n/);
	if (lines[0]?.trim() !== FRONTMATTER_MARKER) {
		return { frontmatter: {}, body: contents.trimEnd() };
	}

	let endIndex = -1;
	for (let i = 1; i < lines.length; i += 1) {
		if (lines[i].trim() === FRONTMATTER_MARKER) {
			endIndex = i;
			break;
		}
	}

	if (endIndex === -1) {
		return { frontmatter: {}, body: contents.trimEnd() };
	}

	const frontmatterLines = lines.slice(1, endIndex);
	const bodyLines = lines.slice(endIndex + 1);
	return {
		frontmatter: parseFrontmatter(frontmatterLines),
		body: bodyLines.join("\n").replace(/^\n+/, "").trimEnd(),
	};
}

function normalizeTargetList(rawTargets?: string[]): TargetName[] | null {
	if (!rawTargets || rawTargets.length === 0) {
		return null;
	}
	const normalized = rawTargets
		.map((value) => value.trim())
		.filter(Boolean)
		.map((value) => value.toLowerCase());
	if (normalized.length === 0) {
		return null;
	}
	return normalized as TargetName[];
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
			description: frontmatter.description ?? null,
			prompt,
			sourcePath: filePath,
			targetAgents: normalizeTargetList(rawTargets),
		});
	}

	return {
		repoRoot,
		commandsPath,
		canonicalStandard: "claude_code",
		commands,
	};
}
