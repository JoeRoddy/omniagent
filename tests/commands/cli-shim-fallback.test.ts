import type { StdioOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { InvalidUsageError } from "../../src/cli/shim/errors.js";
import { executeInvocation } from "../../src/cli/shim/execute.js";
import { extractJsonPayload } from "../../src/cli/shim/fallback-prompts.js";
import { parseShimFlags } from "../../src/cli/shim/flags.js";
import { resolveInvocationFromFlags } from "../../src/cli/shim/resolve-invocation.js";
import { compileSchemaValidator } from "../../src/cli/shim/schema-validator.js";
import { planStructuredOutput } from "../../src/cli/shim/structured-output.js";
import { agyTarget } from "../../src/lib/targets/builtins/antigravity-cli/target.js";
import { claudeTarget } from "../../src/lib/targets/builtins/claude-code/target.js";

const SCHEMA = {
	type: "object",
	properties: { answer: { type: "integer" } },
	required: ["answer"],
	additionalProperties: false,
};
const SCHEMA_JSON = JSON.stringify(SCHEMA);

type SpawnCall = [string, string[], { stdio: StdioOptions }];

type FakeAttempt = {
	exitCode?: number;
	chunks?: string[];
	error?: Error;
};

function createSequenceSpawnStub(attempts: FakeAttempt[]) {
	let call = 0;
	return vi.fn((_command: string, _args: string[], _options: { stdio: StdioOptions }) => {
		const attempt = attempts[Math.min(call, attempts.length - 1)];
		call += 1;
		const stdout = new EventEmitter();
		const child = Object.assign(new EventEmitter(), { stdout });
		process.nextTick(() => {
			if (attempt.error) {
				child.emit("error", attempt.error);
				return;
			}
			for (const chunk of attempt.chunks ?? []) {
				stdout.emit("data", Buffer.from(chunk));
			}
			child.emit("close", attempt.exitCode ?? 0);
		});
		return child;
	});
}

function createWriteCollector() {
	const writes: string[] = [];
	const stream = {
		write: (chunk: string | Uint8Array) => {
			writes.push(String(chunk));
			return true;
		},
	} as NodeJS.WriteStream;
	return { writes, stream };
}

async function buildInvocation(argv: string[]) {
	const flags = parseShimFlags(argv);
	return await resolveInvocationFromFlags({
		flags,
		stdinIsTTY: true,
		stdinText: null,
		repoRoot: process.cwd(),
	});
}

function promptArg(call: SpawnCall): string {
	const args = call[1];
	const index = args.indexOf("-p");
	return index === -1 ? "" : (args[index + 1] ?? "");
}

describe("extractJsonPayload", () => {
	it("parses a bare JSON object", () => {
		expect(extractJsonPayload('{"answer":5}')).toEqual({ ok: true, value: { answer: 5 } });
	});

	it("parses a bare JSON array", () => {
		expect(extractJsonPayload("[1,2]")).toEqual({ ok: true, value: [1, 2] });
	});

	it("parses fenced JSON with and without a language tag", () => {
		expect(extractJsonPayload('```json\n{"answer":5}\n```')).toEqual({
			ok: true,
			value: { answer: 5 },
		});
		expect(extractJsonPayload('```\n{"answer":5}\n```')).toEqual({
			ok: true,
			value: { answer: 5 },
		});
	});

	it("extracts JSON embedded in prose", () => {
		expect(extractJsonPayload('Here you go: {"answer": 5} - enjoy!')).toEqual({
			ok: true,
			value: { answer: 5 },
		});
	});

	it("rejects empty responses", () => {
		expect(extractJsonPayload("  \n ")).toEqual({ ok: false, error: "the response was empty" });
	});

	it("rejects responses without parseable JSON", () => {
		const result = extractJsonPayload("no json here");
		expect(result.ok).toBe(false);
	});
});

describe("compileSchemaValidator", () => {
	it("validates conforming and non-conforming data", () => {
		const validate = compileSchemaValidator(SCHEMA_JSON);
		expect(validate({ answer: 5 })).toEqual({ valid: true, errors: [] });

		const invalid = validate({ answer: "five" });
		expect(invalid.valid).toBe(false);
		expect(invalid.errors).toEqual(["/answer: must be integer"]);
	});

	it("reports root-level errors with a / path", () => {
		const validate = compileSchemaValidator(SCHEMA_JSON);
		const invalid = validate("not an object");
		expect(invalid.valid).toBe(false);
		expect(invalid.errors[0]).toMatch(/^\/: /);
	});

	it("throws InvalidUsageError for uncompilable schemas", () => {
		expect(() => compileSchemaValidator('{"type":"nonsense"}')).toThrow(InvalidUsageError);
	});

	it("compiles schemas declaring the 2020-12 dialect", () => {
		const validate = compileSchemaValidator(
			JSON.stringify({
				$schema: "https://json-schema.org/draft/2020-12/schema",
				type: "array",
				prefixItems: [{ type: "integer" }],
				items: false,
			}),
		);
		expect(validate([5])).toEqual({ valid: true, errors: [] });
		expect(validate(["five"]).valid).toBe(false);
		expect(validate([5, 6]).valid).toBe(false);
	});

	it("compiles schemas declaring the 2019-09 dialect", () => {
		const validate = compileSchemaValidator(
			JSON.stringify({
				$schema: "https://json-schema.org/draft/2019-09/schema",
				...SCHEMA,
			}),
		);
		expect(validate({ answer: 5 })).toEqual({ valid: true, errors: [] });
		expect(validate({ answer: "five" }).valid).toBe(false);
	});

	it("compiles schemas declaring the draft-07 dialect", () => {
		const validate = compileSchemaValidator(
			JSON.stringify({
				$schema: "http://json-schema.org/draft-07/schema#",
				...SCHEMA,
			}),
		);
		expect(validate({ answer: 5 })).toEqual({ valid: true, errors: [] });
	});
});

describe("planStructuredOutput fallback", () => {
	it("builds a prompt fallback plan when no native spec exists", async () => {
		const plan = await planStructuredOutput({
			rawSchema: SCHEMA_JSON,
			mode: "one-shot",
			agentId: "agy",
			spec: undefined,
			fallbackSpec: agyTarget.cli?.flags?.structuredOutputFallback,
		});

		expect(plan?.args).toEqual([]);
		expect(plan?.capture).toEqual({
			type: "fallback",
			extraction: { type: "text" },
			maxAttempts: 3,
		});
		expect(plan?.tempPaths).toEqual([]);
		expect(plan?.validate?.({ answer: 5 })).toEqual({ valid: true, errors: [] });
		expect(plan?.notices).toEqual([
			"Notice: agy lacks native --output-schema support; using prompt-based fallback with client-side validation.",
		]);
	});

	it("honors a json-envelope fallback spec from a custom target", async () => {
		const plan = await planStructuredOutput({
			rawSchema: SCHEMA_JSON,
			mode: "one-shot",
			agentId: "acme",
			spec: undefined,
			fallbackSpec: {
				args: ["--output-format", "json"],
				extraction: { type: "json-envelope", field: "response" },
			},
		});

		expect(plan?.args).toEqual(["--output-format", "json"]);
		expect(plan?.capture).toEqual({
			type: "fallback",
			extraction: { type: "json-envelope", field: "response" },
			maxAttempts: 3,
		});
	});

	it("defaults to text extraction with no fallback spec", async () => {
		const plan = await planStructuredOutput({
			rawSchema: SCHEMA_JSON,
			mode: "one-shot",
			agentId: "custom",
			spec: undefined,
		});

		expect(plan?.args).toEqual([]);
		expect(plan?.capture).toEqual({
			type: "fallback",
			extraction: { type: "text" },
			maxAttempts: 3,
		});
	});

	it("honors --output-schema-retries for fallback plans", async () => {
		const plan = await planStructuredOutput({
			rawSchema: SCHEMA_JSON,
			mode: "one-shot",
			agentId: "agy",
			spec: undefined,
			retries: 0,
		});
		expect(plan?.capture).toMatchObject({ type: "fallback", maxAttempts: 1 });
	});

	it("warns when retries are requested for a native agent", async () => {
		const plan = await planStructuredOutput({
			rawSchema: SCHEMA_JSON,
			mode: "one-shot",
			agentId: "claude",
			spec: claudeTarget.cli?.flags?.structuredOutput,
			retries: 3,
		});
		expect(plan?.capture.type).toBe("json-envelope");
		expect(plan?.notices).toEqual([
			"Warning: claude uses native --output-schema support; ignoring --output-schema-retries.",
		]);
	});

	it("rejects targets that cannot deliver a prompt", async () => {
		await expect(
			planStructuredOutput({
				rawSchema: SCHEMA_JSON,
				mode: "one-shot",
				agentId: "acme",
				spec: undefined,
				promptDeliverable: false,
			}),
		).rejects.toThrow(
			"acme cannot use the --output-schema fallback: target defines no prompt flag.",
		);
	});

	it("rejects uncompilable schemas before spawning", async () => {
		await expect(
			planStructuredOutput({
				rawSchema: '{"type":"nonsense"}',
				mode: "one-shot",
				agentId: "agy",
				spec: undefined,
			}),
		).rejects.toBeInstanceOf(InvalidUsageError);
	});
});

describe("fallback execution", () => {
	it("succeeds on the first attempt for agy and prints only the payload", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"agy",
			"-p",
			"Give me five",
			"--output-schema",
			SCHEMA_JSON,
		]);
		const spawn = createSequenceSpawnStub([{ chunks: ['```json\n{"answer":5}\n```'] }]);
		const stdout = createWriteCollector();
		const stderr = createWriteCollector();

		const result = await executeInvocation(invocation, {
			spawn,
			stdout: stdout.stream,
			stderr: stderr.stream,
		});

		expect(result).toEqual({ exitCode: 0, reason: "success" });
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(stdout.writes).toEqual(['{"answer":5}\n']);

		const call = spawn.mock.calls[0] as SpawnCall;
		expect(call[0]).toBe("agy");
		expect(call[1]).not.toContain("--output-format");
		expect(call[2]).toEqual({ stdio: ["inherit", "pipe", "inherit"] });
		const prompt = promptArg(call);
		expect(prompt).toContain("Give me five");
		expect(prompt).toContain(SCHEMA_JSON);
		expect(stderr.writes.join("")).toContain("Notice: agy lacks native --output-schema support");
	});

	it("resolves the gemini alias to the agy target", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"gemini",
			"-p",
			"Give me five",
			"--output-schema",
			SCHEMA_JSON,
		]);
		const spawn = createSequenceSpawnStub([{ chunks: ['{"answer":5}'] }]);
		const stdout = createWriteCollector();
		const stderr = createWriteCollector();

		const result = await executeInvocation(invocation, {
			spawn,
			stdout: stdout.stream,
			stderr: stderr.stream,
		});

		expect(result).toEqual({ exitCode: 0, reason: "success" });
		const call = spawn.mock.calls[0] as SpawnCall;
		expect(call[0]).toBe("agy");
		expect(stdout.writes).toEqual(['{"answer":5}\n']);
		expect(stderr.writes.join("")).toContain("Notice: agy lacks native --output-schema support");
	});

	it("retries with validation feedback and succeeds", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"agy",
			"-p",
			"Give me five",
			"--output-schema",
			SCHEMA_JSON,
		]);
		const spawn = createSequenceSpawnStub([
			{ chunks: ['{"answer":"five"}'] },
			{ chunks: ['{"answer":5}'] },
		]);
		const stdout = createWriteCollector();
		const stderr = createWriteCollector();

		const result = await executeInvocation(invocation, {
			spawn,
			stdout: stdout.stream,
			stderr: stderr.stream,
		});

		expect(result).toEqual({ exitCode: 0, reason: "success" });
		expect(spawn).toHaveBeenCalledTimes(2);
		expect(stdout.writes).toEqual(['{"answer":5}\n']);

		const retryPrompt = promptArg(spawn.mock.calls[1] as SpawnCall);
		expect(retryPrompt).toContain("Your previous response failed validation.");
		expect(retryPrompt).toContain('{"answer":"five"}');
		expect(retryPrompt).toContain("/answer: must be integer");

		const stderrText = stderr.writes.join("");
		expect(stderrText).toContain("Attempt 1 failed schema validation; retrying (2/3).");
		const notices = stderr.writes.filter((chunk) => chunk.startsWith("Notice:"));
		expect(notices).toHaveLength(1);
	});

	it("exits 1 after exhausting all attempts", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"agy",
			"-p",
			"Give me five",
			"--output-schema",
			SCHEMA_JSON,
		]);
		const spawn = createSequenceSpawnStub([{ chunks: ['{"answer":"five"}'] }]);
		const stdout = createWriteCollector();
		const stderr = createWriteCollector();

		const result = await executeInvocation(invocation, {
			spawn,
			stdout: stdout.stream,
			stderr: stderr.stream,
		});

		expect(result).toEqual({ exitCode: 1, reason: "execution-error" });
		expect(spawn).toHaveBeenCalledTimes(3);
		expect(stdout.writes).toEqual([]);
		const stderrText = stderr.writes.join("");
		expect(stderrText).toContain('{"answer":"five"}');
		expect(stderrText).toContain("- /answer: must be integer");
		expect(stderrText).toContain("Error: agy response failed schema validation after 3 attempts.");
	});

	it("does not retry when the agent exits nonzero", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"agy",
			"-p",
			"Give me five",
			"--output-schema",
			SCHEMA_JSON,
		]);
		const spawn = createSequenceSpawnStub([{ exitCode: 2, chunks: ["agent usage error"] }]);
		const stdout = createWriteCollector();
		const stderr = createWriteCollector();

		const result = await executeInvocation(invocation, {
			spawn,
			stdout: stdout.stream,
			stderr: stderr.stream,
		});

		expect(result).toEqual({ exitCode: 2, reason: "invalid-usage" });
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(stderr.writes.join("")).toContain("agent usage error");
	});

	// The json-envelope fallback extraction is no longer used by any builtin target,
	// but remains supported for custom targets; override the capture to exercise it.
	async function buildEnvelopeFallbackInvocation() {
		const invocation = await buildInvocation([
			"--agent",
			"agy",
			"-p",
			"Give me five",
			"--output-schema",
			SCHEMA_JSON,
		]);
		if (invocation.structuredOutput) {
			invocation.structuredOutput.capture = {
				type: "fallback",
				extraction: { type: "json-envelope", field: "response" },
				maxAttempts: 3,
			};
		}
		return invocation;
	}

	it("does not retry when the envelope reports an error", async () => {
		const invocation = await buildEnvelopeFallbackInvocation();
		const spawn = createSequenceSpawnStub([
			{
				chunks: [
					JSON.stringify({ response: null, error: { type: "ApiError", message: "boom", code: 1 } }),
				],
			},
		]);
		const stdout = createWriteCollector();
		const stderr = createWriteCollector();

		const result = await executeInvocation(invocation, {
			spawn,
			stdout: stdout.stream,
			stderr: stderr.stream,
		});

		expect(result).toEqual({ exitCode: 1, reason: "execution-error" });
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(stderr.writes.join("")).toContain("Error: agy reported an error result.");
	});

	it("does not retry when the envelope is unparseable", async () => {
		const invocation = await buildEnvelopeFallbackInvocation();
		const spawn = createSequenceSpawnStub([{ chunks: ["not an envelope"] }]);
		const stderr = createWriteCollector();

		const result = await executeInvocation(invocation, {
			spawn,
			stdout: createWriteCollector().stream,
			stderr: stderr.stream,
		});

		expect(result).toEqual({ exitCode: 1, reason: "execution-error" });
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(stderr.writes.join("")).toContain("Error: agy did not return a JSON envelope.");
	});

	it("captures copilot text output with --silent and retries on empty responses", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"copilot",
			"-p",
			"Give me five",
			"--output-schema",
			SCHEMA_JSON,
			"--output-schema-retries",
			"1",
		]);
		const spawn = createSequenceSpawnStub([
			{ chunks: [] },
			{ chunks: ['The result is:\n```json\n{"answer": 5}\n```\n'] },
		]);
		const stdout = createWriteCollector();
		const stderr = createWriteCollector();

		const result = await executeInvocation(invocation, {
			spawn,
			stdout: stdout.stream,
			stderr: stderr.stream,
		});

		expect(result).toEqual({ exitCode: 0, reason: "success" });
		expect(spawn).toHaveBeenCalledTimes(2);
		expect(stdout.writes).toEqual(['{"answer":5}\n']);

		const call = spawn.mock.calls[0] as SpawnCall;
		expect(call[0]).toBe("copilot");
		expect(call[1]).toContain("--silent");
		expect(stderr.writes.join("")).toContain("- the response was empty");
	});

	it("exits 1 without retrying when spawn fails", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"agy",
			"-p",
			"Give me five",
			"--output-schema",
			SCHEMA_JSON,
		]);
		const spawn = createSequenceSpawnStub([{ error: new Error("spawn agy ENOENT") }]);
		const stderr = createWriteCollector();

		const result = await executeInvocation(invocation, {
			spawn,
			stdout: createWriteCollector().stream,
			stderr: stderr.stream,
		});

		expect(result).toEqual({ exitCode: 1, reason: "execution-error" });
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(stderr.writes.join("")).toContain("spawn agy ENOENT");
	});

	it("makes exactly one attempt with --output-schema-retries 0", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"agy",
			"-p",
			"Give me five",
			"--output-schema",
			SCHEMA_JSON,
			"--output-schema-retries",
			"0",
		]);
		const spawn = createSequenceSpawnStub([{ chunks: ["no json at all"] }]);
		const stderr = createWriteCollector();

		const result = await executeInvocation(invocation, {
			spawn,
			stdout: createWriteCollector().stream,
			stderr: stderr.stream,
		});

		expect(result).toEqual({ exitCode: 1, reason: "execution-error" });
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(stderr.writes.join("")).toContain(
			"Error: agy response failed schema validation after 1 attempts.",
		);
	});

	it("emits fallback trace metadata once", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"agy",
			"-p",
			"Give me five",
			"--output-schema",
			SCHEMA_JSON,
		]);
		const spawn = createSequenceSpawnStub([
			{ chunks: ['{"answer":"five"}'] },
			{ chunks: ['{"answer":5}'] },
		]);
		const stderr = createWriteCollector();

		const result = await executeInvocation(invocation, {
			spawn,
			stdout: createWriteCollector().stream,
			stderr: stderr.stream,
			traceTranslate: true,
		});

		expect(result.exitCode).toBe(0);
		const traceLines = stderr.writes.filter((chunk) => chunk.startsWith("OA_TRANSLATION="));
		expect(traceLines).toHaveLength(1);
		const trace = JSON.parse(traceLines[0].slice("OA_TRANSLATION=".length));
		expect(trace.structuredOutput).toEqual({ capture: "fallback", maxAttempts: 3 });
	});
});
