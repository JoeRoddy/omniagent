import { translateInvocation } from "./translate.js";
import type { ResolvedInvocation } from "./types.js";

export type BuildArgsResult = {
	command: string;
	args: string[];
	shimArgs: string[];
	passthroughArgs: string[];
	warnings: string[];
};

export function buildAgentArgs(invocation: ResolvedInvocation): BuildArgsResult {
	const cli = invocation.target.cli;
	if (!cli) {
		return {
			command: invocation.agent.id,
			args: invocation.passthrough.args,
			shimArgs: [],
			passthroughArgs: invocation.passthrough.args,
			warnings: [`Warning: ${invocation.agent.id} is missing CLI configuration.`],
		};
	}

	const translated = translateInvocation(invocation, cli);
	const args = translated.args;
	let shimArgs = args;

	if (!cli.translate) {
		shimArgs = translateInvocation(invocation, cli, { includePassthrough: false }).args;
	}

	return {
		command: translated.command,
		args,
		shimArgs,
		passthroughArgs: invocation.passthrough.args,
		warnings: translated.warnings,
	};
}
