import { BUILTIN_TARGETS } from "../targets/builtins.js";
import { loadTargetConfig } from "../targets/config-loader.js";
import {
	APPROVAL_POLICIES,
	type ApprovalPolicy,
	type InvocationMode,
	OUTPUT_FORMATS,
	type OutputFormat,
	type ResolvedTarget,
	SANDBOX_MODES,
	type SandboxMode,
} from "../targets/config-types.js";
import { validateTargetConfig } from "../targets/config-validate.js";
import { resolveTargets } from "../targets/resolve-targets.js";
import { InvalidUsageError } from "./errors.js";

// Re-exporting types from cli/shim/types.ts that are critical for agent switching
export {
	APPROVAL_POLICIES,
	type ApprovalPolicy,
	OUTPUT_FORMATS,
	type OutputFormat,
	SANDBOX_MODES,
	type SandboxMode,
};

export type FlagSource = "default" | "flag" | "alias" | "derived";

export type FlagValue<T> = {
	value: T;
	source: FlagSource;
	explicit: boolean;
};

export type ParsedShimFlags = {
	prompt: string | null;
	promptExplicit: boolean;
	approval: ApprovalPolicy;
	approvalExplicit: boolean;
	sandbox: SandboxMode;
	sandboxExplicit: boolean;
	output: OutputFormat;
	outputExplicit: boolean;
	model: string | null;
	modelExplicit: boolean;
	web: boolean;
	webExplicit: boolean;
	agent: string | null;
	agentExplicit: boolean;
	traceTranslate: boolean;
	help: boolean;
	version: boolean;
	hasDelimiter: boolean;
	passthroughArgs: string[];
};

export type SessionConfiguration = {
	approvalPolicy: ApprovalPolicy;
	sandbox: SandboxMode;
	outputFormat: OutputFormat;
	model: string | null;
	webEnabled: boolean;
	approvalExplicit: boolean;
	sandboxExplicit: boolean;
	outputExplicit: boolean;
	modelExplicit: boolean;
	webExplicit: boolean;
};

export type AgentSelection = {
	id: string;
	source: "flag" | "config";
	configPath: string | null;
};

export type AgentPassthrough = {
	hasDelimiter: boolean;
	args: string[];
};

export type FlagRequests = {
	approval: ApprovalPolicy;
	sandbox: SandboxMode;
	output: OutputFormat;
	model?: string;
	web: boolean;
};

export type ResolvedInvocation = {
	mode: InvocationMode;
	prompt: string | null;
	usesPipedStdin: boolean;
	agent: AgentSelection;
	target: ResolvedTarget;
	session: SessionConfiguration;
	requests: FlagRequests;
	passthrough: AgentPassthrough;
};

type AgentResolution = {
	selection: AgentSelection;
	targetId: string;
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

export async function resolveAgentSelection(
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

export { buildRequests, buildSession };
