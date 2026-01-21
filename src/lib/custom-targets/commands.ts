import { applyAgentTemplating } from "../agent-templating.js";
import { loadCommandCatalog, type SlashCommandDefinition } from "../slash-commands/catalog.js";
import { extractFrontmatter } from "../slash-commands/frontmatter.js";
import {
	renderClaudeCommand,
	renderGeminiCommand,
	renderSkillFromCommand,
} from "../slash-commands/formatting.js";
import { normalizeConvertResult } from "./convert.js";
import {
	resolveCommandFallback,
	resolveCommandFormat,
	resolveCommandScopes,
	resolveConfigValue,
} from "./resolve-output.js";
import { runConvertHook } from "./hooks.js";
import type {
	CommandItem,
	ConvertContext,
	OutputFile,
	ResolvedTargetDefinition,
	SkillOutputConfig,
} from "./types.js";
import { OutputWriter } from "./output-writer.js";
import path from "node:path";

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

function toSlashCommandDefinition(item: CommandItem, templatedContents: string): SlashCommandDefinition {
	const { frontmatter, body } = extractFrontmatter(templatedContents);
	return {
		name: item.name,
		prompt: body.trimEnd(),
		sourcePath: item.sourcePath,
		sourceType: item.sourceType,
		markerType: undefined,
		isLocalFallback: false,
		rawContents: templatedContents,
		targetAgents: item.targetAgents ?? null,
		invalidTargets: [],
		frontmatter,
	};
}

export async function loadCommandItems(options: {
	repoRoot: string;
	agentsDir?: string | null;
	includeLocal?: boolean;
}): Promise<CommandItem[]> {
	const catalog = await loadCommandCatalog(options.repoRoot, {
		includeLocal: options.includeLocal,
		agentsDir: options.agentsDir,
	});
	return catalog.commands.map((command) => ({
		itemType: "command",
		name: command.name,
		sourcePath: command.sourcePath,
		sourceType: command.sourceType,
		raw: command.rawContents,
		frontmatter: command.frontmatter,
		body: command.prompt,
		prompt: command.prompt,
		targetAgents: command.targetAgents,
	}));
}

function buildOutputFile(options: {
	item: CommandItem;
	targetId: string;
	path: string;
	content: string;
}): OutputFile {
	return {
		path: options.path,
		content: options.content,
		itemType: "command",
		itemName: options.item.name,
		sourcePath: options.item.sourcePath,
		targetId: options.targetId,
	};
}

function resolveSkillFallbackPath(options: {
	basePath: string;
	item: CommandItem;
}): string {
	return path.join(options.basePath, options.item.name, "SKILL.md");
}

export async function writeCommandOutputs(options: {
	items: CommandItem[];
	output: ResolvedTargetDefinition["outputs"]["commands"];
	skillOutput: SkillOutputConfig | null;
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
					`Command ${item.name}: ${message}`,
				),
			label: "beforeConvert",
		});
		if (!beforeOk) {
			continue;
		}

		if (outputConfig.convert) {
			let converted;
			try {
				converted = await outputConfig.convert({ item, context: options.context });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				options.outputWriter.recordError(
					options.target.id,
					`Command converter failed for ${item.name}: ${message}`,
				);
				await runConvertHook({
					hook: options.target.hooks.afterConvert,
					item,
					context: options.context,
					onError: (hookMessage) =>
						options.outputWriter.recordError(
							options.target.id,
							`Command ${item.name}: ${hookMessage}`,
						),
					label: "afterConvert",
				});
				continue;
			}

			const format = await resolveCommandFormat({
				config: outputConfig,
				item,
				context: options.context,
			});
			const scopes = await resolveCommandScopes({
				config: outputConfig,
				item,
				context: options.context,
			});
			const extension = format === "toml" ? ".toml" : ".md";
			const firstScope = scopes[0] ?? "project";
			const basePathRaw =
				firstScope === "global"
					? await resolveConfigValue({
							value: outputConfig.globalPath ?? outputConfig.path,
							item,
							context: options.context,
						})
					: await resolveConfigValue({
							value: outputConfig.path,
							item,
							context: options.context,
						});
			const basePath = basePathRaw ? options.context.resolvePath(basePathRaw, { item }) : null;
			const defaultPath = basePath ? path.join(basePath, `${item.name}${extension}`) : null;

			const normalized = normalizeConvertResult({ result: converted, defaultPath });
			if (normalized.kind === "error") {
				options.outputWriter.recordError(
					options.target.id,
					`Command converter error for ${item.name}: ${normalized.message}`,
				);
				await runConvertHook({
					hook: options.target.hooks.afterConvert,
					item,
					context: options.context,
					onError: (hookMessage) =>
						options.outputWriter.recordError(
							options.target.id,
							`Command ${item.name}: ${hookMessage}`,
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
							`Command ${item.name}: ${hookMessage}`,
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
						`Command ${item.name}: ${hookMessage}`,
					),
				label: "afterConvert",
			});
			continue;
		}

		const templatedContents = applyAgentTemplating({
			content: item.raw,
			target: options.target.id,
			validAgents: options.validAgents,
			sourcePath: item.sourcePath,
		});
		const templatedCommand = toSlashCommandDefinition(item, templatedContents);

		if (!options.target.supports.commands) {
			const fallback = await resolveCommandFallback({
				config: outputConfig,
				item,
				context: options.context,
			});
			if (fallback !== "skills" || !options.skillOutput) {
				options.outputWriter.recordSkip(options.target.id);
				continue;
			}
			const basePathRaw = await resolveConfigValue({
				value: options.skillOutput.path,
				item,
				context: options.context,
			});
			if (!basePathRaw) {
				options.outputWriter.recordError(
					options.target.id,
					`Skill fallback path missing for command ${item.name}.`,
				);
				continue;
			}
			const basePath = options.context.resolvePath(basePathRaw, { item });
			const outputPath = resolveSkillFallbackPath({ basePath, item });
			const content = renderSkillFromCommand(templatedCommand);
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
						`Command ${item.name}: ${hookMessage}`,
					),
				label: "afterConvert",
			});
			continue;
		}

		const scopes = await resolveCommandScopes({
			config: outputConfig,
			item,
			context: options.context,
		});
		const format = await resolveCommandFormat({
			config: outputConfig,
			item,
			context: options.context,
		});
		const extension = format === "toml" ? ".toml" : ".md";
		const content = format === "toml"
			? renderGeminiCommand(templatedCommand)
			: renderClaudeCommand(templatedCommand);

		for (const scope of scopes) {
			const pathValue =
				scope === "global"
					? await resolveConfigValue({
							value: outputConfig.globalPath ?? outputConfig.path,
							item,
							context: options.context,
						})
					: await resolveConfigValue({
							value: outputConfig.path,
							item,
							context: options.context,
						});
			if (!pathValue) {
				options.outputWriter.recordError(
					options.target.id,
					`Command output path is empty for ${item.name} (${scope}).`,
				);
				continue;
			}
			const basePath = options.context.resolvePath(pathValue, { item });
			const outputPath = path.join(basePath, `${item.name}${extension}`);
			options.outputWriter.addOutput(
				buildOutputFile({
					item,
					targetId: options.target.id,
					path: outputPath,
					content,
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
					`Command ${item.name}: ${hookMessage}`,
				),
			label: "afterConvert",
		});
	}
}
