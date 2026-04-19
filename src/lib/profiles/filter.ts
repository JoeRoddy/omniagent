import { PROFILE_CATEGORIES, type ProfileCategory, type ResolvedProfile } from "./types.js";

function isBareName(pattern: string): boolean {
	return !pattern.includes("*") && !pattern.includes("?");
}

function globToRegExp(pattern: string): RegExp {
	let regex = "^";
	for (let i = 0; i < pattern.length; i += 1) {
		const char = pattern[i];
		if (char === "*") {
			regex += "[^/]*";
			continue;
		}
		if (char === "?") {
			regex += "[^/]";
			continue;
		}
		regex += char.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&");
	}
	regex += "$";
	return new RegExp(regex);
}

type CompiledPattern = {
	raw: string;
	regex: RegExp;
	bare: boolean;
	matched: boolean;
};

function compilePatterns(list: string[] | undefined): CompiledPattern[] {
	if (!list || list.length === 0) {
		return [];
	}
	return list.map((raw) => ({
		raw,
		regex: globToRegExp(raw),
		bare: isBareName(raw),
		matched: false,
	}));
}

function matchAny(name: string, patterns: CompiledPattern[]): boolean {
	let matched = false;
	for (const pattern of patterns) {
		if (pattern.regex.test(name)) {
			pattern.matched = true;
			matched = true;
		}
	}
	return matched;
}

export type ProfileItemFilter = {
	enabled: boolean;
	includes(category: ProfileCategory, canonicalName: string): boolean;
	collectUnknownWarnings(): string[];
};

/**
 * Build a predicate that applies a ResolvedProfile's enable/disable rules to
 * canonical item names. When no rules target a given category, every name
 * passes through.
 */
export function createProfileItemFilter(resolved: ResolvedProfile | null): ProfileItemFilter {
	if (!resolved || resolved.names.length === 0) {
		return {
			enabled: false,
			includes: () => true,
			collectUnknownWarnings: () => [],
		};
	}

	const enablePatternsByCategory = new Map<ProfileCategory, CompiledPattern[]>();
	const disablePatternsByCategory = new Map<ProfileCategory, CompiledPattern[]>();

	for (const category of PROFILE_CATEGORIES) {
		enablePatternsByCategory.set(category, compilePatterns(resolved.enable[category]));
		disablePatternsByCategory.set(category, compilePatterns(resolved.disable[category]));
	}

	return {
		enabled: true,
		includes(category, canonicalName) {
			const enablePatterns = enablePatternsByCategory.get(category) ?? [];
			const disablePatterns = disablePatternsByCategory.get(category) ?? [];
			const enableApplies = enablePatterns.length > 0;
			if (enableApplies && !matchAny(canonicalName, enablePatterns)) {
				return false;
			}
			if (matchAny(canonicalName, disablePatterns)) {
				return false;
			}
			// Also record matches against empty filters so zero-match bare names can warn.
			if (!enableApplies) {
				// still call matchAny so patterns (if any) track state; harmless when empty.
			}
			return true;
		},
		collectUnknownWarnings() {
			const warnings: string[] = [];
			for (const category of PROFILE_CATEGORIES) {
				const enablePatterns = enablePatternsByCategory.get(category) ?? [];
				for (const pattern of enablePatterns) {
					if (pattern.bare && !pattern.matched) {
						warnings.push(
							`profile ${formatProfileLabel(resolved.names)} references unknown ${singular(category)} "${pattern.raw}"`,
						);
					}
				}
				const disablePatterns = disablePatternsByCategory.get(category) ?? [];
				for (const pattern of disablePatterns) {
					if (pattern.bare && !pattern.matched) {
						warnings.push(
							`profile ${formatProfileLabel(resolved.names)} references unknown ${singular(category)} "${pattern.raw}"`,
						);
					}
				}
			}
			return warnings;
		},
	};
}

function singular(category: ProfileCategory): string {
	switch (category) {
		case "skills":
			return "skill";
		case "subagents":
			return "subagent";
		case "commands":
			return "command";
	}
}

function formatProfileLabel(names: string[]): string {
	if (names.length === 1) {
		return `"${names[0]}"`;
	}
	return `[${names.map((name) => `"${name}"`).join(", ")}]`;
}

export function targetEnabledByProfile(
	resolved: ResolvedProfile | null,
	targetId: string,
	targetAliases: readonly string[] = [],
): boolean {
	if (!resolved || resolved.names.length === 0) {
		return true;
	}
	const candidates = [targetId, ...targetAliases].map((v) => v.toLowerCase());
	for (const [key, setting] of Object.entries(resolved.targets)) {
		if (!candidates.includes(key.toLowerCase())) {
			continue;
		}
		if (setting.enabled === false) {
			return false;
		}
	}
	return true;
}
