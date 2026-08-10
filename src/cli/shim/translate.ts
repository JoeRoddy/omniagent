import type {
	FlagMap,
	InvocationMode,
	PassthroughCollisionRule,
	PassthroughCollisionSource,
	TargetCliDefinition,
	TranslationResult,
} from "../../lib/targets/config-types.js";
import { InvalidUsageError } from "./errors.js";
import type { ResolvedInvocation } from "./types.js";

type TranslateOptions = {
	includePassthrough?: boolean;
};

type CollisionSourceState = {
	active: boolean;
	explicit: boolean;
	label: string;
};

function formatWarning(agentId: string, flag: string, value?: string): string {
	const suffix = value ? ` (${value})` : "";
	return `Warning: ${agentId} does not support ${flag}${suffix}; ignoring.`;
}

function resolveFlagMapValue<T extends string>(
	map: FlagMap<T> | undefined,
	mode: InvocationMode,
	value: T,
): string[] | null | undefined {
	if (!map) {
		return undefined;
	}
	const byMode = map.byMode?.[mode];
	if (byMode && Object.hasOwn(byMode, value)) {
		return byMode[value];
	}
	if (map.values && Object.hasOwn(map.values, value)) {
		return map.values[value];
	}
	return undefined;
}

function modeAllowed(modes: InvocationMode[] | undefined, mode: InvocationMode): boolean {
	if (!modes || modes.length === 0) {
		return true;
	}
	return modes.includes(mode);
}

function matchesPassthroughRule(args: string[], rule: PassthroughCollisionRule): boolean {
	const equalsPrefix = `${rule.option}=`;
	for (const [index, arg] of args.entries()) {
		if (arg.startsWith(equalsPrefix)) {
			if (rule.value === undefined || arg.slice(equalsPrefix.length) === rule.value) {
				return true;
			}
			continue;
		}
		if (arg !== rule.option) {
			continue;
		}
		if (rule.value === undefined || args[index + 1] === rule.value) {
			return true;
		}
	}
	return false;
}

function formatCollisionOption(rule: PassthroughCollisionRule): string {
	return rule.value === undefined ? rule.option : `${rule.option} ${rule.value}`;
}

function resolvePassthroughSuppression(
	invocation: ResolvedInvocation,
	cli: TargetCliDefinition,
	sources: Record<PassthroughCollisionSource, CollisionSourceState>,
): Set<PassthroughCollisionSource> {
	const suppressed = new Set<PassthroughCollisionSource>();
	for (const rule of cli.passthrough?.collisions ?? []) {
		if (rule.modes && !rule.modes.includes(invocation.mode)) {
			continue;
		}
		if (!matchesPassthroughRule(invocation.passthrough.args, rule)) {
			continue;
		}

		const activeSources = rule.sources.filter((source) => sources[source].active);
		if (activeSources.length === 0) {
			continue;
		}
		const explicitSource = activeSources.find((source) => sources[source].explicit);
		if (explicitSource) {
			throw new InvalidUsageError(
				`Passthrough option ${formatCollisionOption(rule)} conflicts with ${sources[explicitSource].label}. Remove one of the conflicting options.`,
			);
		}
		for (const source of activeSources) {
			suppressed.add(source);
		}
	}
	return suppressed;
}

function buildPromptArgs(
	invocation: ResolvedInvocation,
	cli: TargetCliDefinition,
	warnings: string[],
): { promptArgs: string[]; position: "first" | "last" } {
	if (invocation.mode !== "one-shot" || invocation.prompt === null) {
		return { promptArgs: [], position: "last" };
	}
	if (!cli.prompt) {
		warnings.push(formatWarning(invocation.agent.id, "--prompt"));
		return { promptArgs: [], position: "last" };
	}
	if (cli.prompt.type === "flag") {
		return { promptArgs: [...cli.prompt.flag, invocation.prompt], position: "last" };
	}
	const position = cli.prompt.position === "first" ? "first" : "last";
	return { promptArgs: [invocation.prompt], position };
}

export function translateInvocation(
	invocation: ResolvedInvocation,
	cli: TargetCliDefinition,
	options: TranslateOptions = {},
): TranslationResult {
	if (cli.translate) {
		return cli.translate(invocation);
	}

	const includePassthrough = options.includePassthrough !== false;
	const warnings: string[] = [];
	const mode = invocation.mode;
	const base = mode === "interactive" ? cli.modes.interactive : cli.modes.oneShot;
	const args: string[] = [...(base.args ?? [])];

	const { requests } = invocation;
	const { approvalExplicit, modelExplicit, outputExplicit, sandboxExplicit, webExplicit } =
		invocation.session;
	const sandboxDerivedExplicit = approvalExplicit && requests.approval === "yolo";
	const sandboxWarnExplicit = sandboxExplicit || sandboxDerivedExplicit;
	const flags = cli.flags;

	const mappedApproval = resolveFlagMapValue(flags?.approval, mode, requests.approval);
	const mappedSandbox = resolveFlagMapValue(flags?.sandbox, mode, requests.sandbox);
	const mappedOutput = resolveFlagMapValue(flags?.output, mode, requests.output);
	const modelSupported = Boolean(
		requests.model && flags?.model && modeAllowed(flags.model.modes, mode),
	);
	const modeAllowedForWeb = modeAllowed(flags?.web?.modes, mode);
	const mappedWeb =
		flags?.web && modeAllowedForWeb ? (requests.web ? flags.web.on : flags.web.off) : undefined;
	const { promptArgs, position } = buildPromptArgs(invocation, cli, warnings);
	const suppressed = resolvePassthroughSuppression(invocation, cli, {
		mode: {
			active: (base.args?.length ?? 0) > 0,
			explicit: true,
			label: "required target mode arguments",
		},
		prompt: {
			active: promptArgs.length > 0,
			explicit: true,
			label: "required one-shot prompt delivery",
		},
		approval: {
			active: mappedApproval !== undefined && mappedApproval !== null,
			explicit: approvalExplicit,
			label: "explicit shared --approval policy",
		},
		sandbox: {
			active: mappedSandbox !== undefined && mappedSandbox !== null,
			explicit: sandboxExplicit || sandboxDerivedExplicit,
			label: sandboxDerivedExplicit
				? "the sandbox policy derived from explicit --yolo"
				: "explicit shared --sandbox policy",
		},
		output: {
			active: mappedOutput !== undefined && mappedOutput !== null,
			explicit: outputExplicit,
			label: "explicit shared --output format",
		},
		model: {
			active: modelSupported,
			explicit: modelExplicit,
			label: "explicit shared --model selection",
		},
		web: {
			active: mappedWeb !== undefined && mappedWeb !== null,
			explicit: webExplicit,
			label: "explicit shared --web setting",
		},
		structuredOutput: {
			active: (invocation.structuredOutput?.args.length ?? 0) > 0,
			explicit: true,
			label: "required shared --output-schema arguments",
		},
	});

	if (mappedApproval === undefined || mappedApproval === null) {
		if (approvalExplicit) {
			warnings.push(formatWarning(invocation.agent.id, "--approval", requests.approval));
		}
	} else if (!suppressed.has("approval")) {
		args.push(...mappedApproval);
	}

	if (mappedSandbox === undefined || mappedSandbox === null) {
		if (sandboxWarnExplicit) {
			warnings.push(formatWarning(invocation.agent.id, "--sandbox", requests.sandbox));
		}
	} else if (!suppressed.has("sandbox")) {
		args.push(...mappedSandbox);
	}

	if (mappedOutput === undefined || mappedOutput === null) {
		if (outputExplicit) {
			warnings.push(formatWarning(invocation.agent.id, "--output", requests.output));
		}
	} else if (!suppressed.has("output")) {
		args.push(...mappedOutput);
	}

	if (requests.model) {
		if (!modelSupported || !flags?.model) {
			if (modelExplicit) {
				warnings.push(formatWarning(invocation.agent.id, "--model", requests.model));
			}
		} else if (!suppressed.has("model")) {
			args.push(...flags.model.flag, requests.model);
		}
	}

	if (!flags?.web || !modeAllowedForWeb) {
		if (webExplicit) {
			warnings.push(formatWarning(invocation.agent.id, "--web", requests.web ? "on" : "off"));
		}
	} else {
		if (mappedWeb === undefined || mappedWeb === null) {
			if (webExplicit) {
				warnings.push(formatWarning(invocation.agent.id, "--web", requests.web ? "on" : "off"));
			}
		} else if (!suppressed.has("web")) {
			args.push(...mappedWeb);
		}
	}

	if (invocation.structuredOutput && !suppressed.has("structuredOutput")) {
		args.push(...invocation.structuredOutput.args);
	}

	if (mode === "one-shot" && base.args?.includes("exec")) {
		const searchIndex = args.indexOf("--search");
		if (searchIndex > -1) {
			args.splice(searchIndex, 1);
			args.unshift("--search");
		}
	}

	const passthroughArgs = includePassthrough ? invocation.passthrough.args : [];

	if (promptArgs.length === 0) {
		return {
			command: base.command,
			args: [...args, ...passthroughArgs],
			warnings,
		};
	}

	const passthroughPosition = cli.passthrough?.position ?? "after";
	const beforePrompt = passthroughPosition === "before-prompt" ? passthroughArgs : ([] as string[]);
	const afterPrompt = passthroughPosition === "before-prompt" ? ([] as string[]) : passthroughArgs;

	if (position === "first") {
		return {
			command: base.command,
			args: [...beforePrompt, ...promptArgs, ...args, ...afterPrompt],
			warnings,
		};
	}

	return {
		command: base.command,
		args: [...args, ...beforePrompt, ...promptArgs, ...afterPrompt],
		warnings,
	};
}
