import type { OmniagentConfig } from "./types.js";

export type ConfigValidationError = {
	message: string;
	path?: string;
};

export type ConfigValidationResult = {
	valid: boolean;
	errors: ConfigValidationError[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordError(errors: ConfigValidationError[], message: string, path?: string): void {
	errors.push({ message, path });
}

function validateString(
	errors: ConfigValidationError[],
	value: unknown,
	path: string,
	options?: { required?: boolean },
): value is string {
	if (value === undefined || value === null) {
		if (options?.required) {
			recordError(errors, "Value is required.", path);
			return false;
		}
		return false;
	}
	if (typeof value !== "string") {
		recordError(errors, "Value must be a string.", path);
		return false;
	}
	if (!value.trim()) {
		recordError(errors, "Value cannot be empty.", path);
		return false;
	}
	return true;
}

function validateStringArray(
	errors: ConfigValidationError[],
	value: unknown,
	path: string,
): value is string[] {
	if (value === undefined || value === null) {
		return false;
	}
	if (!Array.isArray(value)) {
		recordError(errors, "Value must be an array of strings.", path);
		return false;
	}
	let valid = true;
	value.forEach((entry, index) => {
		if (typeof entry !== "string" || !entry.trim()) {
			valid = false;
			recordError(errors, "Entry must be a non-empty string.", `${path}[${index}]`);
		}
	});
	return valid;
}

function validatePathLike(errors: ConfigValidationError[], value: unknown, path: string): boolean {
	if (typeof value === "string") {
		if (!value.trim()) {
			recordError(errors, "Value cannot be empty.", path);
			return false;
		}
		return true;
	}
	if (typeof value === "function") {
		return true;
	}
	recordError(errors, "Value must be a string or function.", path);
	return false;
}

function validateConverter(errors: ConfigValidationError[], value: unknown, path: string): boolean {
	if (value === undefined) {
		return true;
	}
	if (typeof value !== "function") {
		recordError(errors, "Converter must be a function.", path);
		return false;
	}
	return true;
}

function validateSkillOutput(errors: ConfigValidationError[], value: unknown, path: string): void {
	if (typeof value === "string" || typeof value === "function") {
		validatePathLike(errors, value, path);
		return;
	}
	if (!isRecord(value)) {
		recordError(errors, "Value must be a string, function, or object.", path);
		return;
	}
	validatePathLike(errors, value.path, `${path}.path`);
	validateConverter(errors, value.convert, `${path}.convert`);
}

function validateSubagentOutput(
	errors: ConfigValidationError[],
	value: unknown,
	path: string,
): void {
	validateSkillOutput(errors, value, path);
}

function validateCommandOutput(
	errors: ConfigValidationError[],
	value: unknown,
	path: string,
): void {
	if (typeof value === "string" || typeof value === "function") {
		validatePathLike(errors, value, path);
		return;
	}
	if (!isRecord(value)) {
		recordError(errors, "Value must be a string, function, or object.", path);
		return;
	}
	validatePathLike(errors, value.path, `${path}.path`);
	if (value.format !== undefined) {
		if (typeof value.format !== "string" && typeof value.format !== "function") {
			recordError(errors, "Format must be a string or function.", `${path}.format`);
		} else if (typeof value.format === "string") {
			const normalized = value.format.toLowerCase();
			if (normalized !== "markdown" && normalized !== "toml") {
				recordError(errors, 'Format must be "markdown" or "toml".', `${path}.format`);
			}
		}
	}
	if (value.scopes !== undefined) {
		if (typeof value.scopes === "string") {
			const normalized = value.scopes.toLowerCase();
			if (normalized !== "project" && normalized !== "global") {
				recordError(errors, 'Scope must be "project" or "global".', `${path}.scopes`);
			}
		} else if (Array.isArray(value.scopes)) {
			value.scopes.forEach((scope, index) => {
				if (typeof scope !== "string") {
					recordError(errors, "Scope must be a string.", `${path}.scopes[${index}]`);
					return;
				}
				const normalized = scope.toLowerCase();
				if (normalized !== "project" && normalized !== "global") {
					recordError(errors, 'Scope must be "project" or "global".', `${path}.scopes[${index}]`);
				}
			});
		} else if (typeof value.scopes !== "function") {
			recordError(errors, "Scopes must be a string, array, or function.", `${path}.scopes`);
		}
	}
	if (value.globalPath !== undefined) {
		validatePathLike(errors, value.globalPath, `${path}.globalPath`);
	}
	if (value.fallback !== undefined) {
		if (typeof value.fallback !== "string" && typeof value.fallback !== "function") {
			recordError(errors, "Fallback must be a string or function.", `${path}.fallback`);
		} else if (typeof value.fallback === "string") {
			const normalized = value.fallback.toLowerCase();
			if (normalized !== "skills" && normalized !== "skip") {
				recordError(errors, 'Fallback must be "skills" or "skip".', `${path}.fallback`);
			}
		}
	}
	validateConverter(errors, value.convert, `${path}.convert`);
}

function validateInstructionOutput(
	errors: ConfigValidationError[],
	value: unknown,
	path: string,
): void {
	if (value === false) {
		return;
	}
	if (typeof value === "string" || typeof value === "function") {
		validatePathLike(errors, value, path);
		return;
	}
	if (!isRecord(value)) {
		recordError(errors, "Value must be a string, function, object, or false.", path);
		return;
	}
	if (value.fileName !== undefined) {
		validatePathLike(errors, value.fileName, `${path}.fileName`);
	}
	if (value.group !== undefined) {
		if (typeof value.group !== "string" && typeof value.group !== "function") {
			recordError(errors, "Group must be a string or function.", `${path}.group`);
		} else if (typeof value.group === "string" && !value.group.trim()) {
			recordError(errors, "Group cannot be empty.", `${path}.group`);
		}
	}
	validateConverter(errors, value.convert, `${path}.convert`);
}

export function validateConfig(
	config: OmniagentConfig,
	options?: { builtInTargetIds?: string[] },
): ConfigValidationResult {
	const errors: ConfigValidationError[] = [];
	if (!config || typeof config !== "object") {
		recordError(errors, "Config must be an object.");
		return { valid: false, errors };
	}

	if (config.targets !== undefined && !Array.isArray(config.targets)) {
		recordError(errors, "targets must be an array.", "targets");
	}

	if (config.disabledTargets !== undefined) {
		validateStringArray(errors, config.disabledTargets, "disabledTargets");
	}

	const seenTargets = new Set<string>();
	const targets = Array.isArray(config.targets) ? config.targets : [];

	targets.forEach((target, index) => {
		const rawId = typeof target?.id === "string" ? target.id.trim() : "";
		const basePath = rawId ? `targets[${index}:${rawId}]` : `targets[${index}]`;
		if (!isRecord(target)) {
			recordError(errors, "Target must be an object.", basePath);
			return;
		}
		if (!validateString(errors, target.id, `${basePath}.id`, { required: true })) {
			return;
		}
		const normalizedId = target.id.trim().toLowerCase();
		if (seenTargets.has(normalizedId)) {
			recordError(errors, "Target id must be unique.", `${basePath}.id`);
		} else {
			seenTargets.add(normalizedId);
		}
		if (target.displayName !== undefined) {
			validateString(errors, target.displayName, `${basePath}.displayName`);
		}
		if (target.aliases !== undefined) {
			validateStringArray(errors, target.aliases, `${basePath}.aliases`);
		}
		if (target.extends !== undefined) {
			if (validateString(errors, target.extends, `${basePath}.extends`)) {
				const builtIns = options?.builtInTargetIds ?? [];
				if (builtIns.length > 0) {
					const normalized = target.extends.trim().toLowerCase();
					const known = builtIns.some((entry) => entry.toLowerCase() === normalized);
					if (!known) {
						recordError(
							errors,
							"extends must reference a built-in target id.",
							`${basePath}.extends`,
						);
					}
				}
			}
		}
		if (target.disabled !== undefined && typeof target.disabled !== "boolean") {
			recordError(errors, "disabled must be a boolean.", `${basePath}.disabled`);
		}
		if (target.outputs !== undefined) {
			if (!isRecord(target.outputs)) {
				recordError(errors, "outputs must be an object.", `${basePath}.outputs`);
			} else {
				if (target.outputs.skills !== undefined) {
					validateSkillOutput(errors, target.outputs.skills, `${basePath}.outputs.skills`);
				}
				if (target.outputs.commands !== undefined) {
					validateCommandOutput(errors, target.outputs.commands, `${basePath}.outputs.commands`);
				}
				if (target.outputs.subagents !== undefined) {
					validateSubagentOutput(errors, target.outputs.subagents, `${basePath}.outputs.subagents`);
				}
				if (target.outputs.instructions !== undefined) {
					validateInstructionOutput(
						errors,
						target.outputs.instructions,
						`${basePath}.outputs.instructions`,
					);
				}
			}
		}
		if (target.hooks !== undefined) {
			if (!isRecord(target.hooks)) {
				recordError(errors, "hooks must be an object.", `${basePath}.hooks`);
			} else {
				for (const [hookKey, hookValue] of Object.entries(target.hooks)) {
					if (hookValue !== undefined && typeof hookValue !== "function") {
						recordError(errors, "Hook must be a function.", `${basePath}.hooks.${hookKey}`);
					}
				}
			}
		}
	});

	return { valid: errors.length === 0, errors };
}
