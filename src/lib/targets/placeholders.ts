export const PLACEHOLDER_KEYS = [
	"repoRoot",
	"homeDir",
	"agentsDir",
	"targetId",
	"itemName",
	"commandLocation",
] as const;

export type PlaceholderKey = (typeof PLACEHOLDER_KEYS)[number];

const PLACEHOLDER_SET = new Set<string>(PLACEHOLDER_KEYS);

export const PLACEHOLDER_PATTERN = /\{([A-Za-z0-9_-]+)\}/g;

export function extractPlaceholders(template: string): string[] {
	const found: string[] = [];
	for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
		if (match[1]) {
			found.push(match[1]);
		}
	}
	return found;
}

export function validatePlaceholders(
	template: string,
	allowed: Set<string> = PLACEHOLDER_SET,
): string[] {
	const placeholders = extractPlaceholders(template);
	const unknown = placeholders.filter((key) => !allowed.has(key));
	return Array.from(new Set(unknown));
}

export function resolvePlaceholders(
	template: string,
	values: Record<PlaceholderKey, string | undefined>,
): string {
	return template.replace(PLACEHOLDER_PATTERN, (_raw, key) => {
		if (!PLACEHOLDER_SET.has(key)) {
			throw new Error(`Unknown placeholder {${key}}.`);
		}
		const value = values[key as PlaceholderKey];
		if (!value) {
			throw new Error(`Missing value for placeholder {${key}}.`);
		}
		return value;
	});
}
