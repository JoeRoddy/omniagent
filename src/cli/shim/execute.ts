import { spawn as defaultSpawn, type StdioOptions } from "node:child_process";
import { buildAgentArgs } from "./build-args.js";
import type { ExitCodeReason } from "./errors.js";
import type { ResolvedInvocation } from "./types.js";

type SpawnFn = typeof defaultSpawn;

export type ExecuteResult = {
	exitCode: number;
	reason: ExitCodeReason;
};

export type ExecuteOptions = {
	spawn?: SpawnFn;
	stderr?: NodeJS.WriteStream;
	stdio?: StdioOptions;
	traceTranslate?: boolean;
};

export async function executeInvocation(
	invocation: ResolvedInvocation,
	options: ExecuteOptions = {},
): Promise<ExecuteResult> {
	const { command, args, warnings, shimArgs, passthroughArgs } = buildAgentArgs(invocation);
	const stderr = options.stderr ?? process.stderr;

	if (options.traceTranslate) {
		const trace = {
			agent: invocation.agent.id,
			mode: invocation.mode,
			command,
			args,
			shimArgs,
			passthroughArgs,
			warnings,
			requests: invocation.requests,
		};
		stderr.write(`OA_TRANSLATION=${JSON.stringify(trace)}\n`);
	}

	for (const warning of warnings) {
		stderr.write(`${warning}\n`);
	}

	const spawn = options.spawn ?? defaultSpawn;
	const stdio = options.stdio ?? "inherit";

	return await new Promise<ExecuteResult>((resolve) => {
		const child = spawn(command, args, { stdio });

		child.on("error", (error) => {
			stderr.write(`Error: ${error.message}\n`);
			resolve({ exitCode: 1, reason: "execution-error" });
		});

		child.on("exit", (code) => {
			if (code === 0) {
				resolve({ exitCode: 0, reason: "success" });
				return;
			}
			if (code === 2) {
				resolve({ exitCode: 2, reason: "invalid-usage" });
				return;
			}
			if (code === 3) {
				resolve({ exitCode: 3, reason: "blocked" });
				return;
			}
			resolve({ exitCode: 1, reason: "execution-error" });
		});
	});
}
