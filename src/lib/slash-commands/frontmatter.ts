import type { TargetName } from "./targets.js";

export type FrontmatterValue = string | string[];

const FRONTMATTER_MARKER = "---";

function parseScalar(rawValue: string): string {
	const trimmed = rawValue.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		// Unescape YAML double-quoted string escape sequences
		return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
	}
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
		// Single-quoted strings don't process escapes in YAML
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parseFrontmatter(lines: string[]): Record<string, FrontmatterValue> {
	const data: Record<string, FrontmatterValue> = {};
	let currentListKey: string | null = null;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}

		if (currentListKey) {
			const listMatch = trimmed.match(/^-\s+(.+)$/);
			if (listMatch) {
				const value = parseScalar(listMatch[1]);
				const existing = data[currentListKey];
				if (Array.isArray(existing)) {
					existing.push(value);
				} else {
					data[currentListKey] = [value];
				}
				continue;
			}
			currentListKey = null;
		}

		const match = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!match) {
			continue;
		}
		const [, key, rawValue] = match;
		if (!rawValue) {
			currentListKey = key;
			if (!data[key]) {
				data[key] = [];
			}
			continue;
		}
		data[key] = parseScalar(rawValue);
		currentListKey = null;
	}

	return data;
}

export function extractFrontmatter(contents: string): {
	frontmatter: Record<string, FrontmatterValue>;
	body: string;
} {
	const lines = contents.split(/\r?\n/);
	if (lines[0]?.trim() !== FRONTMATTER_MARKER) {
		return { frontmatter: {}, body: contents.trimEnd() };
	}

	let endIndex = -1;
	for (let i = 1; i < lines.length; i += 1) {
		if (lines[i].trim() === FRONTMATTER_MARKER) {
			endIndex = i;
			break;
		}
	}

	if (endIndex === -1) {
		return { frontmatter: {}, body: contents.trimEnd() };
	}

	const frontmatterLines = lines.slice(1, endIndex);
	const bodyLines = lines.slice(endIndex + 1);
	return {
		frontmatter: parseFrontmatter(frontmatterLines),
		body: bodyLines.join("\n").replace(/^\n+/, "").trimEnd(),
	};
}

export function normalizeTargetList(rawTargets?: FrontmatterValue): TargetName[] | null {
	if (!rawTargets) {
		return null;
	}
	const targetList = Array.isArray(rawTargets) ? rawTargets : [rawTargets];
	if (targetList.length === 0) {
		return null;
	}
	const normalized = targetList
		.map((value) => value.trim())
		.filter(Boolean)
		.map((value) => value.toLowerCase());
	if (normalized.length === 0) {
		return null;
	}
	return normalized as TargetName[];
}
