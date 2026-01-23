import { getAgentCapability } from "./agent-capabilities.js";
import type { ResolvedInvocation } from "./types.js";

export type BuildArgsResult = {
	command: string;
	args: string[];
	shimArgs: string[];
	passthroughArgs: string[];
	warnings: string[];
};

function formatWarning(agentId: string, flag: string, value?: string): string {
	const suffix = value ? ` (${value})` : "";
	return `Warning: ${agentId} does not support ${flag}${suffix}; ignoring.`;
}

export function buildAgentArgs(invocation: ResolvedInvocation): BuildArgsResult {
	const capability = getAgentCapability(invocation.agent.id);
	const warnings: string[] = [];
	const shimArgs: string[] = [];

	const { requests } = invocation;

	if (requests.approval) {
		if (!capability.supports.approval || !capability.flags.approval) {
			warnings.push(formatWarning(invocation.agent.id, "--approval", requests.approval));
		} else {
			shimArgs.push(...capability.flags.approval[requests.approval]);
		}
	}

	if (requests.sandbox) {
		if (!capability.supports.sandbox || !capability.flags.sandbox) {
			warnings.push(formatWarning(invocation.agent.id, "--sandbox", requests.sandbox));
		} else {
			shimArgs.push(...capability.flags.sandbox[requests.sandbox]);
		}
	}

	if (requests.output) {
		if (!capability.supports.output || !capability.flags.output) {
			warnings.push(formatWarning(invocation.agent.id, "--output", requests.output));
		} else {
			shimArgs.push(...capability.flags.output[requests.output]);
		}
	}

	if (requests.model) {
		if (!capability.supports.model || !capability.flags.model) {
			warnings.push(formatWarning(invocation.agent.id, "--model", requests.model));
		} else {
			shimArgs.push(...capability.flags.model(requests.model));
		}
	}

	if (requests.web !== undefined) {
		if (!capability.supports.web || !capability.flags.web) {
			warnings.push(formatWarning(invocation.agent.id, "--web", requests.web ? "on" : "off"));
		} else if (requests.web) {
			shimArgs.push(...capability.flags.web.on);
		} else if (capability.flags.web.off) {
			shimArgs.push(...capability.flags.web.off);
		} else {
			warnings.push(formatWarning(invocation.agent.id, "--web", "off"));
		}
	}

	if (invocation.mode === "one-shot" && invocation.prompt !== null) {
		shimArgs.push(...capability.promptFlag, invocation.prompt);
	}

	const args = [...shimArgs, ...invocation.passthrough.args];

	return {
		command: capability.command,
		args,
		shimArgs,
		passthroughArgs: invocation.passthrough.args,
		warnings,
	};
}
