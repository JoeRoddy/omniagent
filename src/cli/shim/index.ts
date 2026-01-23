import { findRepoRoot } from "../../lib/repo-root.js";
import { exitCodeFor, ShimError } from "./errors.js";
import { type ExecuteOptions, executeInvocation } from "./execute.js";
import { resolveInvocation } from "./resolve-invocation.js";

type ShimRuntime = {
	stdin?: NodeJS.ReadStream;
	stderr?: NodeJS.WriteStream;
	repoRoot?: string;
	agentsDir?: string | null;
	stdinIsTTY?: boolean;
	stdinText?: string | null;
	spawn?: ExecuteOptions["spawn"];
};

async function readStreamText(stream: NodeJS.ReadStream): Promise<string> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of stream) {
		if (typeof chunk === "string") {
			chunks.push(Buffer.from(chunk));
		} else {
			chunks.push(chunk);
		}
	}
	return Buffer.concat(chunks).toString("utf8");
}

export async function runShim(argv: string[], runtime: ShimRuntime = {}): Promise<number> {
	const stderr = runtime.stderr ?? process.stderr;
	const stdin = runtime.stdin ?? process.stdin;
	const repoRoot = runtime.repoRoot ?? (await findRepoRoot(process.cwd())) ?? process.cwd();
	const stdinIsTTY = runtime.stdinIsTTY ?? stdin.isTTY ?? false;

	let stdinText = runtime.stdinText ?? null;
	if (!stdinIsTTY && stdinText === null) {
		try {
			stdinText = await readStreamText(stdin);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			stderr.write(`Error: Failed to read stdin. ${message}\n`);
			return exitCodeFor("execution-error");
		}
	}

	try {
		const invocation = await resolveInvocation({
			argv,
			stdinIsTTY,
			stdinText,
			repoRoot,
			agentsDir: runtime.agentsDir,
		});
		const result = await executeInvocation(invocation, {
			spawn: runtime.spawn,
			stderr,
		});
		return result.exitCode;
	} catch (error) {
		if (error instanceof ShimError) {
			stderr.write(`Error: ${error.message}\n`);
			return error.exitCode;
		}
		const message = error instanceof Error ? error.message : String(error);
		stderr.write(`Error: ${message}\n`);
		return exitCodeFor("execution-error");
	}
}

export { buildAgentArgs } from "./build-args.js";
export * from "./errors.js";
export { parseShimFlags } from "./flags.js";
export { resolveInvocation, resolveInvocationFromFlags } from "./resolve-invocation.js";
export * from "./types.js";
