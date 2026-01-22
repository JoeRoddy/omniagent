import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { applyAgentTemplating } from "../agent-templating.js";
import { stripFrontmatterFields } from "../frontmatter-strip.js";
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

async function copySkillDirectory(options: {
	source: string;
	destination: string;
	targetId: string;
	validAgents: string[];
	skillFileName: string;
	outputFileName: string;
}): Promise<void> {
	await mkdir(options.destination, { recursive: true });
	const entries = await readdir(options.source, { withFileTypes: true });
	const selectedSkillFile = options.skillFileName.toLowerCase();
	const outputSkillFile = options.outputFileName;

	for (const entry of entries) {
		const sourcePath = path.join(options.source, entry.name);
		const entryLowerName = entry.name.toLowerCase();
		const isSkillFile = entryLowerName === "skill.md" || entryLowerName === "skill.local.md";
		if (isSkillFile && entryLowerName !== selectedSkillFile) {
			continue;
		}
		const destinationPath = isSkillFile
			? path.join(options.destination, outputSkillFile)
			: path.join(options.destination, entry.name);
		if (entry.isDirectory()) {
			await copySkillDirectory({
				...options,
				source: sourcePath,
				destination: path.join(options.destination, entry.name),
			});
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}

		const buffer = await readFile(sourcePath);
		const decoded = decodeUtf8(buffer);
		if (decoded === null) {
			await mkdir(path.dirname(destinationPath), { recursive: true });
			await writeFile(destinationPath, buffer);
			continue;
		}

		const templated = applyAgentTemplating({
			content: decoded,
			target: options.targetId,
			validAgents: options.validAgents,
			sourcePath,
		});
		const output = isSkillFile
			? stripFrontmatterFields(templated, TARGET_FRONTMATTER_KEYS)
			: templated;
		await mkdir(path.dirname(destinationPath), { recursive: true });
		await writeFile(destinationPath, output, "utf8");
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
		const templated = applyAgentTemplating({
			content: item.rawContents,
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
