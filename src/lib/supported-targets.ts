import type { ResolvedTarget } from "./targets/config-types.js";

export function buildSupportedAgentNames(targets: ResolvedTarget[]): string[] {
	const names = new Set<string>();
	for (const target of targets) {
		names.add(target.id);
		for (const alias of target.aliases ?? []) {
			names.add(alias);
		}
	}
	return Array.from(names);
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
