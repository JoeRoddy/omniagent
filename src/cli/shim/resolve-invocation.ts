import { InvalidUsageError } from "../../lib/agents/errors.js";
import { buildRequests, buildSession, resolveAgentSelection } from "../../lib/agents/switch.js";
import { parseShimFlags } from "./flags.js";
import type { ParsedShimFlags, ResolvedInvocation } from "./types.js";

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

function normalizeKey(value: string): string {
	return value.trim().toLowerCase();
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
