import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { resolveFrontmatterTargets } from "../sync-targets.js";
import { isSubagentTargetName, type SubagentTargetName } from "./targets.js";

export type FrontmatterValue = string | string[];

export type SubagentDefinition = {
	resolvedName: string;
	sourcePath: string;
	fileName: string;
	rawContents: string;
	frontmatter: Record<string, FrontmatterValue>;
	body: string;
	targetAgents: SubagentTargetName[] | null;
	invalidTargets: string[];
};

export type SubagentCatalog = {
	repoRoot: string;
	catalogPath: string;
	canonicalStandard: "claude_code";
	subagents: SubagentDefinition[];
};

const FRONTMATTER_MARKER = "---";

async function listCatalogFiles(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const entryPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listCatalogFiles(entryPath)));
			continue;
		}
		if (entry.isFile()) {
			files.push(entryPath);
		}
	}
	return files;
}

function parseScalar(rawValue: string): string {
	const trimmed = rawValue.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
	}
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parseFrontmatterStrict(lines: string[]): Record<string, FrontmatterValue> {
	const data: Record<string, FrontmatterValue> = {};
	let currentListKey: string | null = null;
	let lineNumber = 0;

	for (const line of lines) {
		lineNumber += 1;
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}

		const listMatch = trimmed.match(/^-\s+(.+)$/);
		if (listMatch) {
			if (!currentListKey) {
				throw new Error(`Unexpected list item at line ${lineNumber}.`);
			}
			const value = parseScalar(listMatch[1]);
			const existing = data[currentListKey];
			if (Array.isArray(existing)) {
				existing.push(value);
			} else {
				data[currentListKey] = [value];
			}
			continue;
		}

		const match = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!match) {
			throw new Error(`Invalid frontmatter line at line ${lineNumber}: "${trimmed}".`);
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

	return data;
}

function extractFrontmatter(contents: string): {
	frontmatter: Record<string, FrontmatterValue>;
	body: string;
} {
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
		throw new Error("Frontmatter is missing a closing '---' marker.");
	}

	const frontmatterLines = lines.slice(1, endIndex);
	const bodyLines = lines.slice(endIndex + 1);
	return {
		frontmatter: parseFrontmatterStrict(frontmatterLines),
		body: bodyLines.join("\n").replace(/^\n+/, "").trimEnd(),
	};
}

function resolveSubagentName(
	frontmatter: Record<string, FrontmatterValue>,
	fileName: string,
): string {
	const rawName = frontmatter.name;
	if (rawName === undefined) {
		return fileName;
	}
	if (Array.isArray(rawName)) {
		throw new Error("Frontmatter field 'name' must be a string.");
	}
	const trimmed = rawName.trim();
	if (!trimmed) {
		throw new Error("Frontmatter field 'name' cannot be empty.");
	}
	return trimmed;
}

export async function loadSubagentCatalog(repoRoot: string): Promise<SubagentCatalog> {
	const catalogPath = path.join(repoRoot, "agents", "agents");
	let stats: Awaited<ReturnType<typeof stat>> | null = null;
	try {
		stats = await stat(catalogPath);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return {
				repoRoot,
				catalogPath,
				canonicalStandard: "claude_code",
				subagents: [],
			};
		}
		throw error;
	}

	if (!stats.isDirectory()) {
		throw new Error(`Subagent catalog path is not a directory: ${catalogPath}.`);
	}

	const files = await listCatalogFiles(catalogPath);
	if (files.length === 0) {
		return {
			repoRoot,
			catalogPath,
			canonicalStandard: "claude_code",
			subagents: [],
		};
	}

	const subagents: SubagentDefinition[] = [];
	const seenNames = new Map<string, string>();

	for (const filePath of files) {
		if (!filePath.toLowerCase().endsWith(".md")) {
			throw new Error(`Non-Markdown file found in subagent catalog: ${filePath}.`);
		}

		const contents = await readFile(filePath, "utf8");
		if (!contents.trim()) {
			throw new Error(`Subagent file is empty: ${filePath}.`);
		}

		let frontmatter: Record<string, FrontmatterValue>;
		let body: string;
		try {
			({ frontmatter, body } = extractFrontmatter(contents));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Invalid frontmatter in ${filePath}: ${message}`);
		}

		if (!body.trim()) {
			throw new Error(`Subagent file has empty body: ${filePath}.`);
		}

		const fileName = path.basename(filePath, ".md");
		let resolvedName: string;
		try {
			resolvedName = resolveSubagentName(frontmatter, fileName);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Invalid frontmatter in ${filePath}: ${message}`);
		}

		const nameKey = resolvedName.toLowerCase();
		const existingPath = seenNames.get(nameKey);
		if (existingPath) {
			throw new Error(
				`Duplicate subagent name "${resolvedName}" (case-insensitive) found in: ` +
					`${existingPath} and ${filePath}.`,
			);
		}
		seenNames.set(nameKey, filePath);

		const { targets, invalidTargets } = resolveFrontmatterTargets(
			[frontmatter.targets, frontmatter.targetAgents],
			isSubagentTargetName,
		);

		subagents.push({
			resolvedName,
			sourcePath: filePath,
			fileName,
			rawContents: contents,
			frontmatter,
			body,
			targetAgents: targets,
			invalidTargets,
		});
	}

	return {
		repoRoot,
		catalogPath,
		canonicalStandard: "claude_code",
		subagents,
	};
}
