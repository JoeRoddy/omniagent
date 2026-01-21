import path from "node:path";
import { applyAgentTemplating } from "../agent-templating.js";
import { stripFrontmatterFields } from "../frontmatter-strip.js";
import { loadSubagentCatalog } from "../subagents/catalog.js";
import { normalizeConvertResult } from "./convert.js";
import { runConvertHook } from "./hooks.js";
import { resolveConfigValue } from "./resolve-output.js";
import type {
	ConvertContext,
	OutputFile,
	ResolvedTargetDefinition,
	SkillOutputConfig,
	SubagentItem,
} from "./types.js";
import { OutputWriter } from "./output-writer.js";

const TARGET_FRONTMATTER_KEYS = new Set(["targets", "targetagents"]);
const SKILL_FRONTMATTER_KEYS_TO_REMOVE = new Set([
	...TARGET_FRONTMATTER_KEYS,
	"tools",
	"model",
	"color",
]);

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

export async function loadSubagentItems(options: {
	repoRoot: string;
	agentsDir?: string | null;
	includeLocal?: boolean;
}): Promise<SubagentItem[]> {
	const catalog = await loadSubagentCatalog(options.repoRoot, {
		includeLocal: options.includeLocal,
		agentsDir: options.agentsDir,
	});
	return catalog.subagents.map((subagent) => ({
		itemType: "subagent",
		name: subagent.resolvedName,
		sourcePath: subagent.sourcePath,
		sourceType: subagent.sourceType,
		raw: subagent.rawContents,
		frontmatter: subagent.frontmatter,
		body: subagent.body,
		fileName: subagent.fileName,
		targetAgents: subagent.targetAgents,
	}));
}

function buildOutputFile(options: {
	item: SubagentItem;
	targetId: string;
	path: string;
	content: string;
}): OutputFile {
	return {
		path: options.path,
		content: options.content,
		itemType: "subagent",
		itemName: options.item.name,
		sourcePath: options.item.sourcePath,
		targetId: options.targetId,
	};
}

function resolveSkillFallbackPath(options: { basePath: string; item: SubagentItem }): string {
	return path.join(options.basePath, options.item.name, "SKILL.md");
}

export async function writeSubagentOutputs(options: {
	items: SubagentItem[];
	output: ResolvedTargetDefinition["outputs"]["subagents"];
	skillOutput: SkillOutputConfig | null;
	context: ConvertContext;
	outputWriter: OutputWriter;
	target: ResolvedTargetDefinition;
	validAgents: string[];
}): Promise<void> {
	const outputConfig = options.output;
	const canFallbackToSkills =
		!options.target.supports.subagents &&
		options.target.source !== "custom" &&
		Boolean(options.skillOutput);
	if (!outputConfig && !canFallbackToSkills) {
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
					`Subagent ${item.name}: ${message}`,
				),
			label: "beforeConvert",
		});
		if (!beforeOk) {
			continue;
		}

		const templatedContents = applyAgentTemplating({
			content: item.raw,
			target: options.target.id,
			validAgents: options.validAgents,
			sourcePath: item.sourcePath,
		});

		if (outputConfig?.convert) {
			let converted;
			try {
				converted = await outputConfig.convert({ item, context: options.context });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				options.outputWriter.recordError(
					options.target.id,
					`Subagent converter failed for ${item.name}: ${message}`,
				);
				await runConvertHook({
					hook: options.target.hooks.afterConvert,
					item,
					context: options.context,
					onError: (hookMessage) =>
						options.outputWriter.recordError(
							options.target.id,
							`Subagent ${item.name}: ${hookMessage}`,
						),
					label: "afterConvert",
				});
				continue;
			}
			const basePathRaw = outputConfig.path
				? await resolveConfigValue({
						value: outputConfig.path,
						item,
						context: options.context,
					})
				: null;
			const basePath = basePathRaw ? options.context.resolvePath(basePathRaw, { item }) : null;
			const defaultPath = basePath ? path.join(basePath, `${item.name}.md`) : null;
			const normalized = normalizeConvertResult({ result: converted, defaultPath });
			if (normalized.kind === "error") {
				options.outputWriter.recordError(
					options.target.id,
					`Subagent converter error for ${item.name}: ${normalized.message}`,
				);
				await runConvertHook({
					hook: options.target.hooks.afterConvert,
					item,
					context: options.context,
					onError: (hookMessage) =>
						options.outputWriter.recordError(
							options.target.id,
							`Subagent ${item.name}: ${hookMessage}`,
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
							`Subagent ${item.name}: ${hookMessage}`,
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
						`Subagent ${item.name}: ${hookMessage}`,
					),
				label: "afterConvert",
			});
			continue;
		}

		if (options.target.supports.subagents && outputConfig) {
			const basePathRaw = await resolveConfigValue({
				value: outputConfig.path,
				item,
				context: options.context,
			});
			if (!basePathRaw) {
				options.outputWriter.recordError(
					options.target.id,
					`Subagent output path is empty for ${item.name}.`,
				);
				continue;
			}
			const basePath = options.context.resolvePath(basePathRaw, { item });
			const outputPath = path.join(basePath, `${item.name}.md`);
			const content = stripFrontmatterFields(templatedContents, TARGET_FRONTMATTER_KEYS);
			options.outputWriter.addOutput(
				buildOutputFile({
					item,
					targetId: options.target.id,
					path: outputPath,
					content,
				}),
			);
			await runConvertHook({
				hook: options.target.hooks.afterConvert,
				item,
				context: options.context,
				onError: (hookMessage) =>
					options.outputWriter.recordError(
						options.target.id,
						`Subagent ${item.name}: ${hookMessage}`,
					),
				label: "afterConvert",
			});
			continue;
		}

		if (!options.target.supports.subagents && options.target.source !== "custom" && options.skillOutput) {
			const basePathRaw = await resolveConfigValue({
				value: options.skillOutput.path,
				item,
				context: options.context,
			});
			if (!basePathRaw) {
				options.outputWriter.recordError(
					options.target.id,
					`Skill fallback path missing for subagent ${item.name}.`,
				);
				continue;
			}
			const basePath = options.context.resolvePath(basePathRaw, { item });
			const outputPath = resolveSkillFallbackPath({ basePath, item });
			const content = stripFrontmatterFields(templatedContents, SKILL_FRONTMATTER_KEYS_TO_REMOVE);
			options.outputWriter.addOutput(
				buildOutputFile({
					item,
					targetId: options.target.id,
					path: outputPath,
					content,
				}),
			);
			await runConvertHook({
				hook: options.target.hooks.afterConvert,
				item,
				context: options.context,
				onError: (hookMessage) =>
					options.outputWriter.recordError(
						options.target.id,
						`Subagent ${item.name}: ${hookMessage}`,
					),
				label: "afterConvert",
			});
			continue;
		}

		options.outputWriter.recordSkip(options.target.id);
		await runConvertHook({
			hook: options.target.hooks.afterConvert,
			item,
			context: options.context,
			onError: (hookMessage) =>
				options.outputWriter.recordError(
					options.target.id,
					`Subagent ${item.name}: ${hookMessage}`,
				),
			label: "afterConvert",
		});
	}
}
