import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { applyAgentTemplating } from "../agent-templating.js";
import { stripFrontmatterFields } from "../frontmatter-strip.js";
import {
	detectLocalMarkerFromPath,
	type LocalMarkerType,
	type SourceType,
	stripLocalPathSuffix,
	stripLocalSuffix,
} from "../local-sources.js";
import { evaluateTemplateScripts } from "../template-scripts.js";
import type { OutputWriter, OutputWriterRef, WriterContext, WriterResult } from "./config-types.js";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

const TARGET_FRONTMATTER_KEYS = new Set(["targets", "targetagents"]);
const SKILL_FRONTMATTER_KEYS_TO_REMOVE = new Set([
	...TARGET_FRONTMATTER_KEYS,
	"tools",
	"model",
	"color",
]);

export type SkillWriterItem = {
	directoryPath: string;
	skillFileName: string;
	outputFileName: string;
	sourcePath: string;
	sourceType: SourceType;
	markerType?: LocalMarkerType;
};

export type SubagentWriterItem = {
	resolvedName: string;
	rawContents: string;
	sourcePath: string;
	outputKind: "subagent" | "skill";
};

export type InstructionWriterItem = {
	sourcePath: string;
	content: string | null;
};

export type WriterRegistry = Map<string, OutputWriter>;

export function resolveWriter(
	ref: OutputWriterRef | undefined,
	registry: WriterRegistry,
): OutputWriter | null {
	if (!ref) {
		return null;
	}
	if ("write" in ref && typeof ref.write === "function") {
		return ref;
	}
	if ("id" in ref && ref.id) {
		return registry.get(ref.id) ?? null;
	}
	return null;
}

function decodeUtf8(buffer: Buffer): string | null {
	try {
		return utf8Decoder.decode(buffer);
	} catch {
		return null;
	}
}

function hashBuffer(buffer: Buffer): string {
	return createHash("sha256").update(buffer).digest("hex");
}

async function readExistingBuffer(filePath: string): Promise<Buffer | null> {
	try {
		return await readFile(filePath);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

async function writeOutputFile(
	outputPath: string,
	content: string | Buffer,
): Promise<WriterResult> {
	const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
	const contentHash = hashBuffer(buffer);
	const existing = await readExistingBuffer(outputPath);
	if (existing?.equals(buffer)) {
		return { status: "skipped", contentHash };
	}
	await mkdir(path.dirname(outputPath), { recursive: true });
	await writeFile(outputPath, buffer);
	return { status: existing ? "updated" : "created", contentHash };
}

type SkillCopyCandidate = {
	sourcePath: string;
	destinationPath: string;
	isSkillFile: boolean;
	markerRank: number;
};

function markerRank(markerType: LocalMarkerType | null): number {
	if (markerType === "path") {
		return 2;
	}
	if (markerType === "suffix") {
		return 1;
	}
	return 0;
}

function normalizeLocalRelativeFilePath(relativePath: string): {
	normalizedPath: string;
	markerType: LocalMarkerType | null;
} {
	const parts = relativePath.split(path.sep).filter(Boolean);
	if (parts.length === 0) {
		return { normalizedPath: relativePath, markerType: null };
	}
	const directoryParts = parts.slice(0, -1);
	const fileName = parts[parts.length - 1];
	let hasPathMarker = false;

	const normalizedDirectories: string[] = [];
	for (const part of directoryParts) {
		if (part === ".local") {
			hasPathMarker = true;
			continue;
		}
		const { baseName, hadLocalSuffix } = stripLocalPathSuffix(part);
		if (hadLocalSuffix) {
			hasPathMarker = true;
		}
		if (!baseName) {
			continue;
		}
		normalizedDirectories.push(baseName);
	}

	let normalizedFileName = fileName;
	const isEnvPrefixedFile = fileName.toLowerCase().startsWith(".env");
	const extension = path.extname(fileName);
	let strippedSuffix: ReturnType<typeof stripLocalSuffix> = {
		baseName: fileName,
		outputFileName: fileName,
		hadLocalSuffix: false,
	};
	if (!isEnvPrefixedFile) {
		strippedSuffix = stripLocalSuffix(fileName, extension);
		if (strippedSuffix.hadLocalSuffix) {
			normalizedFileName = strippedSuffix.outputFileName;
		}
		const strippedPath = stripLocalPathSuffix(normalizedFileName);
		if (strippedPath.hadLocalSuffix) {
			hasPathMarker = true;
			normalizedFileName = strippedPath.baseName;
		}
	}

	const normalizedParts = [...normalizedDirectories, normalizedFileName].filter(Boolean);
	const markerType: LocalMarkerType | null = hasPathMarker
		? "path"
		: strippedSuffix.hadLocalSuffix
			? "suffix"
			: null;
	return {
		normalizedPath: normalizedParts.join(path.sep),
		markerType,
	};
}

async function collectSkillCopyCandidates(options: {
	source: string;
	destination: string;
	skillFileName: string;
	outputFileName: string;
	sourceType: SourceType;
	markerType?: LocalMarkerType;
}): Promise<SkillCopyCandidate[]> {
	const selectedSkillFile = options.skillFileName.toLowerCase();
	const candidates: SkillCopyCandidate[] = [];

	const walk = async (currentSource: string, relativePrefix = ""): Promise<void> => {
		const entries = await readdir(currentSource, { withFileTypes: true });
		for (const entry of entries) {
			const sourcePath = path.join(currentSource, entry.name);
			const relativePath = relativePrefix ? path.join(relativePrefix, entry.name) : entry.name;
			if (entry.isDirectory()) {
				await walk(sourcePath, relativePath);
				continue;
			}
			if (!entry.isFile()) {
				continue;
			}

			const entryLowerName = entry.name.toLowerCase();
			const isSkillFile = entryLowerName === "skill.md" || entryLowerName === "skill.local.md";
			if (isSkillFile && entryLowerName !== selectedSkillFile) {
				continue;
			}

			const detectedMarker =
				detectLocalMarkerFromPath(relativePath) ??
				(options.sourceType === "local" && options.markerType === "path" ? "path" : null);
			if (isSkillFile) {
				candidates.push({
					sourcePath,
					destinationPath: path.join(options.destination, options.outputFileName),
					isSkillFile: true,
					markerRank: markerRank(detectedMarker),
				});
				continue;
			}

			const normalized = normalizeLocalRelativeFilePath(relativePath);
			if (!normalized.normalizedPath) {
				continue;
			}
			const marker = normalized.markerType ?? detectedMarker;
			candidates.push({
				sourcePath,
				destinationPath: path.join(options.destination, normalized.normalizedPath),
				isSkillFile: false,
				markerRank: markerRank(marker),
			});
		}
	};

	await walk(options.source);
	return candidates;
}

async function copySkillDirectory(options: {
	source: string;
	destination: string;
	targetId: string;
	validAgents: string[];
	skillFileName: string;
	outputFileName: string;
	sourceType: SourceType;
	markerType?: LocalMarkerType;
	templateScriptRuntime?: WriterContext["templateScriptRuntime"];
}): Promise<void> {
	await mkdir(options.destination, { recursive: true });
	const candidates = await collectSkillCopyCandidates({
		source: options.source,
		destination: options.destination,
		skillFileName: options.skillFileName,
		outputFileName: options.outputFileName,
		sourceType: options.sourceType,
		markerType: options.markerType,
	});
	const winnerByOutputPath = new Map<string, SkillCopyCandidate>();
	for (const candidate of candidates) {
		const key = path.normalize(candidate.destinationPath).replace(/\\/g, "/").toLowerCase();
		const existing = winnerByOutputPath.get(key);
		if (
			!existing ||
			candidate.markerRank > existing.markerRank ||
			(candidate.markerRank === existing.markerRank &&
				candidate.sourcePath.localeCompare(existing.sourcePath) > 0)
		) {
			winnerByOutputPath.set(key, candidate);
		}
	}
	const winners = [...winnerByOutputPath.values()].sort((left, right) =>
		left.destinationPath.localeCompare(right.destinationPath),
	);

	for (const winner of winners) {
		const buffer = await readFile(winner.sourcePath);
		const decoded = decodeUtf8(buffer);
		if (decoded === null) {
			await mkdir(path.dirname(winner.destinationPath), { recursive: true });
			await writeFile(winner.destinationPath, buffer);
			continue;
		}

		const withScripts = options.templateScriptRuntime
			? await evaluateTemplateScripts({
					templatePath: winner.sourcePath,
					content: decoded,
					runtime: options.templateScriptRuntime,
				})
			: decoded;
		const templated = applyAgentTemplating({
			content: withScripts,
			target: options.targetId,
			validAgents: options.validAgents,
			sourcePath: winner.sourcePath,
		});
		const output = winner.isSkillFile
			? stripFrontmatterFields(templated, TARGET_FRONTMATTER_KEYS)
			: templated;
		await mkdir(path.dirname(winner.destinationPath), { recursive: true });
		await writeFile(winner.destinationPath, output, "utf8");
	}
}

export const defaultSkillWriter: OutputWriter = {
	id: "default-skill-writer",
	async write(options: {
		outputPath: string;
		content: string | Buffer;
		item?: unknown;
		context: WriterContext;
	}): Promise<WriterResult> {
		const item = options.item as SkillWriterItem | undefined;
		if (!item) {
			return writeOutputFile(options.outputPath, options.content);
		}
		await copySkillDirectory({
			source: item.directoryPath,
			destination: options.outputPath,
			targetId: options.context.targetId,
			validAgents: options.context.validAgents,
			skillFileName: item.skillFileName,
			outputFileName: item.outputFileName,
			sourceType: item.sourceType,
			markerType: item.markerType,
			templateScriptRuntime: options.context.templateScriptRuntime,
		});
		return { status: "created" };
	},
};

export const defaultSubagentWriter: OutputWriter = {
	id: "default-subagent-writer",
	async write(options: {
		outputPath: string;
		content: string | Buffer;
		item?: unknown;
		context: WriterContext;
	}): Promise<WriterResult> {
		const item = options.item as SubagentWriterItem | undefined;
		if (!item) {
			return writeOutputFile(options.outputPath, options.content);
		}
		const withScripts = options.context.templateScriptRuntime
			? await evaluateTemplateScripts({
					templatePath: item.sourcePath,
					content: item.rawContents,
					runtime: options.context.templateScriptRuntime,
				})
			: item.rawContents;
		const templated = applyAgentTemplating({
			content: withScripts,
			target: options.context.targetId,
			validAgents: options.context.validAgents,
			sourcePath: item.sourcePath,
		});
		const cleaned =
			item.outputKind === "skill"
				? stripFrontmatterFields(templated, SKILL_FRONTMATTER_KEYS_TO_REMOVE)
				: stripFrontmatterFields(templated, TARGET_FRONTMATTER_KEYS);
		if (item.outputKind === "skill") {
			const destinationPath = path.join(options.outputPath, "SKILL.md");
			return writeOutputFile(destinationPath, cleaned);
		}
		return writeOutputFile(options.outputPath, cleaned);
	},
};

export const defaultInstructionWriter: OutputWriter = {
	id: "default-instruction-writer",
	async write(options: {
		outputPath: string;
		content: string | Buffer;
		item?: unknown;
		context: WriterContext;
	}): Promise<WriterResult> {
		const item = options.item as InstructionWriterItem | undefined;
		if (item && item.content === null) {
			return { status: "skipped" };
		}
		return writeOutputFile(options.outputPath, options.content);
	},
};

export async function writeFileOutput(
	outputPath: string,
	content: string | Buffer,
): Promise<WriterResult> {
	return writeOutputFile(outputPath, content);
}
