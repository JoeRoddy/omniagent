import type {
	CommandFallback,
	CommandFormat,
	CommandOutputConfig,
	CommandScope,
	ConfigValue,
	ConvertContext,
	InstructionOutputConfig,
	SkillOutputConfig,
	SubagentOutputConfig,
	TargetOutputsConfig,
} from "./types.js";

export async function resolveConfigValue<TItem, TValue>(options: {
	value: ConfigValue<TItem, TValue> | undefined;
	item: TItem;
	context: ConvertContext;
	fallback?: TValue;
}): Promise<TValue | undefined> {
	const value = options.value;
	if (value === undefined) {
		return options.fallback;
	}
	if (typeof value === "function") {
		return (await value({ item: options.item, context: options.context })) as TValue;
	}
	return value as TValue;
}

export function resolveSkillOutputConfig(
	value: TargetOutputsConfig["skills"] | undefined,
): SkillOutputConfig | null {
	if (!value) {
		return null;
	}
	if (typeof value === "string" || typeof value === "function") {
		return { path: value };
	}
	return value as SkillOutputConfig;
}

export function resolveSubagentOutputConfig(
	value: TargetOutputsConfig["subagents"] | undefined,
): SubagentOutputConfig | null {
	if (!value) {
		return null;
	}
	if (typeof value === "string" || typeof value === "function") {
		return { path: value };
	}
	return value as SubagentOutputConfig;
}

export function resolveCommandOutputConfig(
	value: TargetOutputsConfig["commands"] | undefined,
): CommandOutputConfig | null {
	if (!value) {
		return null;
	}
	if (typeof value === "string" || typeof value === "function") {
		return { path: value };
	}
	return value as CommandOutputConfig;
}

export function resolveInstructionOutputConfig(
	value: TargetOutputsConfig["instructions"] | undefined,
): InstructionOutputConfig | null | false {
	if (value === undefined) {
		return null;
	}
	if (value === false) {
		return false;
	}
	if (typeof value === "string" || typeof value === "function") {
		return { fileName: value };
	}
	return value as InstructionOutputConfig;
}

export async function resolveCommandFormat(options: {
	config: CommandOutputConfig;
	item: { name: string };
	context: ConvertContext;
}): Promise<CommandFormat> {
	const resolved = await resolveConfigValue({
		value: options.config.format,
		item: options.item,
		context: options.context,
		fallback: "markdown",
	});
	return (resolved ?? "markdown") as CommandFormat;
}

export async function resolveCommandScopes(options: {
	config: CommandOutputConfig;
	item: { name: string };
	context: ConvertContext;
}): Promise<CommandScope[]> {
	const resolved = await resolveConfigValue({
		value: options.config.scopes,
		item: options.item,
		context: options.context,
		fallback: "project",
	});
	if (!resolved) {
		return ["project"];
	}
	if (Array.isArray(resolved)) {
		return resolved as CommandScope[];
	}
	return [resolved as CommandScope];
}

export async function resolveCommandFallback(options: {
	config: CommandOutputConfig;
	item: { name: string };
	context: ConvertContext;
}): Promise<CommandFallback> {
	const resolved = await resolveConfigValue({
		value: options.config.fallback,
		item: options.item,
		context: options.context,
		fallback: "skip",
	});
	return (resolved ?? "skip") as CommandFallback;
}
