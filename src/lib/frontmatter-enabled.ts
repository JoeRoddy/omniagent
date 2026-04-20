export type FrontmatterRecord = Record<string, string | string[]>;

export const SYNC_ROUTING_FRONTMATTER_KEYS = new Set(["targets", "targetagents", "enabled"]);

export function resolveFrontmatterEnabledByDefault(options: {
	frontmatter: FrontmatterRecord;
	itemKind: string;
	itemName: string;
	sourcePath: string;
}): boolean {
	const rawEnabled = options.frontmatter.enabled;
	if (rawEnabled === undefined) {
		return true;
	}
	if (Array.isArray(rawEnabled)) {
		throw new Error(
			`${options.itemKind} "${options.itemName}" has invalid enabled value in ${options.sourcePath}. Expected true or false.`,
		);
	}
	const normalized = rawEnabled.trim().toLowerCase();
	if (normalized === "true") {
		return true;
	}
	if (normalized === "false") {
		return false;
	}
	throw new Error(
		`${options.itemKind} "${options.itemName}" has invalid enabled value "${rawEnabled}" in ${options.sourcePath}. Expected true or false.`,
	);
}
