import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { applyAgentTemplating } from "../agent-templating.js";
import { stripFrontmatterFields } from "../frontmatter-strip.js";
import { loadSkillCatalog, type SkillDefinition } from "../skills/catalog.js";
import { normalizeConvertResult } from "./convert.js";
import { runConvertHook } from "./hooks.js";
import { resolveConfigValue } from "./resolve-output.js";
import type { ConvertContext, OutputFile, ResolvedTargetDefinition, SkillItem } from "./types.js";
import { OutputWriter } from "./output-writer.js";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const TARGET_FRONTMATTER_KEYS = new Set(["targets", "targetagents"]);

function decodeUtf8(buffer: Buffer): string | null {
	try {
		return utf8Decoder.decode(buffer);
	} catch {
		return null;
	}
}

function normalizeTargetList(values: string[] | null | undefined): string[] {
	return (values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function matchesTarget(options: {
	itemTargets?: string[] | null;
	target: ResolvedTargetDefinition;
}): boolean {
	const itemTargets = normalizeTargetList(options.itemTargets);
	if (itemTargets.length === 0) {
		return true;
	}
	const targetId = options.target.id.toLowerCase();
	if (itemTargets.includes(targetId)) {
		return true;
	}
	for (const alias of options.target.aliases) {
		if (itemTargets.includes(alias.toLowerCase())) {
			return true;
		}
	}
	return false;
}

async function listFiles(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const entryPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listFiles(entryPath)));
			continue;
		}
		if (entry.isFile()) {
			files.push(entryPath);
		}
	}
	return files;
}

async function buildSkillItem(skill: SkillDefinition): Promise<SkillItem> {
	const files = await listFiles(skill.directoryPath);
	return {
		itemType: "skill",
		name: skill.name,
		sourcePath: skill.sourcePath,
		sourceType: skill.sourceType,
		raw: skill.rawContents,
		frontmatter: skill.frontmatter,
		body: skill.body,
		targetAgents: skill.targetAgents,
		relativePath: skill.relativePath,
		directoryPath: skill.directoryPath,
		skillFileName: skill.skillFileName,
		outputFileName: skill.outputFileName,
		files,
	};
}

export async function loadSkillItems(options: {
	repoRoot: string;
	agentsDir?: string | null;
	includeLocal?: boolean;
}): Promise<SkillItem[]> {
	const catalog = await loadSkillCatalog(options.repoRoot, {
		includeLocal: options.includeLocal,
		agentsDir: options.agentsDir,
	});
	const items: SkillItem[] = [];
	for (const skill of catalog.skills) {
		items.push(await buildSkillItem(skill));
	}
	return items;
}

function buildOutputFile(options: {
	item: SkillItem;
	targetId: string;
	path: string;
	content: string | Buffer;
}): OutputFile {
	return {
		path: options.path,
		content: options.content,
		itemType: "skill",
		itemName: options.item.name,
		sourcePath: options.item.sourcePath,
		targetId: options.targetId,
	};
}

function resolveDefaultPaths(options: {
	basePath: string;
	item: SkillItem;
}): { directoryPath: string; skillFilePath: string } {
	const directoryPath = path.join(options.basePath, options.item.relativePath);
	return {
		directoryPath,
		skillFilePath: path.join(directoryPath, options.item.outputFileName),
	};
}

async function addDefaultSkillOutputs(options: {
	item: SkillItem;
	context: ConvertContext;
	outputWriter: OutputWriter;
	target: ResolvedTargetDefinition;
	basePath: string;
	validAgents: string[];
}): Promise<void> {
	const resolvedPaths = resolveDefaultPaths({ basePath: options.basePath, item: options.item });
	const skillFileLower = options.item.skillFileName.toLowerCase();

	for (const sourceFile of options.item.files) {
		const relative = path.relative(options.item.directoryPath, sourceFile);
		const entryName = path.basename(sourceFile);
		const entryLower = entryName.toLowerCase();
		const isSkillFile = entryLower === "skill.md" || entryLower === "skill.local.md";
		if (isSkillFile && entryLower !== skillFileLower) {
			continue;
		}

		const destinationPath = isSkillFile
			? resolvedPaths.skillFilePath
			: path.join(resolvedPaths.directoryPath, relative);
		const buffer = await readFile(sourceFile);
		const decoded = decodeUtf8(buffer);
		if (decoded === null) {
			options.outputWriter.addOutput(
				buildOutputFile({
					item: options.item,
					targetId: options.target.id,
					path: destinationPath,
					content: buffer,
				}),
			);
			continue;
		}
		const templated = applyAgentTemplating({
			content: decoded,
			target: options.target.id,
			validAgents: options.validAgents,
			sourcePath: sourceFile,
		});
		const output = isSkillFile
			? stripFrontmatterFields(templated, TARGET_FRONTMATTER_KEYS)
			: templated;
		options.outputWriter.addOutput(
			buildOutputFile({
				item: options.item,
				targetId: options.target.id,
				path: destinationPath,
				content: output,
			}),
		);
	}
}

export async function writeSkillOutputs(options: {
	items: SkillItem[];
	output: ResolvedTargetDefinition["outputs"]["skills"];
	context: ConvertContext;
	outputWriter: OutputWriter;
	target: ResolvedTargetDefinition;
	validAgents: string[];
}): Promise<void> {
	const outputConfig = options.output;
	if (!outputConfig) {
		return;
	}

	for (const item of options.items) {
		if (!matchesTarget({ itemTargets: item.targetAgents, target: options.target })) {
			continue;
		}
		const beforeOk = await runConvertHook({
			hook: options.target.hooks.beforeConvert,
			item,
			context: options.context,
			onError: (message) =>
				options.outputWriter.recordError(
					options.target.id,
					`Skill ${item.name}: ${message}`,
				),
			label: "beforeConvert",
		});
		if (!beforeOk) {
			continue;
		}

		const basePathRaw = await resolveConfigValue({
			value: outputConfig.path,
			item,
			context: options.context,
		});
		if (!basePathRaw) {
			options.outputWriter.recordError(
				options.target.id,
				`Skill output path is empty for ${item.name}.`,
			);
			continue;
		}
		const basePath = options.context.resolvePath(basePathRaw, { item });
		const defaultPaths = resolveDefaultPaths({ basePath, item });
		if (outputConfig.convert) {
			let converted;
			try {
				converted = await outputConfig.convert({ item, context: options.context });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				options.outputWriter.recordError(
					options.target.id,
					`Skill converter failed for ${item.name}: ${message}`,
				);
				await runConvertHook({
					hook: options.target.hooks.afterConvert,
					item,
					context: options.context,
					onError: (hookMessage) =>
						options.outputWriter.recordError(
							options.target.id,
							`Skill ${item.name}: ${hookMessage}`,
						),
					label: "afterConvert",
				});
				continue;
			}
			const normalized = normalizeConvertResult({
				result: converted,
				defaultPath: defaultPaths.skillFilePath,
			});
			if (normalized.kind === "error") {
				options.outputWriter.recordError(
					options.target.id,
					`Skill converter error for ${item.name}: ${normalized.message}`,
				);
				await runConvertHook({
					hook: options.target.hooks.afterConvert,
					item,
					context: options.context,
					onError: (hookMessage) =>
						options.outputWriter.recordError(
							options.target.id,
							`Skill ${item.name}: ${hookMessage}`,
						),
					label: "afterConvert",
				});
				continue;
			}
			if (normalized.kind === "skip" || normalized.kind === "satisfy") {
				options.outputWriter.recordSkip(options.target.id);
				await runConvertHook({
					hook: options.target.hooks.afterConvert,
					item,
					context: options.context,
					onError: (hookMessage) =>
						options.outputWriter.recordError(
							options.target.id,
							`Skill ${item.name}: ${hookMessage}`,
						),
					label: "afterConvert",
				});
				continue;
			}
			for (const output of normalized.outputs) {
				const outputPath = options.context.resolvePath(output.path, { item });
				options.outputWriter.addOutput(
					buildOutputFile({
						item,
						targetId: options.target.id,
						path: outputPath,
						content: output.content,
					}),
				);
			}
			await runConvertHook({
				hook: options.target.hooks.afterConvert,
				item,
				context: options.context,
				onError: (hookMessage) =>
					options.outputWriter.recordError(
						options.target.id,
						`Skill ${item.name}: ${hookMessage}`,
					),
				label: "afterConvert",
			});
			continue;
		}

		await addDefaultSkillOutputs({
			item,
			context: options.context,
			outputWriter: options.outputWriter,
			target: options.target,
			basePath,
			validAgents: options.validAgents,
		});
		await runConvertHook({
			hook: options.target.hooks.afterConvert,
			item,
			context: options.context,
			onError: (hookMessage) =>
				options.outputWriter.recordError(
					options.target.id,
					`Skill ${item.name}: ${hookMessage}`,
				),
			label: "afterConvert",
		});
	}
}
