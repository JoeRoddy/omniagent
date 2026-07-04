import { spawn as defaultSpawn, type StdioOptions } from "node:child_process";
import { readFile } from "node:fs/promises";
import { buildAgentArgs } from "./build-args.js";
import type { ExitCodeReason } from "./errors.js";
import type { ResolvedInvocation, StructuredOutputPlan } from "./types.js";

type SpawnFn = typeof defaultSpawn;

export type ExecuteResult = {
	exitCode: number;
	reason: ExitCodeReason;
};

export type ExecuteOptions = {
	spawn?: SpawnFn;
	stderr?: NodeJS.WriteStream;
	stdout?: NodeJS.WriteStream;
	stdio?: StdioOptions;
	traceTranslate?: boolean;
};

function withPipedStdout(stdio: StdioOptions): StdioOptions {
	if (Array.isArray(stdio)) {
		return [stdio[0] ?? "inherit", "pipe", stdio[2] ?? "inherit"];
	}
	return [stdio, "pipe", stdio];
}

function mapExitCode(code: number | null): ExecuteResult {
	if (code === 0) {
		return { exitCode: 0, reason: "success" };
	}
	if (code === 2) {
		return { exitCode: 2, reason: "invalid-usage" };
	}
	if (code === 3) {
		return { exitCode: 3, reason: "blocked" };
	}
	return { exitCode: 1, reason: "execution-error" };
}

async function finalizeStructuredOutput(options: {
	plan: StructuredOutputPlan;
	agentId: string;
	code: number | null;
	captured: string;
	stdout: NodeJS.WriteStream;
	stderr: NodeJS.WriteStream;
}): Promise<ExecuteResult> {
	const { plan, agentId, code, captured, stdout, stderr } = options;

	if (code !== 0) {
		if (plan.capture.type === "json-envelope" && captured.length > 0) {
			stderr.write(captured);
		}
		return mapExitCode(code);
	}

	if (plan.capture.type === "json-envelope") {
		let envelope: unknown;
		try {
			envelope = JSON.parse(captured);
		} catch {
			envelope = undefined;
		}
		if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
			stderr.write(captured);
			stderr.write(`Error: ${agentId} did not return a JSON envelope.\n`);
			return { exitCode: 1, reason: "execution-error" };
		}
		const record = envelope as Record<string, unknown>;
		if (record.is_error === true) {
			stderr.write(captured);
			stderr.write(`Error: ${agentId} reported an error result.\n`);
			return { exitCode: 1, reason: "execution-error" };
		}
		const payload = record[plan.capture.field];
		if (payload === undefined || payload === null) {
			stderr.write(captured);
			stderr.write(`Error: ${agentId} response is missing ${plan.capture.field}.\n`);
			return { exitCode: 1, reason: "execution-error" };
		}
		stdout.write(`${JSON.stringify(payload)}\n`);
		return { exitCode: 0, reason: "success" };
	}

	let contents: string;
	try {
		contents = await readFile(plan.capture.path, "utf8");
	} catch {
		contents = "";
	}
	const trimmed = contents.trim();
	if (!trimmed) {
		stderr.write(`Error: ${agentId} did not produce a structured output message.\n`);
		return { exitCode: 1, reason: "execution-error" };
	}
	stdout.write(`${trimmed}\n`);
	return { exitCode: 0, reason: "success" };
}

export async function executeInvocation(
	invocation: ResolvedInvocation,
	options: ExecuteOptions = {},
): Promise<ExecuteResult> {
	const { command, args, warnings, shimArgs, passthroughArgs } = buildAgentArgs(invocation);
	const stderr = options.stderr ?? process.stderr;
	const stdout = options.stdout ?? process.stdout;
	const plan = invocation.structuredOutput;

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
			...(plan ? { structuredOutput: { capture: plan.capture.type } } : {}),
		};
		stderr.write(`OA_TRANSLATION=${JSON.stringify(trace)}\n`);
	}

	for (const warning of warnings) {
		stderr.write(`${warning}\n`);
	}

	const spawn = options.spawn ?? defaultSpawn;
	const baseStdio = options.stdio ?? "inherit";
	const stdio = plan ? withPipedStdout(baseStdio) : baseStdio;

	return await new Promise<ExecuteResult>((resolve) => {
		const child = spawn(command, args, { stdio });

		child.on("error", (error) => {
			stderr.write(`Error: ${error.message}\n`);
			resolve({ exitCode: 1, reason: "execution-error" });
		});

		if (!plan) {
			child.on("exit", (code) => {
				resolve(mapExitCode(code));
			});
			return;
		}

		const chunks: Buffer[] = [];
		const childStdout = child.stdout;
		if (childStdout) {
			if (plan.capture.type === "json-envelope") {
				childStdout.on("data", (chunk: Buffer) => {
					chunks.push(Buffer.from(chunk));
				});
			} else {
				childStdout.on("data", (chunk: Buffer) => {
					stderr.write(chunk);
				});
			}
		}

		child.on("close", (code) => {
			if (!childStdout) {
				stderr.write(`Error: ${invocation.agent.id} stdout was not captured.\n`);
				resolve({ exitCode: 1, reason: "execution-error" });
				return;
			}
			void finalizeStructuredOutput({
				plan,
				agentId: invocation.agent.id,
				code,
				captured: Buffer.concat(chunks).toString("utf8"),
				stdout,
				stderr,
			}).then(resolve);
		});
	});
}
