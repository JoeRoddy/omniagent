import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
	buildSourceMetadata,
	type LocalMarkerType,
	type SourceType,
	stripLocalSuffix,
} from "../local-sources.js";
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
	const segments = filePath.split(path.sep);
	for (const segment of segments) {
		if (segment.toLowerCase().endsWith(".local")) {
			return "path";
		}
	}
	const fileName = path.basename(filePath);
	const extension = path.extname(fileName);
	const { hadLocalSuffix } = stripLocalSuffix(fileName, extension);
	return hadLocalSuffix ? "suffix" : null;
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

export async function scanInstructionTemplateSources(options: {
	repoRoot: string;
	includeLocal?: boolean;
}): Promise<InstructionTemplateScanEntry[]> {
	const includeLocal = options.includeLocal ?? true;
	const templatesRoot = path.join(options.repoRoot, "agents");
	let templateFiles: string[] = [];

	try {
		templateFiles = await listTemplateFiles(templatesRoot);
	} catch {
		return [];
	}

	const entries: InstructionTemplateScanEntry[] = [];
	for (const filePath of templateFiles) {
		const markerType = detectLocalMarker(filePath);
		const sourceType: SourceType = markerType ? "local" : "shared";
		if (!includeLocal && sourceType === "local") {
			continue;
		}
		const metadata = buildSourceMetadata(sourceType, markerType ?? undefined);
		entries.push({
			sourcePath: filePath,
			sourceType: metadata.sourceType,
			markerType: metadata.markerType,
			isLocalFallback: metadata.isLocalFallback,
		});
	}

	return entries;
}

function isRootTemplate(filePath: string, repoRoot: string): boolean {
	const sharedRoot = path.join(repoRoot, "agents");
	const localRoot = path.join(sharedRoot, ".local");
	const relativeToLocal = path.relative(localRoot, filePath);
	const isInLocalRoot =
		relativeToLocal &&
		!relativeToLocal.startsWith("..") &&
		!path.isAbsolute(relativeToLocal);
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
}): Promise<InstructionTemplateCatalog> {
	const templatesRoot = path.join(options.repoRoot, "agents");
	const localTemplatesRoot = path.join(templatesRoot, ".local");
	const entries = await scanInstructionTemplateSources(options);

	const templates: InstructionTemplateSource[] = [];
	for (const entry of entries) {
		const rawContents = await readFile(entry.sourcePath, "utf8");
		const parsed = parseInstructionFrontmatter({
			contents: rawContents,
			sourcePath: entry.sourcePath,
			repoRoot: options.repoRoot,
		});

		const rootTemplate = isRootTemplate(entry.sourcePath, options.repoRoot);
		const resolvedOutputDir =
			parsed.resolvedOutputDir ?? (rootTemplate ? options.repoRoot : null);

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
