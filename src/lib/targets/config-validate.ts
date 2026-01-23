import type {
	CommandOutputDefinition,
	FallbackRule,
	InstructionOutputDefinition,
	OmniagentConfig,
	OutputDefinition,
	OutputTemplateValue,
	TargetDefinition,
	TargetOutputs,
} from "./config-types.js";
import { AGENT_IDS } from "./config-types.js";
import { type PlaceholderKey, validatePlaceholders } from "./placeholders.js";

export type ConfigValidationResult = {
	valid: boolean;
	errors: string[];
	config: OmniagentConfig | null;
};

const COMMON_PLACEHOLDERS = new Set<PlaceholderKey>([
	"repoRoot",
	"homeDir",
	"agentsDir",
	"targetId",
	"itemName",
]);
const COMMAND_PLACEHOLDERS = new Set<PlaceholderKey>([...COMMON_PLACEHOLDERS, "commandLocation"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function validateTemplate(
	value: OutputTemplateValue,
	label: string,
	allowed: Set<PlaceholderKey>,
	errors: string[],
): void {
	if (typeof value === "function") {
		return;
	}
	const template = normalizeString(value);
	if (!template) {
		errors.push(`${label} must be a non-empty string.`);
		return;
	}
	const unknown = validatePlaceholders(template, new Set(allowed));
	if (unknown.length > 0) {
		errors.push(`${label} contains unknown placeholders: ${unknown.join(", ")}.`);
	}
}

function validateFallback(
	fallback: FallbackRule | undefined,
	label: string,
	errors: string[],
): void {
	if (!fallback) {
		return;
	}
	const mode = fallback.mode;
	if (mode !== "skip" && mode !== "convert") {
		errors.push(`${label}.fallback.mode must be "skip" or "convert".`);
		return;
	}
	if (mode === "convert" && !fallback.targetType) {
		errors.push(`${label}.fallback.targetType is required when mode is "convert".`);
	}
}

function validateOutputDefinition(
	output: OutputDefinition | undefined,
	label: string,
	errors: string[],
): void {
	if (!output) {
		return;
	}
	if (typeof output === "string" || typeof output === "function") {
		validateTemplate(output, label, COMMON_PLACEHOLDERS, errors);
		return;
	}
	if (!isPlainObject(output)) {
		errors.push(`${label} must be a string or an object.`);
		return;
	}
	validateTemplate(output.path, `${label}.path`, COMMON_PLACEHOLDERS, errors);
	validateFallback(output.fallback, label, errors);
}

function validateCommandOutputDefinition(
	output: CommandOutputDefinition | undefined,
	label: string,
	errors: string[],
): void {
	if (!output) {
		return;
	}
	if (typeof output === "string" || typeof output === "function") {
		validateTemplate(output, label, COMMAND_PLACEHOLDERS, errors);
		return;
	}
	if (!isPlainObject(output)) {
		errors.push(`${label} must be a string or an object.`);
		return;
	}
	if (!output.projectPath && !output.userPath) {
		errors.push(`${label} must include projectPath or userPath.`);
	}
	if (output.projectPath) {
		validateTemplate(output.projectPath, `${label}.projectPath`, COMMAND_PLACEHOLDERS, errors);
	}
	if (output.userPath) {
		validateTemplate(output.userPath, `${label}.userPath`, COMMAND_PLACEHOLDERS, errors);
	}
	validateFallback(output.fallback, label, errors);
}

function validateInstructionOutputDefinition(
	output: InstructionOutputDefinition | undefined,
	label: string,
	errors: string[],
): void {
	if (!output) {
		return;
	}
	if (typeof output === "string" || typeof output === "function") {
		validateTemplate(output, label, COMMON_PLACEHOLDERS, errors);
		return;
	}
	if (!isPlainObject(output)) {
		errors.push(`${label} must be a string or an object.`);
		return;
	}
	validateTemplate(output.filename, `${label}.filename`, COMMON_PLACEHOLDERS, errors);
	if (output.group !== undefined && normalizeString(output.group) === null) {
		errors.push(`${label}.group must be a non-empty string when provided.`);
	}
}

function validateOutputs(
	outputs: TargetOutputs | undefined,
	label: string,
	errors: string[],
): void {
	if (!outputs) {
		return;
	}
	if (!isPlainObject(outputs)) {
		errors.push(`${label} must be an object.`);
		return;
	}
	validateOutputDefinition(outputs.skills, `${label}.skills`, errors);
	validateCommandOutputDefinition(outputs.commands, `${label}.commands`, errors);
	validateOutputDefinition(outputs.subagents, `${label}.subagents`, errors);
	validateInstructionOutputDefinition(outputs.instructions, `${label}.instructions`, errors);
}

function normalizeLower(value: string): string {
	return value.trim().toLowerCase();
}

export function validateTargetConfig(options: {
	config: OmniagentConfig | null;
	builtIns: TargetDefinition[];
}): ConfigValidationResult {
	const errors: string[] = [];
	const config = options.config;

	if (config === null) {
		return { valid: true, errors, config: null };
	}

	if (!isPlainObject(config)) {
		return {
			valid: false,
			errors: ["Config must export an object."],
			config: null,
		};
	}

	if (config.defaultAgent !== undefined) {
		const normalized = normalizeString(config.defaultAgent);
		if (!normalized) {
			errors.push("defaultAgent must be a non-empty string when provided.");
		} else if (!AGENT_IDS.includes(normalized as (typeof AGENT_IDS)[number])) {
			errors.push(`defaultAgent must be one of: ${AGENT_IDS.join(", ")}.`);
		}
	}

	const builtInIds = new Set(options.builtIns.map((target) => normalizeLower(target.id)));
	const builtInAliasSet = new Set<string>();
	for (const target of options.builtIns) {
		for (const alias of target.aliases ?? []) {
			builtInAliasSet.add(normalizeLower(alias));
		}
	}

	const seenIds = new Set<string>();
	const seenAliases = new Set<string>();
	const overrideIds = new Set<string>();

	if (config.disableTargets !== undefined) {
		if (!Array.isArray(config.disableTargets)) {
			errors.push("disableTargets must be an array of strings.");
		} else {
			const disabled = new Set<string>();
			for (const entry of config.disableTargets) {
				const normalized = normalizeString(entry);
				if (!normalized) {
					errors.push("disableTargets entries must be non-empty strings.");
					continue;
				}
				const key = normalizeLower(normalized);
				if (!builtInIds.has(key)) {
					errors.push(`disableTargets includes unknown built-in: ${normalized}.`);
					continue;
				}
				if (disabled.has(key)) {
					errors.push(`disableTargets includes duplicate target: ${normalized}.`);
					continue;
				}
				disabled.add(key);
			}
		}
	}

	if (config.targets !== undefined) {
		if (!Array.isArray(config.targets)) {
			errors.push("targets must be an array.");
		} else {
			for (const [index, entry] of config.targets.entries()) {
				const label = `targets[${index}]`;
				if (!isPlainObject(entry)) {
					errors.push(`${label} must be an object.`);
					continue;
				}

				const id = normalizeString(entry.id);
				if (!id) {
					errors.push(`${label}.id is required.`);
					continue;
				}
				const idKey = normalizeLower(id);
				if (seenIds.has(idKey)) {
					errors.push(`${label}.id duplicates another target (${id}).`);
				} else {
					seenIds.add(idKey);
				}

				if (entry.displayName !== undefined && normalizeString(entry.displayName) === null) {
					errors.push(`${label}.displayName must be a non-empty string when provided.`);
				}

				const inherits = normalizeString(entry.inherits);
				if (entry.inherits !== undefined && !inherits) {
					errors.push(`${label}.inherits must be a non-empty string when provided.`);
				}
				if (inherits) {
					const inheritKey = normalizeLower(inherits);
					if (!builtInIds.has(inheritKey)) {
						errors.push(`${label}.inherits references unknown built-in: ${inherits}.`);
					}
				}

				if (entry.override !== undefined && typeof entry.override !== "boolean") {
					errors.push(`${label}.override must be a boolean when provided.`);
				}

				const isBuiltInId = builtInIds.has(idKey);
				const hasOverride = entry.override === true;
				if (isBuiltInId && !hasOverride && !inherits) {
					errors.push(
						`${label} collides with built-in target "${id}" without override or inherits.`,
					);
				}
				if (hasOverride && !isBuiltInId) {
					errors.push(`${label}.override requires a matching built-in target (${id}).`);
				}
				if (hasOverride || inherits) {
					overrideIds.add(idKey);
				}

				if (entry.aliases !== undefined) {
					if (!Array.isArray(entry.aliases)) {
						errors.push(`${label}.aliases must be an array of strings.`);
					} else {
						const localAliasSet = new Set<string>();
						for (const alias of entry.aliases) {
							const aliasValue = normalizeString(alias);
							if (!aliasValue) {
								errors.push(`${label}.aliases entries must be non-empty strings.`);
								continue;
							}
							const aliasKey = normalizeLower(aliasValue);
							if (aliasKey === idKey) {
								errors.push(`${label}.aliases includes the target id (${aliasValue}).`);
								continue;
							}
							if (localAliasSet.has(aliasKey)) {
								errors.push(`${label}.aliases includes duplicate alias (${aliasValue}).`);
								continue;
							}
							if (seenIds.has(aliasKey) || builtInIds.has(aliasKey)) {
								errors.push(`${label}.aliases collides with existing target id (${aliasValue}).`);
								continue;
							}
							if (seenAliases.has(aliasKey) || builtInAliasSet.has(aliasKey)) {
								errors.push(`${label}.aliases collides with existing alias (${aliasValue}).`);
								continue;
							}
							localAliasSet.add(aliasKey);
							seenAliases.add(aliasKey);
						}
					}
				}

				validateOutputs(entry.outputs, `${label}.outputs`, errors);
			}
		}
	}

	if (config.disableTargets && Array.isArray(config.disableTargets)) {
		for (const targetId of config.disableTargets) {
			const normalized = normalizeLower(targetId);
			if (overrideIds.has(normalized)) {
				errors.push(`disableTargets cannot include overridden/inherited target (${targetId}).`);
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		config: errors.length === 0 ? (config as OmniagentConfig) : null,
	};
}
