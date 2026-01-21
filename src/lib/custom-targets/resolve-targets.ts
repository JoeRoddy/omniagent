import path from "node:path";
import { resolveInstructionFileName } from "../instructions/targets.js";
import { SLASH_COMMAND_TARGETS } from "../slash-commands/targets.js";
import { SUBAGENT_TARGETS } from "../subagents/targets.js";
import { TARGETS } from "../sync-targets.js";
import type {
	CommandOutputConfig,
	InstructionOutputConfig,
	OmniagentConfig,
	ResolvedTargetDefinition,
	ResolvedTargetOutputs,
	SkillOutputConfig,
	SubagentOutputConfig,
	TargetDefinition,
	TargetOutputsConfig,
} from "./types.js";

export type TargetRegistry = {
	builtIns: ResolvedTargetDefinition[];
	resolved: ResolvedTargetDefinition[];
	overriddenIds: Set<string>;
	disabledIds: Set<string>;
	byId: Map<string, ResolvedTargetDefinition>;
};

const BUILT_IN_ORDER = TARGETS.map((target) => target.name);
const BUILT_IN_DISPLAY: Record<string, string> = Object.fromEntries(
	SLASH_COMMAND_TARGETS.map((target) => [target.name, target.displayName]),
);
const BUILT_IN_COMMANDS: Record<string, CommandOutputConfig | null> = Object.fromEntries(
	SLASH_COMMAND_TARGETS.map((target) => {
		const repoPath = path.join("{repo}", `.${target.name}`, "commands");
		const pathValue = target.name === "codex" ? "{home}/.codex/prompts" : repoPath;
		const supportsCommands = target.supportsSlashCommands;
		const config: CommandOutputConfig = {
			path: pathValue,
			format: target.fileFormat,
			fallback: supportsCommands ? undefined : "skills",
		};
		if (target.name === "codex") {
			config.scopes = "global";
		}
		return [target.name, supportsCommands ? config : config];
	}),
);
const BUILT_IN_SUBAGENTS: Record<string, SubagentOutputConfig | null> = Object.fromEntries(
	SUBAGENT_TARGETS.map((target) => {
		if (!target.supportsSubagents || !target.subagentPath) {
			return [target.name, null];
		}
		return [
			target.name,
			{
				path: path.join("{repo}", target.subagentPath),
			},
		];
	}),
);

const BUILT_IN_SKILLS: Record<string, SkillOutputConfig> = Object.fromEntries(
	TARGETS.map((target) => [
		target.name,
		{
			path: path.join("{repo}", target.relativePath),
		},
	]),
);

const BUILT_IN_INSTRUCTIONS: Record<string, InstructionOutputConfig> = Object.fromEntries(
	TARGETS.map((target) => [
		target.name,
		{
			fileName: resolveInstructionFileName(target.name),
		},
	]),
);

function normalizeString(value: string): string {
	return value.trim().toLowerCase();
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
	const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
	return Object.fromEntries(entries) as T;
}

function normalizeSkillOutput(
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

function normalizeCommandOutput(
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

function normalizeSubagentOutput(
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

function normalizeInstructionOutput(
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

function mergeOutputConfigs(
	base: ResolvedTargetOutputs,
	override?: TargetOutputsConfig,
): ResolvedTargetOutputs {
	if (!override) {
		return base;
	}
	const merged: ResolvedTargetOutputs = { ...base };
	if ("skills" in override) {
		const overrideValue = normalizeSkillOutput(override.skills);
		merged.skills = base.skills ? { ...base.skills, ...stripUndefined(overrideValue ?? {}) } : overrideValue;
	}
	if ("commands" in override) {
		const overrideValue = normalizeCommandOutput(override.commands);
		merged.commands = base.commands
			? { ...base.commands, ...stripUndefined(overrideValue ?? {}) }
			: overrideValue;
	}
	if ("subagents" in override) {
		const overrideValue = normalizeSubagentOutput(override.subagents);
		merged.subagents = base.subagents
			? { ...base.subagents, ...stripUndefined(overrideValue ?? {}) }
			: overrideValue;
	}
	if ("instructions" in override) {
		const overrideValue = normalizeInstructionOutput(override.instructions);
		if (overrideValue === false) {
			merged.instructions = false;
		} else if (overrideValue === null) {
			merged.instructions = base.instructions ?? null;
		} else {
			const baseValue = base.instructions && base.instructions !== false ? base.instructions : null;
			merged.instructions = baseValue
				? { ...baseValue, ...stripUndefined(overrideValue ?? {}) }
				: overrideValue;
		}
	}
	return merged;
}

function defaultDisplayName(id: string): string {
	if (!id) {
		return id;
	}
	return id.charAt(0).toUpperCase() + id.slice(1);
}

function buildBuiltInTargets(): ResolvedTargetDefinition[] {
	return BUILT_IN_ORDER.map((id) => {
		const displayName = BUILT_IN_DISPLAY[id] ?? defaultDisplayName(id);
		const commandsProfile = SLASH_COMMAND_TARGETS.find((target) => target.name === id);
		const subagentProfile = SUBAGENT_TARGETS.find((target) => target.name === id);
		return {
			id,
			displayName,
			aliases: [],
			source: "built-in",
			outputs: {
				skills: BUILT_IN_SKILLS[id] ?? null,
				commands: BUILT_IN_COMMANDS[id] ?? null,
				subagents: BUILT_IN_SUBAGENTS[id] ?? null,
				instructions: BUILT_IN_INSTRUCTIONS[id] ?? null,
			},
			hooks: {},
			supports: {
				commands: commandsProfile?.supportsSlashCommands ?? false,
				subagents: subagentProfile?.supportsSubagents ?? false,
			},
		};
	});
}

function resolveMergedTarget(options: {
	base: ResolvedTargetDefinition | null;
	config: TargetDefinition;
	source: "override" | "custom";
}): ResolvedTargetDefinition {
	const base = options.base;
	const id = options.config.id;
	const displayName = options.config.displayName ?? base?.displayName ?? defaultDisplayName(id);
	const aliases = options.config.aliases ?? base?.aliases ?? [];
	const outputs = mergeOutputConfigs(base?.outputs ?? {}, options.config.outputs);
	const hooks = { ...base?.hooks, ...options.config.hooks };
	const supports = base
		? { commands: base.supports.commands, subagents: base.supports.subagents }
		: { commands: Boolean(outputs.commands), subagents: Boolean(outputs.subagents) };
	return {
		id,
		displayName,
		aliases,
		source: options.source,
		outputs,
		hooks,
		supports,
	};
}

export function resolveTargets(config: OmniagentConfig | null): TargetRegistry {
	const builtIns = buildBuiltInTargets();
	const builtInById = new Map(
		builtIns.map((target) => [normalizeString(target.id), target]),
	);

	const overriddenIds = new Set<string>();
	const disabledIds = new Set<string>();

	const targets = Array.isArray(config?.targets) ? config?.targets ?? [] : [];
	const disabledTargets = Array.isArray(config?.disabledTargets)
		? config?.disabledTargets ?? []
		: [];
	for (const entry of disabledTargets) {
		if (typeof entry === "string" && entry.trim()) {
			disabledIds.add(normalizeString(entry));
		}
	}
	for (const target of targets) {
		if (target && typeof target.id === "string" && target.disabled) {
			disabledIds.add(normalizeString(target.id));
		}
	}

	const overrides = new Map<string, TargetDefinition>();
	const custom: TargetDefinition[] = [];
	for (const target of targets) {
		if (!target || typeof target.id !== "string") {
			continue;
		}
		const normalized = normalizeString(target.id);
		if (builtInById.has(normalized)) {
			overrides.set(normalized, target);
			overriddenIds.add(normalized);
			continue;
		}
		custom.push(target);
	}

	const resolved: ResolvedTargetDefinition[] = [];
	for (const base of builtIns) {
		const normalized = normalizeString(base.id);
		if (disabledIds.has(normalized)) {
			continue;
		}
		const override = overrides.get(normalized);
		if (override) {
			resolved.push(
				resolveMergedTarget({ base, config: override, source: "override" }),
			);
		} else {
			resolved.push(base);
		}
	}

	for (const target of custom) {
		const normalized = normalizeString(target.id);
		if (disabledIds.has(normalized)) {
			continue;
		}
		const base = target.extends
			? builtInById.get(normalizeString(target.extends)) ?? null
			: null;
		resolved.push(resolveMergedTarget({ base, config: target, source: "custom" }));
	}

	const byId = new Map<string, ResolvedTargetDefinition>();
	for (const target of resolved) {
		byId.set(normalizeString(target.id), target);
	}

	return {
		builtIns,
		resolved,
		overriddenIds,
		disabledIds,
		byId,
	};
}
