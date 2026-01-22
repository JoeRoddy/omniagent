import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeName, readDirectoryStats } from "../catalog-utils.js";
import { resolveLocalPrecedence } from "../local-precedence.js";
import {
	buildSourceMetadata,
	type LocalMarkerType,
	resolveLocalCategoryRoot,
	resolveSharedCategoryRoot,
	type SourceType,
	stripLocalSuffix,
} from "../local-sources.js";
import {
	createTargetNameResolver,
	hasRawTargetValues,
	InvalidFrontmatterTargetsError,
	resolveFrontmatterTargets,
} from "../sync-targets.js";
import { BUILTIN_TARGETS } from "../targets/builtins.js";
import type { SubagentTargetName } from "./targets.js";

export type FrontmatterValue = string | string[];

export type SubagentDefinition = {
	resolvedName: string;
	sourcePath: string;
	fileName: string;
	sourceType: SourceType;
	markerType?: LocalMarkerType;
	isLocalFallback: boolean;
	rawContents: string;
	frontmatter: Record<string, FrontmatterValue>;
	body: string;
	targetAgents: SubagentTargetName[] | null;
	invalidTargets: string[];
};

export type SubagentCatalog = {
	repoRoot: string;
	catalogPath: string;
	localCatalogPath: string;
	canonicalStandard: "canonical";
	subagents: SubagentDefinition[];
	sharedSubagents: SubagentDefinition[];
	localSubagents: SubagentDefinition[];
	localEffectiveSubagents: SubagentDefinition[];
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

export type LoadSubagentCatalogOptions = {
	includeLocal?: boolean;
	agentsDir?: string | null;
	resolveTargetName?: (value: string) => string | null;
};

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

async function buildSubagentDefinition(options: {
	filePath: string;
	fileName: string;
	sourceType: SourceType;
	markerType?: LocalMarkerType;
	resolveTargetName: (value: string) => string | null;
}): Promise<SubagentDefinition> {
	const contents = await readFile(options.filePath, "utf8");
	if (!contents.trim()) {
		throw new Error(`Subagent file is empty: ${options.filePath}.`);
	}

	let frontmatter: Record<string, FrontmatterValue>;
	let body: string;
	try {
		({ frontmatter, body } = extractFrontmatter(contents));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid frontmatter in ${options.filePath}: ${message}`);
	}

	if (!body.trim()) {
		throw new Error(`Subagent file has empty body: ${options.filePath}.`);
	}

	let resolvedName: string;
	try {
		resolvedName = resolveSubagentName(frontmatter, options.fileName);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid frontmatter in ${options.filePath}: ${message}`);
	}

	const rawTargets = [frontmatter.targets, frontmatter.targetAgents];
	const { targets, invalidTargets } = resolveFrontmatterTargets(
		rawTargets,
		options.resolveTargetName,
	);
	if (invalidTargets.length > 0) {
		const invalidList = invalidTargets.join(", ");
		throw new InvalidFrontmatterTargetsError(
			`Subagent "${resolvedName}" has unsupported targets (${invalidList}) in ${options.filePath}.`,
		);
	}
	if (hasRawTargetValues(rawTargets) && (!targets || targets.length === 0)) {
		throw new InvalidFrontmatterTargetsError(
			`Subagent "${resolvedName}" has empty targets in ${options.filePath}.`,
		);
	}

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

	return {
		resolvedName,
		sourcePath: options.filePath,
		fileName: options.fileName,
		sourceType: metadata.sourceType,
		markerType: metadata.markerType,
		isLocalFallback: metadata.isLocalFallback,
		rawContents: contents,
		frontmatter,
		body,
		targetAgents: targets,
		invalidTargets,
	};
}

function registerUniqueName(
	seen: Map<string, string>,
	resolvedName: string,
	filePath: string,
): void {
	const nameKey = normalizeName(resolvedName);
	const existingPath = seen.get(nameKey);
	if (existingPath) {
		throw new Error(
			`Duplicate subagent name "${resolvedName}" (case-insensitive) found in: ` +
				`${existingPath} and ${filePath}.`,
		);
	}
	seen.set(nameKey, filePath);
}

export async function loadSubagentCatalog(
	repoRoot: string,
	options: LoadSubagentCatalogOptions = {},
): Promise<SubagentCatalog> {
	const includeLocal = options.includeLocal ?? true;
	const fallbackResolver = createTargetNameResolver(BUILTIN_TARGETS).resolveTargetName;
	const resolveTargetName = options.resolveTargetName ?? fallbackResolver;
	const catalogPath = resolveSharedCategoryRoot(repoRoot, "agents", options.agentsDir);
	const localCatalogPath = resolveLocalCategoryRoot(repoRoot, "agents", options.agentsDir);

	const sharedStats = await readDirectoryStats(catalogPath);
	if (sharedStats && !sharedStats.isDirectory()) {
		throw new Error(`Subagent catalog path is not a directory: ${catalogPath}.`);
	}
	const localStats = includeLocal ? await readDirectoryStats(localCatalogPath) : null;
	if (localStats && !localStats.isDirectory()) {
		throw new Error(`Local subagent catalog path is not a directory: ${localCatalogPath}.`);
	}

	const sharedFiles = sharedStats ? await listCatalogFiles(catalogPath) : [];
	const localFiles = localStats ? await listCatalogFiles(localCatalogPath) : [];

	const sharedSubagents: SubagentDefinition[] = [];
	const localPathSubagents: SubagentDefinition[] = [];
	const localSuffixSubagents: SubagentDefinition[] = [];
	const seenShared = new Map<string, string>();
	const seenLocalPath = new Map<string, string>();
	const seenLocalSuffix = new Map<string, string>();

	for (const filePath of sharedFiles) {
		if (!filePath.toLowerCase().endsWith(".md")) {
			throw new Error(`Non-Markdown file found in subagent catalog: ${filePath}.`);
		}
		const fileNameWithExt = path.basename(filePath);
		const { baseName, hadLocalSuffix } = stripLocalSuffix(fileNameWithExt, ".md");
		const fileName = baseName || path.basename(filePath, ".md");
		if (hadLocalSuffix && !includeLocal) {
			continue;
		}
		const definition = await buildSubagentDefinition({
			filePath,
			fileName,
			sourceType: hadLocalSuffix ? "local" : "shared",
			markerType: hadLocalSuffix ? "suffix" : undefined,
			resolveTargetName,
		});
		if (hadLocalSuffix) {
			if (!includeLocal) {
				continue;
			}
			registerUniqueName(seenLocalSuffix, definition.resolvedName, filePath);
			localSuffixSubagents.push(definition);
		} else {
			registerUniqueName(seenShared, definition.resolvedName, filePath);
			sharedSubagents.push(definition);
		}
	}

	if (includeLocal) {
		for (const filePath of localFiles) {
			if (!filePath.toLowerCase().endsWith(".md")) {
				throw new Error(`Non-Markdown file found in local subagent catalog: ${filePath}.`);
			}
			const fileNameWithExt = path.basename(filePath);
			const { baseName } = stripLocalSuffix(fileNameWithExt, ".md");
			const fileName = baseName || path.basename(filePath, ".md");
			const definition = await buildSubagentDefinition({
				filePath,
				fileName,
				sourceType: "local",
				markerType: "path",
				resolveTargetName,
			});
			registerUniqueName(seenLocalPath, definition.resolvedName, filePath);
			localPathSubagents.push(definition);
		}
	}

	const localSubagents = [...localPathSubagents, ...localSuffixSubagents];
	const { localEffective: localEffectiveSubagents, sharedEffective: sharedEffectiveSubagents } =
		resolveLocalPrecedence({
			shared: sharedSubagents,
			localPath: localPathSubagents,
			localSuffix: localSuffixSubagents,
			key: (subagent) => normalizeName(subagent.resolvedName),
		});
	const subagents = includeLocal
		? [...localEffectiveSubagents, ...sharedEffectiveSubagents]
		: sharedSubagents;

	return {
		repoRoot,
		catalogPath,
		localCatalogPath,
		canonicalStandard: "canonical",
		subagents,
		sharedSubagents,
		localSubagents,
		localEffectiveSubagents,
	};
}
