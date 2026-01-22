import path from "node:path";
import type {
	CommandLocation,
	CommandOutputDefinition,
	ConverterRef,
	FallbackRule,
	InstructionOutputDefinition,
	OutputDefinition,
	OutputTemplateContext,
	OutputTemplateValue,
	OutputWriterRef,
} from "./config-types.js";
import { resolvePlaceholders } from "./placeholders.js";

export type NormalizedOutputDefinition = {
	path: OutputTemplateValue;
	writer?: OutputWriterRef;
	converter?: ConverterRef;
	fallback?: FallbackRule;
};

export type NormalizedCommandOutputDefinition = {
	projectPath?: OutputTemplateValue;
	userPath?: OutputTemplateValue;
	writer?: OutputWriterRef;
	converter?: ConverterRef;
	fallback?: FallbackRule;
};

export type NormalizedInstructionOutputDefinition = {
	filename: OutputTemplateValue;
	group?: string;
	writer?: OutputWriterRef;
	converter?: ConverterRef;
};

export function normalizeOutputDefinition(
	definition: OutputDefinition | undefined,
): NormalizedOutputDefinition | null {
	if (!definition) {
		return null;
	}
	if (typeof definition === "string" || typeof definition === "function") {
		return { path: definition };
	}
	return { ...definition };
}

export function normalizeCommandOutputDefinition(
	definition: CommandOutputDefinition | undefined,
): NormalizedCommandOutputDefinition | null {
	if (!definition) {
		return null;
	}
	if (typeof definition === "string" || typeof definition === "function") {
		return { projectPath: definition };
	}
	return { ...definition };
}

export function normalizeInstructionOutputDefinition(
	definition: InstructionOutputDefinition | undefined,
): NormalizedInstructionOutputDefinition | null {
	if (!definition) {
		return null;
	}
	if (typeof definition === "string" || typeof definition === "function") {
		return { filename: definition };
	}
	return { ...definition };
}

function resolveTemplateValue(
	value: OutputTemplateValue,
	context: OutputTemplateContext,
	item: unknown,
): string {
	const raw = typeof value === "function" ? value(item, context) : value;
	return resolvePlaceholders(String(raw), {
		repoRoot: context.repoRoot,
		homeDir: context.homeDir,
		agentsDir: context.agentsDir,
		targetId: context.targetId,
		itemName: context.itemName,
		commandLocation: context.commandLocation,
	});
}

function resolveToAbsolute(resolved: string, baseDir: string): string {
	if (path.isAbsolute(resolved)) {
		return path.normalize(resolved);
	}
	return path.normalize(path.resolve(baseDir, resolved));
}

export function resolveOutputPath(options: {
	template: OutputTemplateValue;
	context: OutputTemplateContext & { itemName: string; commandLocation?: CommandLocation };
	item: unknown;
	baseDir: string;
}): string {
	const resolved = resolveTemplateValue(options.template, options.context, options.item);
	return resolveToAbsolute(resolved, options.baseDir);
}

export function resolveCommandOutputPath(options: {
	template: OutputTemplateValue;
	context: OutputTemplateContext & { itemName: string; commandLocation: CommandLocation };
	item: unknown;
	baseDir: string;
}): string {
	const resolved = resolveTemplateValue(options.template, options.context, options.item);
	return resolveToAbsolute(resolved, options.baseDir);
}

export function resolveInstructionFilename(options: {
	template: OutputTemplateValue;
	context: OutputTemplateContext & { itemName: string };
	item: unknown;
}): string {
	const resolved = resolveTemplateValue(options.template, options.context, options.item);
	return path.normalize(resolved);
}
