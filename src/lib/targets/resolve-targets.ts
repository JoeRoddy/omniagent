import { BUILTIN_TARGETS } from "./builtins.js";
import type {
	OmniagentConfig,
	ResolvedTarget,
	TargetCliDefinition,
	TargetDefinition,
	TargetOutputs,
} from "./config-types.js";

function normalizeKey(value: string): string {
	return value.trim().toLowerCase();
}

function cloneOutputs(outputs: TargetOutputs | undefined): TargetOutputs {
	return outputs ? { ...outputs } : {};
}

function cloneCli(cli: TargetCliDefinition | undefined): TargetCliDefinition | undefined {
	return cli ? { ...cli } : undefined;
}

function mergeOutputs(
	base: TargetOutputs | undefined,
	override: TargetOutputs | undefined,
): TargetOutputs {
	const merged: TargetOutputs = { ...cloneOutputs(base) };
	if (!override) {
		return merged;
	}
	if ("skills" in override) {
		merged.skills = override.skills;
	}
	if ("commands" in override) {
		merged.commands = override.commands;
	}
	if ("subagents" in override) {
		merged.subagents = override.subagents;
	}
	if ("instructions" in override) {
		merged.instructions = override.instructions;
	}
	return merged;
}

function resolveInheritTarget(
	builtIns: TargetDefinition[],
	inherits: string,
): TargetDefinition | null {
	const key = normalizeKey(inherits);
	const found = builtIns.find((target) => normalizeKey(target.id) === key);
	return found ?? null;
}

type TargetConfigSource = "builtin" | "custom" | "override" | "inherits";

export type ResolvedTargetsResult = {
	targets: ResolvedTarget[];
	aliasToId: Map<string, string>;
	byId: Map<string, ResolvedTarget>;
	configSourceById: Map<string, TargetConfigSource>;
	disabledTargets: string[];
};

export function resolveTargets(options: {
	config: OmniagentConfig | null;
	builtIns?: TargetDefinition[];
}): ResolvedTargetsResult {
	const builtIns = options.builtIns ?? BUILTIN_TARGETS;
	const builtInMap = new Map<string, TargetDefinition>();
	for (const target of builtIns) {
		builtInMap.set(normalizeKey(target.id), target);
	}

	const disabledTargets: string[] = [];
	const disableSet = new Set<string>();
	if (options.config?.disableTargets) {
		for (const entry of options.config.disableTargets) {
			const key = normalizeKey(entry);
			disableSet.add(key);
			disabledTargets.push(entry);
		}
	}

	const customTargets = options.config?.targets ?? [];

	const resolvedTargets: ResolvedTarget[] = [];
	const configSourceById = new Map<string, TargetConfigSource>();

	for (const builtIn of builtIns) {
		const idKey = normalizeKey(builtIn.id);
		if (disableSet.has(idKey)) {
			continue;
		}
		const customTarget = customTargets.find((target) => normalizeKey(target.id) === idKey);
		if (!customTarget) {
			resolvedTargets.push({
				id: builtIn.id,
				displayName: builtIn.displayName ?? builtIn.id,
				aliases: builtIn.aliases ?? [],
				outputs: cloneOutputs(builtIn.outputs),
				cli: cloneCli(builtIn.cli),
				hooks: builtIn.hooks,
				isBuiltIn: true,
				isCustomized: false,
			});
			configSourceById.set(idKey, "builtin");
			continue;
		}
		if (customTarget.inherits) {
			const inherited =
				resolveInheritTarget(builtIns, customTarget.inherits) ??
				resolveInheritTarget(builtIns, builtIn.id);
			const mergedOutputs = mergeOutputs(inherited?.outputs, customTarget.outputs);
			resolvedTargets.push({
				id: customTarget.id,
				displayName: customTarget.displayName ?? inherited?.displayName ?? customTarget.id,
				aliases: customTarget.aliases ?? inherited?.aliases ?? [],
				outputs: mergedOutputs,
				cli: customTarget.cli ?? inherited?.cli,
				hooks: customTarget.hooks ?? inherited?.hooks,
				isBuiltIn: true,
				isCustomized: true,
			});
			configSourceById.set(idKey, "inherits");
		} else {
			resolvedTargets.push({
				id: customTarget.id,
				displayName: customTarget.displayName ?? customTarget.id,
				aliases: customTarget.aliases ?? [],
				outputs: cloneOutputs(customTarget.outputs),
				cli: cloneCli(customTarget.cli),
				hooks: customTarget.hooks,
				isBuiltIn: true,
				isCustomized: true,
			});
			configSourceById.set(idKey, "override");
		}
	}

	for (const target of customTargets) {
		const idKey = normalizeKey(target.id);
		if (builtInMap.has(idKey)) {
			continue;
		}
		const inherited = target.inherits ? resolveInheritTarget(builtIns, target.inherits) : null;
		const mergedOutputs = inherited
			? mergeOutputs(inherited.outputs, target.outputs)
			: cloneOutputs(target.outputs);
		resolvedTargets.push({
			id: target.id,
			displayName: target.displayName ?? inherited?.displayName ?? target.id,
			aliases: target.aliases ?? inherited?.aliases ?? [],
			outputs: mergedOutputs,
			cli: target.cli ?? inherited?.cli,
			hooks: target.hooks ?? inherited?.hooks,
			isBuiltIn: false,
			isCustomized: true,
		});
		configSourceById.set(idKey, target.inherits ? "inherits" : "custom");
	}

	const aliasToId = new Map<string, string>();
	const byId = new Map<string, ResolvedTarget>();
	for (const target of resolvedTargets) {
		const idKey = normalizeKey(target.id);
		byId.set(idKey, target);
		aliasToId.set(idKey, target.id);
		for (const alias of target.aliases ?? []) {
			aliasToId.set(normalizeKey(alias), target.id);
		}
	}

	return {
		targets: resolvedTargets,
		aliasToId,
		byId,
		configSourceById,
		disabledTargets,
	};
}
