import { spawn as defaultSpawn, type StdioOptions } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { StructuredOutputCapture } from "../../lib/targets/config-types.js";
import { buildAgentArgs } from "./build-args.js";
import type { ExitCodeReason } from "./errors.js";
import { buildFallbackPrompt, buildRetryPrompt, extractJsonPayload } from "./fallback-prompts.js";
import type { ResolvedInvocation, StructuredOutputPlan } from "./types.js";

type SpawnFn = typeof defaultSpawn;

type FallbackCapture = Extract<StructuredOutputCapture, { type: "fallback" }>;

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

	if (plan.capture.type === "fallback") {
		return { exitCode: 1, reason: "execution-error" };
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

type CapturedAttempt =
	| { kind: "spawn-error" }
	| { kind: "closed"; code: number | null; captured: string };

function runCapturedAttempt(params: {
	spawn: SpawnFn;
	command: string;
	args: string[];
	stdio: StdioOptions;
	agentId: string;
	stderr: NodeJS.WriteStream;
}): Promise<CapturedAttempt> {
	return new Promise((resolve) => {
		let settled = false;
		const settle = (value: CapturedAttempt) => {
			if (!settled) {
				settled = true;
				resolve(value);
			}
		};
		const child = params.spawn(params.command, params.args, { stdio: params.stdio });
		const chunks: Buffer[] = [];
		const childStdout = child.stdout;
		if (childStdout) {
			childStdout.on("data", (chunk: Buffer) => {
				chunks.push(Buffer.from(chunk));
			});
		}
		child.on("error", (error) => {
			params.stderr.write(`Error: ${error.message}\n`);
			settle({ kind: "spawn-error" });
		});
		child.on("close", (code) => {
			if (!childStdout) {
				params.stderr.write(`Error: ${params.agentId} stdout was not captured.\n`);
				settle({ kind: "spawn-error" });
				return;
			}
			settle({ kind: "closed", code, captured: Buffer.concat(chunks).toString("utf8") });
		});
	});
}

function extractEnvelopeText(params: {
	captured: string;
	field: string;
	agentId: string;
	stderr: NodeJS.WriteStream;
}): { ok: true; text: string } | { ok: false } {
	const { captured, field, agentId, stderr } = params;
	let envelope: unknown;
	try {
		envelope = JSON.parse(captured);
	} catch {
		envelope = undefined;
	}
	if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
		if (captured.length > 0) {
			stderr.write(captured);
		}
		stderr.write(`Error: ${agentId} did not return a JSON envelope.\n`);
		return { ok: false };
	}
	const record = envelope as Record<string, unknown>;
	if (record.error !== undefined && record.error !== null) {
		stderr.write(captured);
		stderr.write(`Error: ${agentId} reported an error result.\n`);
		return { ok: false };
	}
	const payload = record[field];
	if (payload === undefined || payload === null) {
		stderr.write(captured);
		stderr.write(`Error: ${agentId} response is missing ${field}.\n`);
		return { ok: false };
	}
	return { ok: true, text: typeof payload === "string" ? payload : JSON.stringify(payload) };
}

async function runFallbackAttempts(params: {
	invocation: ResolvedInvocation;
	plan: StructuredOutputPlan;
	capture: FallbackCapture;
	options: ExecuteOptions;
	stdout: NodeJS.WriteStream;
	stderr: NodeJS.WriteStream;
}): Promise<ExecuteResult> {
	const { invocation, plan, capture, options, stdout, stderr } = params;
	const agentId = invocation.agent.id;
	const spawn = options.spawn ?? defaultSpawn;
	const stdio = withPipedStdout(options.stdio ?? "inherit");
	const originalPrompt = invocation.prompt ?? "";
	const validate = plan.validate ?? (() => ({ valid: true, errors: [] }));

	let feedback: { output: string; errors: string[] } | null = null;

	for (let attempt = 1; attempt <= capture.maxAttempts; attempt += 1) {
		const attemptPrompt = feedback
			? buildRetryPrompt(originalPrompt, plan.schemaJson, feedback.output, feedback.errors)
			: buildFallbackPrompt(originalPrompt, plan.schemaJson);
		const built = buildAgentArgs({ ...invocation, prompt: attemptPrompt });

		if (attempt === 1) {
			if (options.traceTranslate) {
				const trace = {
					agent: agentId,
					mode: invocation.mode,
					command: built.command,
					args: built.args,
					shimArgs: built.shimArgs,
					passthroughArgs: built.passthroughArgs,
					warnings: built.warnings,
					requests: invocation.requests,
					structuredOutput: { capture: capture.type, maxAttempts: capture.maxAttempts },
				};
				stderr.write(`OA_TRANSLATION=${JSON.stringify(trace)}\n`);
			}
			for (const warning of built.warnings) {
				stderr.write(`${warning}\n`);
			}
			for (const notice of plan.notices ?? []) {
				stderr.write(`${notice}\n`);
			}
		}

		const attemptResult = await runCapturedAttempt({
			spawn,
			command: built.command,
			args: built.args,
			stdio,
			agentId,
			stderr,
		});
		if (attemptResult.kind === "spawn-error") {
			return { exitCode: 1, reason: "execution-error" };
		}
		if (attemptResult.code !== 0) {
			if (attemptResult.captured.length > 0) {
				stderr.write(attemptResult.captured);
			}
			return mapExitCode(attemptResult.code);
		}

		let responseText = attemptResult.captured;
		if (capture.extraction.type === "json-envelope") {
			const outcome = extractEnvelopeText({
				captured: attemptResult.captured,
				field: capture.extraction.field,
				agentId,
				stderr,
			});
			if (!outcome.ok) {
				return { exitCode: 1, reason: "execution-error" };
			}
			responseText = outcome.text;
		}

		const extracted = extractJsonPayload(responseText);
		if (extracted.ok) {
			const result = validate(extracted.value);
			if (result.valid) {
				stdout.write(`${JSON.stringify(extracted.value)}\n`);
				return { exitCode: 0, reason: "success" };
			}
			feedback = { output: responseText, errors: result.errors };
		} else {
			feedback = { output: responseText, errors: [extracted.error] };
		}

		if (attempt < capture.maxAttempts) {
			stderr.write(
				`Attempt ${attempt} failed schema validation; retrying (${attempt + 1}/${capture.maxAttempts}).\n`,
			);
			for (const error of feedback.errors) {
				stderr.write(`- ${error}\n`);
			}
		}
	}

	if (feedback) {
		const lastOutput = feedback.output.trim();
		if (lastOutput.length > 0) {
			stderr.write(`${lastOutput}\n`);
		}
		for (const error of feedback.errors) {
			stderr.write(`- ${error}\n`);
		}
	}
	stderr.write(
		`Error: ${agentId} response failed schema validation after ${capture.maxAttempts} attempts.\n`,
	);
	return { exitCode: 1, reason: "execution-error" };
}

export async function executeInvocation(
	invocation: ResolvedInvocation,
	options: ExecuteOptions = {},
): Promise<ExecuteResult> {
	const stderr = options.stderr ?? process.stderr;
	const stdout = options.stdout ?? process.stdout;
	const plan = invocation.structuredOutput;

	if (plan && plan.capture.type === "fallback") {
		return runFallbackAttempts({
			invocation,
			plan,
			capture: plan.capture,
			options,
			stdout,
			stderr,
		});
	}

	const { command, args, warnings, shimArgs, passthroughArgs } = buildAgentArgs(invocation);

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
	for (const notice of plan?.notices ?? []) {
		stderr.write(`${notice}\n`);
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
