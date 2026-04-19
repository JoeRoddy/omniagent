import type { ProfileVariables } from "./types.js";

// Mustache-style placeholder: `{{NAME}}` or `{{NAME=default value}}`.
// NAME is uppercase ASCII/digits/underscore, may have surrounding whitespace.
// Default value runs until the closing braces and may contain spaces.
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Z_][A-Z0-9_]*)\s*(?:=([^}]*))?\}\}/g;

export type VariableSubstitutionIssue = {
	name: string;
};

export type VariableSubstitutionResult = {
	content: string;
	unresolved: VariableSubstitutionIssue[];
};

// Substitute `{{VAR}}` placeholders in `content` using `variables`. Falls back
// to an inline `{{VAR=default}}` when the variable is unset. Unresolved bare
// placeholders are left literal and reported in `unresolved` so the caller
// can surface them as warnings.
export function substituteVariables(
	content: string,
	variables: ProfileVariables | null | undefined,
): VariableSubstitutionResult {
	const unresolved: VariableSubstitutionIssue[] = [];
	const vars = variables ?? {};
	const reported = new Set<string>();

	const substituted = content.replace(
		PLACEHOLDER_PATTERN,
		(match, name: string, defaultValue?: string) => {
			if (Object.hasOwn(vars, name)) {
				return vars[name];
			}
			if (defaultValue !== undefined) {
				return defaultValue;
			}
			if (!reported.has(name)) {
				reported.add(name);
				unresolved.push({ name });
			}
			return match;
		},
	);

	return { content: substituted, unresolved };
}

// Returns true when `content` has at least one variable placeholder.
export function hasVariablePlaceholders(content: string): boolean {
	PLACEHOLDER_PATTERN.lastIndex = 0;
	return PLACEHOLDER_PATTERN.test(content);
}
