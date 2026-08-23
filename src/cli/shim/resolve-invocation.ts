import { InvalidUsageError } from "../../lib/agents/errors.js";
import {
	buildRequests,
	buildSession,
	resolveAgentSelection,
	resolveModelAlias,
} from "../../lib/agents/switch.js";
import { parseShimFlags } from "./flags.js";
import { planStructuredOutput } from "./structured-output.js";
import type { ParsedShimFlags, ResolvedInvocation } from "./types.js";

type ResolveInvocationOptions = {
	argv: string[];
	stdinIsTTY: boolean;
	stdinText: string | null;
	repoRoot: string;
	agentsDir?: string | null;
	tempDir?: string;
};

type ResolveFromFlagsOptions = {
	flags: ParsedShimFlags;
	stdinIsTTY: boolean;
	stdinText: string | null;
	repoRoot: string;
	agentsDir?: string | null;
	tempDir?: string;
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
	// Resolve the model nickname once, before anything downstream reads it, so the session, the
	// translated argv, and the --trace-translate payload all report the same id.
	const model = resolveModelAlias(target, flags.model);
	const effectiveFlags = model === flags.model ? flags : { ...flags, model };
	const session = buildSession(effectiveFlags);
	const requests = buildRequests(effectiveFlags);
	const structuredOutput = await planStructuredOutput({
		rawSchema: flags.outputSchema,
		mode,
		agentId: agent.id,
		spec: target.cli?.flags?.structuredOutput,
		fallbackSpec: target.cli?.flags?.structuredOutputFallback,
		retries: flags.outputSchemaRetries,
		promptDeliverable: Boolean(target.cli?.prompt),
		tempDir: options.tempDir,
	});

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
		structuredOutput,
	};
}
