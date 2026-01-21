import { readFile } from "node:fs/promises";
import path from "node:path";
import { applyAgentTemplating } from "../agent-templating.js";
import { loadInstructionTemplateCatalog } from "../instructions/catalog.js";
import { scanRepoInstructionSources } from "../instructions/scan.js";
import { normalizeConvertResult } from "./convert.js";
import { runConvertHook } from "./hooks.js";
import { resolveConfigValue } from "./resolve-output.js";
import type {
	ConvertContext,
	InstructionItem,
	InstructionOutputConfig,
	OutputFile,
	ResolvedTargetDefinition,
} from "./types.js";
import { OutputWriter } from "./output-writer.js";

const DEFAULT_INSTRUCTION_FILE = "AGENTS.md";

type InstructionItemsResult = {
	items: InstructionItem[];
	warnings: string[];
};

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

export async function loadInstructionItems(options: {
	repoRoot: string;
	agentsDir?: string | null;
	includeLocal?: boolean;
}): Promise<InstructionItemsResult> {
	const includeLocal = options.includeLocal ?? true;
	const templateCatalog = await loadInstructionTemplateCatalog({
		repoRoot: options.repoRoot,
		includeLocal,
		agentsDir: options.agentsDir,
	});
	const repoEntries = await scanRepoInstructionSources({
		repoRoot: options.repoRoot,
		includeLocal,
		agentsDir: options.agentsDir,
	});

	const items: InstructionItem[] = [];
	const warnings: string[] = [];
	for (const template of templateCatalog.templates) {
		if (!template.resolvedOutputDir) {
			warnings.push(
				`Instruction template missing outPutPath: ${template.sourcePath}.`,
			);
			continue;
		}
		items.push({
			itemType: "instruction",
			name: path.basename(template.sourcePath),
			sourcePath: template.sourcePath,
			sourceType: template.sourceType,
			raw: template.rawContents,
			frontmatter: template.frontmatter,
			body: template.body,
			targetAgents: template.targets,
			outputDir: template.resolvedOutputDir,
			group: template.group ?? null,
			origin: "template",
		});
	}

	for (const entry of repoEntries) {
		const rawContents = await readFile(entry.sourcePath, "utf8");
		items.push({
			itemType: "instruction",
			name: path.basename(entry.sourcePath),
			sourcePath: entry.sourcePath,
			sourceType: entry.sourceType,
			raw: rawContents,
			frontmatter: {},
			body: rawContents,
			targetAgents: null,
			outputDir: path.dirname(entry.sourcePath),
			group: null,
			origin: "repo",
		});
	}

	return { items, warnings };
}

function buildOutputFile(options: {
	item: InstructionItem;
	targetId: string;
	path: string;
	content: string;
	isCanonicalInstruction: boolean;
}): OutputFile {
	return {
		path: options.path,
		content: options.content,
		itemType: "instruction",
		itemName: options.item.name,
		sourcePath: options.item.sourcePath,
		targetId: options.targetId,
		isCanonicalInstruction: options.isCanonicalInstruction,
	};
}

function resolveInstructionPath(options: {
	fileName: string;
	outputDir: string;
	context: ConvertContext;
	item: InstructionItem;
}): string {
	const templated = options.context.template(options.fileName, { item: options.item });
	if (path.isAbsolute(templated)) {
		return path.normalize(templated);
	}
	return path.join(options.outputDir, templated);
}

function matchesGroup(options: {
	item: InstructionItem;
	groupFilter: string | null | undefined;
}): boolean {
	if (options.groupFilter === undefined) {
		return true;
	}
	if (options.groupFilter === null) {
		return options.item.group === null;
	}
	return options.item.group === options.groupFilter;
}

export async function writeInstructionOutputs(options: {
	items: InstructionItem[];
	output: ResolvedTargetDefinition["outputs"]["instructions"];
	context: ConvertContext;
	outputWriter: OutputWriter;
	target: ResolvedTargetDefinition;
	validAgents: string[];
}): Promise<void> {
	if (options.output === false) {
		return;
	}

	const outputConfig: InstructionOutputConfig | null =
		options.output && options.output !== false ? options.output : null;
	const isDefaultInstructions = options.output === null || options.output === undefined;

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
					`Instruction ${item.sourcePath}: ${message}`,
				),
			label: "beforeConvert",
		});
		if (!beforeOk) {
			continue;
		}
		const groupFilter = outputConfig
			? await resolveConfigValue({
					value: outputConfig.group,
					item,
					context: options.context,
				})
			: undefined;
		if (!matchesGroup({ item, groupFilter })) {
			continue;
		}

		const fileNameValue = outputConfig?.fileName
			? await resolveConfigValue({
					value: outputConfig.fileName,
					item,
					context: options.context,
				})
			: DEFAULT_INSTRUCTION_FILE;
		const fileName = fileNameValue?.trim() ?? "";
		if (!fileName) {
			options.outputWriter.recordError(
				options.target.id,
				`Instruction fileName is empty for ${item.sourcePath}.`,
			);
			continue;
		}
		const outputPath = resolveInstructionPath({
			fileName,
			outputDir: item.outputDir,
			context: options.context,
			item,
		});

		if (outputConfig?.convert) {
			let converted;
			try {
				converted = await outputConfig.convert({ item, context: options.context });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				options.outputWriter.recordError(
					options.target.id,
					`Instruction converter failed for ${item.sourcePath}: ${message}`,
				);
				await runConvertHook({
					hook: options.target.hooks.afterConvert,
					item,
					context: options.context,
					onError: (hookMessage) =>
						options.outputWriter.recordError(
							options.target.id,
							`Instruction ${item.sourcePath}: ${hookMessage}`,
						),
					label: "afterConvert",
				});
				continue;
			}

			const normalized = normalizeConvertResult({
				result: converted,
				defaultPath: outputPath,
			});
			if (normalized.kind === "error") {
				options.outputWriter.recordError(
					options.target.id,
					`Instruction converter error for ${item.sourcePath}: ${normalized.message}`,
				);
				await runConvertHook({
					hook: options.target.hooks.afterConvert,
					item,
					context: options.context,
					onError: (hookMessage) =>
						options.outputWriter.recordError(
							options.target.id,
							`Instruction ${item.sourcePath}: ${hookMessage}`,
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
							`Instruction ${item.sourcePath}: ${hookMessage}`,
						),
					label: "afterConvert",
				});
				continue;
			}
			for (const output of normalized.outputs) {
				const outputResolved = options.context.resolvePath(output.path, { item });
				options.outputWriter.addOutput(
					buildOutputFile({
						item,
						targetId: options.target.id,
						path: outputResolved,
						content: output.content,
						isCanonicalInstruction: isDefaultInstructions,
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
						`Instruction ${item.sourcePath}: ${hookMessage}`,
					),
				label: "afterConvert",
			});
			continue;
		}

		const content = applyAgentTemplating({
			content: item.body,
			target: options.target.id,
			validAgents: options.validAgents,
			sourcePath: item.sourcePath,
		});
		options.outputWriter.addOutput(
			buildOutputFile({
				item,
				targetId: options.target.id,
				path: outputPath,
				content,
				isCanonicalInstruction: isDefaultInstructions,
			}),
		);
		await runConvertHook({
			hook: options.target.hooks.afterConvert,
			item,
			context: options.context,
			onError: (hookMessage) =>
				options.outputWriter.recordError(
					options.target.id,
					`Instruction ${item.sourcePath}: ${hookMessage}`,
				),
			label: "afterConvert",
		});
	}
}
