import { BUILTIN_TARGETS } from "./targets/builtins.js";
import type { ResolvedTarget } from "./targets/config-types.js";

export const SUPPORTED_AGENT_NAMES = Object.freeze(BUILTIN_TARGETS.map((target) => target.id));

export function buildSupportedAgentNames(targets: ResolvedTarget[]): string[] {
	const ordered: string[] = [];
	const seen = new Set<string>();
	const add = (value: string) => {
		const trimmed = value.trim();
		if (!trimmed || seen.has(trimmed)) {
			return;
		}
		seen.add(trimmed);
		ordered.push(trimmed);
	};

	for (const target of targets) {
		add(target.id);
		for (const alias of target.aliases ?? []) {
			add(alias);
		}
	}

	const remaining = new Set(ordered);
	const result: string[] = [];
	for (const name of SUPPORTED_AGENT_NAMES) {
		if (remaining.has(name)) {
			result.push(name);
			remaining.delete(name);
		}
	}
	for (const name of ordered) {
		if (remaining.has(name)) {
			result.push(name);
			remaining.delete(name);
		}
	}
	return result;
}

export function buildSupportedTargetLabel(targets: ResolvedTarget[]): string {
	return targets
		.map((target) =>
			target.displayName && target.displayName !== target.id
				? `${target.id} (${target.displayName})`
				: target.id,
		)
		.join(", ");
}
