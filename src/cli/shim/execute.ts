import { spawn as defaultSpawn } from "node:child_process";
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
};

export async function executeInvocation(
	invocation: ResolvedInvocation,
	options: ExecuteOptions = {},
): Promise<ExecuteResult> {
	const { command, args, warnings } = buildAgentArgs(invocation);
	const stderr = options.stderr ?? process.stderr;

	for (const warning of warnings) {
		stderr.write(`${warning}\n`);
	}

	const spawn = options.spawn ?? defaultSpawn;

	return await new Promise<ExecuteResult>((resolve) => {
		const child = spawn(command, args, { stdio: "inherit" });

		child.on("error", (error) => {
			stderr.write(`Error: ${error.message}\n`);
			resolve({ exitCode: 1, reason: "execution-error" });
		});

		child.on("exit", (code) => {
			if (code === 0) {
				resolve({ exitCode: 0, reason: "success" });
			} else {
				resolve({ exitCode: 1, reason: "execution-error" });
			}
		});
	});
}
