import type { StdioOptions } from "node:child_process";
import { findRepoRoot } from "../../lib/repo-root.js";
import { exitCodeFor, ShimError } from "./errors.js";
import { type ExecuteOptions, executeInvocation } from "./execute.js";
import { parseShimFlags } from "./flags.js";
import { resolveInvocationFromFlags } from "./resolve-invocation.js";

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

	try {
		const flags = parseShimFlags(argv);
		let stdinText = runtime.stdinText ?? null;
		const shouldReadStdin = !stdinIsTTY && stdinText === null && !flags.promptExplicit;
		if (shouldReadStdin) {
			try {
				stdinText = await readStreamText(stdin);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				stderr.write(`Error: Failed to read stdin. ${message}\n`);
				return exitCodeFor("execution-error");
			}
		}
		const stdio: StdioOptions =
			!stdinIsTTY && flags.promptExplicit
				? (["ignore", "inherit", "inherit"] as StdioOptions)
				: "inherit";

		const invocation = await resolveInvocationFromFlags({
			flags,
			stdinIsTTY,
			stdinText,
			repoRoot,
			agentsDir: runtime.agentsDir,
		});
		const result = await executeInvocation(invocation, {
			spawn: runtime.spawn,
			stderr,
			stdio,
			traceTranslate: flags.traceTranslate,
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
