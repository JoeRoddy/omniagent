import { BUILTIN_TARGETS } from "../../lib/targets/builtins.js";
import { loadTargetConfig } from "../../lib/targets/config-loader.js";
import { validateTargetConfig } from "../../lib/targets/config-validate.js";
import { resolveTargets } from "../../lib/targets/resolve-targets.js";
import { InvalidUsageError } from "./errors.js";
import { parseShimFlags } from "./flags.js";
import type {
	AgentSelection,
	FlagRequests,
	ParsedShimFlags,
	ResolvedInvocation,
	SessionConfiguration,
} from "./types.js";

type AgentResolution = {
	selection: AgentSelection;
	targetId: string;
};

type ResolveInvocationOptions = {
	argv: string[];
	stdinIsTTY: boolean;
	stdinText: string | null;
	repoRoot: string;
	agentsDir?: string | null;
};

type ResolveFromFlagsOptions = {
	flags: ParsedShimFlags;
	stdinIsTTY: boolean;
	stdinText: string | null;
	repoRoot: string;
	agentsDir?: string | null;
};

function buildRequests(flags: ParsedShimFlags): FlagRequests {
	const requests: FlagRequests = {
		approval: flags.approval,
		sandbox: flags.sandbox,
		output: flags.output,
		web: flags.web,
	};

	if (flags.modelExplicit && flags.model) {
		requests.model = flags.model;
	}

	return requests;
}

function buildSession(flags: ParsedShimFlags): SessionConfiguration {
	return {
		approvalPolicy: flags.approval,
		sandbox: flags.sandbox,
		outputFormat: flags.output,
		model: flags.model,
		webEnabled: flags.web,
		approvalExplicit: flags.approvalExplicit,
		sandboxExplicit: flags.sandboxExplicit,
		outputExplicit: flags.outputExplicit,
		modelExplicit: flags.modelExplicit,
		webExplicit: flags.webExplicit,
	};
}

function normalizeKey(value: string): string {
	return value.trim().toLowerCase();
}

async function resolveAgentSelection(
	flags: ParsedShimFlags,
	repoRoot: string,
	agentsDir?: string | null,
): Promise<{ resolution: AgentResolution; targetMap: ReturnType<typeof resolveTargets> }> {
	if (flags.hasDelimiter && !flags.agentExplicit) {
		throw new InvalidUsageError("Using -- requires --agent.");
	}

	const { config, configPath } = await loadTargetConfig({ repoRoot, agentsDir });
	let resolvedConfig = config;
	if (config) {
		const validation = validateTargetConfig({ config, builtIns: BUILTIN_TARGETS });
		if (!validation.valid || !validation.config) {
			const details = validation.errors.length > 0 ? ` ${validation.errors.join(" ")}` : "";
			const path = configPath ? ` (${configPath})` : "";
			throw new InvalidUsageError(`Invalid agent config${path}.${details}`);
		}
		resolvedConfig = validation.config;
	}

	const targetMap = resolveTargets({ config: resolvedConfig, builtIns: BUILTIN_TARGETS });
	const aliasToId = targetMap.aliasToId;
	const byId = targetMap.byId;

	let resolvedId: string | null = null;
	let selection: AgentSelection | null = null;

	if (flags.agentExplicit && flags.agent) {
		const key = normalizeKey(flags.agent);
		const mapped = aliasToId.get(key);
		if (!mapped) {
			throw new InvalidUsageError(`Unknown or disabled target: ${flags.agent}.`);
		}
		resolvedId = mapped;
		selection = {
			id: mapped,
			source: "flag",
			configPath: null,
		};
	} else if (resolvedConfig?.defaultAgent) {
		const key = normalizeKey(resolvedConfig.defaultAgent);
		const mapped = aliasToId.get(key);
		if (!mapped) {
			const path = configPath ? ` (${configPath})` : "";
			throw new InvalidUsageError(`Invalid defaultAgent${path}: ${resolvedConfig.defaultAgent}.`);
		}
		resolvedId = mapped;
		selection = {
			id: mapped,
			source: "config",
			configPath: configPath ?? null,
		};
	} else {
		throw new InvalidUsageError(
			"Missing --agent flag and no defaultAgent found in omniagent.config.*.",
		);
	}

	if (!resolvedId || !selection) {
		throw new InvalidUsageError("Unable to resolve target selection.");
	}

	const target = byId.get(normalizeKey(resolvedId));
	if (!target) {
		throw new InvalidUsageError(`Unknown or disabled target: ${resolvedId}.`);
	}
	if (!target.cli) {
		throw new InvalidUsageError(`Target ${resolvedId} is missing cli configuration.`);
	}

	return { resolution: { selection, targetId: resolvedId }, targetMap };
}

export async function resolveInvocation(
	options: ResolveInvocationOptions,
): Promise<ResolvedInvocation> {
	const flags = parseShimFlags(options.argv);
	return resolveInvocationFromFlags({ ...options, flags });
}

export async function resolveInvocationFromFlags(
	options: ResolveFromFlagsOptions,
): Promise<ResolvedInvocation> {
	const { flags, stdinIsTTY, stdinText } = options;
	const usesPipedStdin = !stdinIsTTY;
	const prompt = flags.promptExplicit ? flags.prompt : usesPipedStdin ? (stdinText ?? "") : null;
	const mode = flags.promptExplicit || usesPipedStdin ? "one-shot" : "interactive";

	const { resolution, targetMap } = await resolveAgentSelection(
		flags,
		options.repoRoot,
		options.agentsDir,
	);
	const target = targetMap.byId.get(normalizeKey(resolution.targetId));
	if (!target) {
		throw new InvalidUsageError(`Unknown or disabled target: ${resolution.targetId}.`);
	}

	const agent = resolution.selection;
	const session = buildSession(flags);
	const requests = buildRequests(flags);

	return {
		mode,
		prompt,
		usesPipedStdin,
		agent,
		target,
		session,
		requests,
		passthrough: {
			hasDelimiter: flags.hasDelimiter,
			args: flags.passthroughArgs,
		},
	};
}
