import { resolveDefaultAgent } from "../../lib/targets/default-agent.js";
import { InvalidUsageError } from "./errors.js";
import { parseShimFlags } from "./flags.js";
import type {
	AgentSelection,
	FlagRequests,
	ParsedShimFlags,
	ResolvedInvocation,
	SessionConfiguration,
} from "./types.js";

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
	const requests: FlagRequests = {};

	if (flags.approvalExplicit) {
		requests.approval = flags.approval;
	}

	const sandboxRequested =
		flags.sandboxExplicit || (flags.approvalExplicit && flags.approval === "yolo");
	if (sandboxRequested) {
		requests.sandbox = flags.sandbox;
	}

	if (flags.outputExplicit) {
		requests.output = flags.output;
	}

	if (flags.modelExplicit && flags.model) {
		requests.model = flags.model;
	}

	if (flags.webExplicit) {
		requests.web = flags.web;
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
		sandboxExplicit: flags.sandboxExplicit,
	};
}

async function resolveAgentSelection(
	flags: ParsedShimFlags,
	repoRoot: string,
	agentsDir?: string | null,
): Promise<AgentSelection> {
	if (flags.agentExplicit && flags.agent) {
		return {
			id: flags.agent,
			source: "flag",
			configPath: null,
		};
	}

	if (flags.hasDelimiter && !flags.agentExplicit) {
		throw new InvalidUsageError("Using -- requires --agent.");
	}

	const resolution = await resolveDefaultAgent({ repoRoot, agentsDir });
	if (resolution.status === "resolved") {
		return {
			id: resolution.id,
			source: resolution.source,
			configPath: resolution.configPath,
		};
	}
	if (resolution.status === "invalid") {
		const details = resolution.errors.length > 0 ? ` ${resolution.errors.join(" ")}` : "";
		const path = resolution.configPath ? ` (${resolution.configPath})` : "";
		throw new InvalidUsageError(`Invalid agent config${path}.${details}`);
	}
	throw new InvalidUsageError(
		"Missing --agent flag and no defaultAgent found in omniagent.config.*.",
	);
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

	const agent = await resolveAgentSelection(flags, options.repoRoot, options.agentsDir);
	const session = buildSession(flags);
	const requests = buildRequests(flags);

	return {
		mode,
		prompt,
		usesPipedStdin,
		agent,
		session,
		requests,
		passthrough: {
			hasDelimiter: flags.hasDelimiter,
			args: flags.passthroughArgs,
		},
	};
}
