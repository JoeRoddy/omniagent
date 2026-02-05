import type {
	CommandOutputDefinition,
	FallbackRule,
	InstructionOutputDefinition,
	OmniagentConfig,
	OutputDefinition,
	OutputTemplateValue,
	TargetCliDefinition,
	TargetDefinition,
	TargetOutputs,
} from "./config-types.js";
import { APPROVAL_POLICIES, OUTPUT_FORMATS, SANDBOX_MODES } from "./config-types.js";
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

const INVOCATION_MODES = ["interactive", "one-shot"] as const;

function validateStringArray(
	value: unknown,
	label: string,
	errors: string[],
	options: { allowEmpty?: boolean } = {},
): void {
	if (!Array.isArray(value)) {
		errors.push(`${label} must be an array of strings.`);
		return;
	}
	const allowEmpty = options.allowEmpty ?? false;
	if (!allowEmpty && value.length === 0) {
		errors.push(`${label} must include at least one entry.`);
		return;
	}
	for (const [index, entry] of value.entries()) {
		const normalized = normalizeString(entry);
		if (!normalized) {
			errors.push(`${label}[${index}] must be a non-empty string.`);
		}
	}
}

function validateFlagMapValues(
	value: unknown,
	label: string,
	allowedValues: readonly string[],
	errors: string[],
): void {
	if (!isPlainObject(value)) {
		errors.push(`${label} must be an object.`);
		return;
	}
	for (const [key, entry] of Object.entries(value)) {
		if (!allowedValues.includes(key)) {
			errors.push(`${label} has unsupported key "${key}".`);
			continue;
		}
		if (entry === null) {
			continue;
		}
		validateStringArray(entry, `${label}.${key}`, errors, { allowEmpty: true });
	}
}

function validateFlagMap(
	value: unknown,
	label: string,
	allowedValues: readonly string[],
	errors: string[],
): void {
	if (!isPlainObject(value)) {
		errors.push(`${label} must be an object.`);
		return;
	}
	if (value.values !== undefined) {
		validateFlagMapValues(value.values, `${label}.values`, allowedValues, errors);
	}
	if (value.byMode !== undefined) {
		if (!isPlainObject(value.byMode)) {
			errors.push(`${label}.byMode must be an object.`);
		} else {
			for (const [mode, entries] of Object.entries(value.byMode)) {
				if (!INVOCATION_MODES.includes(mode as (typeof INVOCATION_MODES)[number])) {
					errors.push(`${label}.byMode has unsupported mode "${mode}".`);
					continue;
				}
				validateFlagMapValues(entries, `${label}.byMode.${mode}`, allowedValues, errors);
			}
		}
	}
}

function validateModeCommand(value: unknown, label: string, errors: string[]): void {
	if (!isPlainObject(value)) {
		errors.push(`${label} must be an object.`);
		return;
	}
	const command = normalizeString(value.command);
	if (!command) {
		errors.push(`${label}.command is required.`);
	}
	if (value.args !== undefined) {
		validateStringArray(value.args, `${label}.args`, errors, { allowEmpty: true });
	}
}

function validatePromptSpec(value: unknown, label: string, errors: string[]): void {
	if (!isPlainObject(value)) {
		errors.push(`${label} must be an object.`);
		return;
	}
	if (value.type === "flag") {
		validateStringArray(value.flag, `${label}.flag`, errors);
		return;
	}
	if (value.type === "positional") {
		if (value.position !== undefined && value.position !== "first" && value.position !== "last") {
			errors.push(`${label}.position must be "first" or "last" when provided.`);
		}
		return;
	}
	errors.push(`${label}.type must be "flag" or "positional".`);
}

function validateCliDefinition(
	cli: TargetCliDefinition | undefined,
	label: string,
	errors: string[],
): void {
	if (!cli) {
		return;
	}
	if (!isPlainObject(cli)) {
		errors.push(`${label} must be an object.`);
		return;
	}
	if (!isPlainObject(cli.modes)) {
		errors.push(`${label}.modes is required.`);
		return;
	}
	validateModeCommand(cli.modes.interactive, `${label}.modes.interactive`, errors);
	validateModeCommand(cli.modes.oneShot, `${label}.modes.oneShot`, errors);

	if (cli.prompt !== undefined) {
		validatePromptSpec(cli.prompt, `${label}.prompt`, errors);
	}
	if (cli.flags !== undefined) {
		if (!isPlainObject(cli.flags)) {
			errors.push(`${label}.flags must be an object.`);
		} else {
			if (cli.flags.approval !== undefined) {
				validateFlagMap(cli.flags.approval, `${label}.flags.approval`, APPROVAL_POLICIES, errors);
			}
			if (cli.flags.sandbox !== undefined) {
				validateFlagMap(cli.flags.sandbox, `${label}.flags.sandbox`, SANDBOX_MODES, errors);
			}
			if (cli.flags.output !== undefined) {
				validateFlagMap(cli.flags.output, `${label}.flags.output`, OUTPUT_FORMATS, errors);
			}
			if (cli.flags.model !== undefined) {
				if (!isPlainObject(cli.flags.model)) {
					errors.push(`${label}.flags.model must be an object.`);
				} else {
					validateStringArray(cli.flags.model.flag, `${label}.flags.model.flag`, errors);
					if (cli.flags.model.modes !== undefined) {
						validateStringArray(cli.flags.model.modes, `${label}.flags.model.modes`, errors);
						for (const mode of cli.flags.model.modes ?? []) {
							if (!INVOCATION_MODES.includes(mode as (typeof INVOCATION_MODES)[number])) {
								errors.push(`${label}.flags.model.modes has unsupported mode "${mode}".`);
							}
						}
					}
				}
			}
			if (cli.flags.web !== undefined) {
				if (!isPlainObject(cli.flags.web)) {
					errors.push(`${label}.flags.web must be an object.`);
				} else {
					if (cli.flags.web.on !== undefined && cli.flags.web.on !== null) {
						validateStringArray(cli.flags.web.on, `${label}.flags.web.on`, errors, {
							allowEmpty: true,
						});
					}
					if (cli.flags.web.off !== undefined && cli.flags.web.off !== null) {
						validateStringArray(cli.flags.web.off, `${label}.flags.web.off`, errors, {
							allowEmpty: true,
						});
					}
					if (cli.flags.web.modes !== undefined) {
						validateStringArray(cli.flags.web.modes, `${label}.flags.web.modes`, errors);
						for (const mode of cli.flags.web.modes ?? []) {
							if (!INVOCATION_MODES.includes(mode as (typeof INVOCATION_MODES)[number])) {
								errors.push(`${label}.flags.web.modes has unsupported mode "${mode}".`);
							}
						}
					}
				}
			}
		}
	}
	if (cli.passthrough !== undefined) {
		if (!isPlainObject(cli.passthrough)) {
			errors.push(`${label}.passthrough must be an object.`);
		} else if (
			cli.passthrough.position !== undefined &&
			cli.passthrough.position !== "after" &&
			cli.passthrough.position !== "before-prompt"
		) {
			errors.push(`${label}.passthrough.position must be "after" or "before-prompt".`);
		}
	}
	if (cli.translate !== undefined && typeof cli.translate !== "function") {
		errors.push(`${label}.translate must be a function when provided.`);
	}
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
	const customBuiltInIds = new Set<string>();

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
				if (hasOverride && !isBuiltInId) {
					errors.push(`${label}.override requires a matching built-in target (${id}).`);
				}
				if (isBuiltInId) {
					customBuiltInIds.add(idKey);
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
				validateCliDefinition(entry.cli, `${label}.cli`, errors);
			}
		}
	}

	if (config.disableTargets && Array.isArray(config.disableTargets)) {
		for (const targetId of config.disableTargets) {
			const normalized = normalizeLower(targetId);
			if (customBuiltInIds.has(normalized)) {
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
