import {
	isValidVariableName,
	PROFILE_CATEGORIES,
	type Profile,
	type ProfileCategory,
	type ProfileValidationIssue,
	type ProfileValidationResult,
} from "./types.js";

const ALLOWED_TOP_LEVEL_KEYS = new Set([
	"$schema",
	"description",
	"extends",
	"targets",
	"enable",
	"disable",
	"variables",
]);
const ALLOWED_CATEGORY_KEYS = new Set<ProfileCategory>(PROFILE_CATEGORIES);
const ALLOWED_TARGET_SETTING_KEYS = new Set(["enabled"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function pushError(errors: ProfileValidationIssue[], path: string, message: string): void {
	errors.push({ path, message });
}

function validatePatternMap(
	value: unknown,
	pathPrefix: string,
	errors: ProfileValidationIssue[],
): void {
	if (!isPlainObject(value)) {
		pushError(errors, pathPrefix, "must be an object.");
		return;
	}
	for (const [key, entry] of Object.entries(value)) {
		if (!ALLOWED_CATEGORY_KEYS.has(key as ProfileCategory)) {
			pushError(
				errors,
				`${pathPrefix}.${key}`,
				`unsupported category (allowed: ${[...ALLOWED_CATEGORY_KEYS].join(", ")}).`,
			);
			continue;
		}
		if (!Array.isArray(entry)) {
			pushError(errors, `${pathPrefix}.${key}`, "must be an array of glob patterns.");
			continue;
		}
		for (const [index, pattern] of entry.entries()) {
			if (typeof pattern !== "string" || pattern.trim().length === 0) {
				pushError(errors, `${pathPrefix}.${key}[${index}]`, "must be a non-empty string.");
			}
		}
	}
}

function validateTargets(value: unknown, errors: ProfileValidationIssue[]): void {
	if (!isPlainObject(value)) {
		pushError(errors, "targets", "must be an object.");
		return;
	}
	for (const [targetName, setting] of Object.entries(value)) {
		if (typeof targetName !== "string" || targetName.trim().length === 0) {
			pushError(errors, "targets", `target keys must be non-empty strings (got "${targetName}").`);
			continue;
		}
		if (!isPlainObject(setting)) {
			pushError(errors, `targets.${targetName}`, "must be an object.");
			continue;
		}
		for (const key of Object.keys(setting)) {
			if (!ALLOWED_TARGET_SETTING_KEYS.has(key)) {
				pushError(errors, `targets.${targetName}.${key}`, "unsupported key (allowed: enabled).");
			}
		}
		if (setting.enabled !== undefined && typeof setting.enabled !== "boolean") {
			pushError(errors, `targets.${targetName}.enabled`, "must be a boolean when provided.");
		}
	}
}

export function validateProfile(value: unknown): ProfileValidationResult {
	const errors: ProfileValidationIssue[] = [];
	if (!isPlainObject(value)) {
		return {
			valid: false,
			errors: [{ path: "", message: "profile must be a JSON object." }],
		};
	}
	for (const key of Object.keys(value)) {
		if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
			pushError(
				errors,
				key,
				"unsupported key (allowed: $schema, description, extends, targets, enable, disable).",
			);
		}
	}
	if (value.$schema !== undefined && typeof value.$schema !== "string") {
		pushError(errors, "$schema", "must be a string when provided.");
	}
	if (value.description !== undefined) {
		if (typeof value.description !== "string") {
			pushError(errors, "description", "must be a string when provided.");
		}
	}
	if (value.extends !== undefined) {
		if (typeof value.extends !== "string" || value.extends.trim().length === 0) {
			pushError(errors, "extends", "must be a non-empty string when provided.");
		}
	}
	if (value.targets !== undefined) {
		validateTargets(value.targets, errors);
	}
	if (value.enable !== undefined) {
		validatePatternMap(value.enable, "enable", errors);
	}
	if (value.disable !== undefined) {
		validatePatternMap(value.disable, "disable", errors);
	}
	if (value.variables !== undefined) {
		validateVariables(value.variables, errors);
	}
	return {
		valid: errors.length === 0,
		errors,
	};
}

function validateVariables(value: unknown, errors: ProfileValidationIssue[]): void {
	if (!isPlainObject(value)) {
		pushError(errors, "variables", "must be an object of string values.");
		return;
	}
	for (const [key, entry] of Object.entries(value)) {
		if (!isValidVariableName(key)) {
			pushError(
				errors,
				`variables.${key}`,
				"variable names must match [A-Z_][A-Z0-9_]* (uppercase ASCII, digits, underscores).",
			);
		}
		if (typeof entry !== "string") {
			pushError(errors, `variables.${key}`, "must be a string.");
		}
	}
}

export function formatValidationIssues(issues: ProfileValidationIssue[]): string[] {
	return issues.map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message));
}

export function assertValidProfile(value: unknown, profileName: string): Profile {
	const result = validateProfile(value);
	if (!result.valid) {
		const formatted = formatValidationIssues(result.errors).join("\n- ");
		throw new Error(`Invalid profile "${profileName}":\n- ${formatted}`);
	}
	return value as Profile;
}
