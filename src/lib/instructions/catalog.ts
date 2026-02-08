import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveAgentsDirPath } from "../agents-dir.js";
import {
	buildSourceMetadata,
	detectLocalMarkerFromPath,
	type LocalMarkerType,
	type SourceType,
	stripLocalSuffix,
} from "../local-sources.js";
import { createTargetNameResolver } from "../sync-targets.js";
import { BUILTIN_TARGETS } from "../targets/builtins.js";
import { parseInstructionFrontmatter } from "./frontmatter.js";
import type { InstructionTemplateSource } from "./types.js";

export type InstructionTemplateScanEntry = {
	sourcePath: string;
	sourceType: SourceType;
	markerType?: LocalMarkerType;
	isLocalFallback: boolean;
};

export type InstructionTemplateCatalog = {
	repoRoot: string;
	templatesRoot: string;
	localTemplatesRoot: string;
	templates: InstructionTemplateSource[];
};

const RESERVED_MANAGED_SOURCE_DIRS = new Set(["skills", "commands", "agents", "instructions"]);

function isTemplateFile(fileName: string): boolean {
	if (!fileName.toLowerCase().endsWith(".md")) {
		return false;
	}
	const { baseName } = stripLocalSuffix(fileName, ".md");
	if (!baseName) {
		return false;
	}
	const lower = baseName.toLowerCase();
	return lower === "agents" || lower.endsWith(".agents");
}

function detectLocalMarker(filePath: string): LocalMarkerType | null {
	return detectLocalMarkerFromPath(filePath);
}

async function listTemplateFiles(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const entryPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listTemplateFiles(entryPath)));
			continue;
		}
		if (entry.isFile() && isTemplateFile(entry.name)) {
			files.push(entryPath);
		}
	}
	return files;
}

function isInReservedManagedSourceDir(
	filePath: string,
	repoRoot: string,
	agentsDir?: string | null,
): boolean {
	const templatesRoot = resolveAgentsDirPath(repoRoot, agentsDir);
	const relative = path.relative(templatesRoot, filePath);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
		return false;
	}
	const segments = relative.split(path.sep).filter(Boolean);
	if (segments.length < 2) {
		return false;
	}
	const first = segments[0] === ".local" ? segments[1] : segments[0];
	return first ? RESERVED_MANAGED_SOURCE_DIRS.has(first) : false;
}

export async function scanInstructionTemplateSources(options: {
	repoRoot: string;
	includeLocal?: boolean;
	agentsDir?: string | null;
}): Promise<InstructionTemplateScanEntry[]> {
	const includeLocal = options.includeLocal ?? true;
	const templatesRoot = resolveAgentsDirPath(options.repoRoot, options.agentsDir);
	let templateFiles: string[] = [];

	try {
		templateFiles = await listTemplateFiles(templatesRoot);
	} catch {
		return [];
	}

	const entries: InstructionTemplateScanEntry[] = [];
	for (const filePath of templateFiles) {
		if (isInReservedManagedSourceDir(filePath, options.repoRoot, options.agentsDir)) {
			continue;
		}
		const markerType = detectLocalMarker(filePath);
		const sourceType: SourceType = markerType ? "local" : "shared";
		if (!includeLocal && sourceType === "local") {
			continue;
		}
		if (sourceType === "local") {
			if (!markerType) {
				continue;
			}
			const metadata = buildSourceMetadata("local", markerType);
			entries.push({
				sourcePath: filePath,
				sourceType: metadata.sourceType,
				markerType: metadata.markerType,
				isLocalFallback: metadata.isLocalFallback,
			});
			continue;
		}
		const metadata = buildSourceMetadata("shared");
		entries.push({
			sourcePath: filePath,
			sourceType: metadata.sourceType,
			markerType: metadata.markerType,
			isLocalFallback: metadata.isLocalFallback,
		});
	}

	return entries;
}

function isRootTemplate(filePath: string, repoRoot: string, agentsDir?: string | null): boolean {
	const sharedRoot = resolveAgentsDirPath(repoRoot, agentsDir);
	const localRoot = path.join(sharedRoot, ".local");
	const relativeToLocal = path.relative(localRoot, filePath);
	const isInLocalRoot =
		relativeToLocal && !relativeToLocal.startsWith("..") && !path.isAbsolute(relativeToLocal);
	const relative = isInLocalRoot ? relativeToLocal : path.relative(sharedRoot, filePath);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
		return false;
	}
	const dirName = path.dirname(relative);
	const baseName = path.basename(relative);
	if (dirName !== "." && dirName !== "") {
		return false;
	}
	const { baseName: strippedBase } = stripLocalSuffix(baseName, ".md");
	return strippedBase.toLowerCase() === "agents";
}

export async function loadInstructionTemplateCatalog(options: {
	repoRoot: string;
	includeLocal?: boolean;
	agentsDir?: string | null;
	resolveTargetName?: (value: string) => string | null;
}): Promise<InstructionTemplateCatalog> {
	const templatesRoot = resolveAgentsDirPath(options.repoRoot, options.agentsDir);
	const localTemplatesRoot = path.join(templatesRoot, ".local");
	const entries = await scanInstructionTemplateSources(options);
	const fallbackResolver = createTargetNameResolver(BUILTIN_TARGETS).resolveTargetName;
	const resolveTargetName = options.resolveTargetName ?? fallbackResolver;

	const templates: InstructionTemplateSource[] = [];
	for (const entry of entries) {
		const rawContents = await readFile(entry.sourcePath, "utf8");
		const parsed = parseInstructionFrontmatter({
			contents: rawContents,
			sourcePath: entry.sourcePath,
			repoRoot: options.repoRoot,
			resolveTargetName,
		});

		const rootTemplate = isRootTemplate(entry.sourcePath, options.repoRoot, options.agentsDir);
		const resolvedOutputDir = parsed.resolvedOutputDir ?? (rootTemplate ? options.repoRoot : null);

		templates.push({
			kind: "template",
			sourcePath: entry.sourcePath,
			sourceType: entry.sourceType,
			markerType: entry.markerType,
			isLocalFallback: entry.isLocalFallback,
			rawContents,
			frontmatter: parsed.frontmatter,
			body: parsed.body,
			targets: parsed.targets,
			invalidTargets: parsed.invalidTargets,
			outPutPath: parsed.outPutPath,
			resolvedOutputDir,
		});
	}

	return {
		repoRoot: options.repoRoot,
		templatesRoot,
		localTemplatesRoot,
		templates,
	};
}
