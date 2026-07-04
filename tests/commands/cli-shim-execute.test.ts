import type { StdioOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeInvocation } from "../../src/cli/shim/execute.js";
import { parseShimFlags } from "../../src/cli/shim/flags.js";
import { resolveInvocationFromFlags } from "../../src/cli/shim/resolve-invocation.js";

type SpawnCall = [string, string[], { stdio: StdioOptions }];

type InvocationOptions = {
	stdinIsTTY?: boolean;
	stdinText?: string | null;
	tempDir?: string;
};

function createSpawnStub(exitCode = 0) {
	return vi.fn((_command: string, _args: string[], _options: { stdio: StdioOptions }) => {
		const emitter = new EventEmitter();
		process.nextTick(() => {
			emitter.emit("exit", exitCode);
		});
		return emitter;
	});
}

function createCaptureSpawnStub(exitCode: number, chunks: string[]) {
	return vi.fn((_command: string, _args: string[], _options: { stdio: StdioOptions }) => {
		const stdout = new EventEmitter();
		const child = Object.assign(new EventEmitter(), { stdout });
		process.nextTick(() => {
			for (const chunk of chunks) {
				stdout.emit("data", Buffer.from(chunk));
			}
			child.emit("close", exitCode);
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

async function buildInvocation(argv: string[], options: InvocationOptions = {}) {
	const flags = parseShimFlags(argv);
	return await resolveInvocationFromFlags({
		flags,
		stdinIsTTY: options.stdinIsTTY ?? true,
		stdinText: options.stdinText ?? null,
		repoRoot: process.cwd(),
		tempDir: options.tempDir,
	});
}

describe("CLI shim execution", () => {
	it.each([
		"json",
		"stream-json",
	])("passes %s output flags through with stdio inherit", async (format) => {
		const invocation = await buildInvocation([
			"--agent",
			"codex",
			"--output",
			format,
			"-p",
			"Hello",
		]);
		const spawn = createSpawnStub(0);
		const stderr = { write: vi.fn(() => true) } as unknown as NodeJS.WriteStream;

		const result = await executeInvocation(invocation, { spawn, stderr });

		const [command, args, options] = spawn.mock.calls[0] as SpawnCall;
		expect(command).toBe("codex");
		expect(args).toEqual([
			"exec",
			"--sandbox",
			"workspace-write",
			"--json",
			"--disable",
			"web_search_request",
			"Hello",
		]);
		expect(options).toEqual({ stdio: "inherit" });
		expect(result).toEqual({ exitCode: 0, reason: "success" });
	});

	it.each([
		"json",
		"stream-json",
	])("maps copilot %s output to jsonl with stdio inherit", async (format) => {
		const invocation = await buildInvocation([
			"--agent",
			"copilot",
			"--output",
			format,
			"-p",
			"Hello",
		]);
		const spawn = createSpawnStub(0);
		const stderr = { write: vi.fn(() => true) } as unknown as NodeJS.WriteStream;

		const result = await executeInvocation(invocation, { spawn, stderr });

		const [command, args, options] = spawn.mock.calls[0] as SpawnCall;
		expect(command).toBe("copilot");
		expect(args).toEqual(["--output-format", "json", "-p", "Hello"]);
		expect(options).toEqual({ stdio: "inherit" });
		expect(result).toEqual({ exitCode: 0, reason: "success" });
	});

	it("warns when output is unsupported but still executes with stdio inherit", async () => {
		const invocation = await buildInvocation(["--agent", "claude", "--output", "stream-json"]);
		const spawn = createSpawnStub(0);
		const stderrWrite = vi.fn(() => true);
		const stderr = { write: stderrWrite } as unknown as NodeJS.WriteStream;

		const result = await executeInvocation(invocation, { spawn, stderr });

		const output = stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
		expect(output).toContain("does not support --output (stream-json)");

		const [, args, options] = spawn.mock.calls[0] as SpawnCall;
		expect(args).toEqual([]);
		expect(options).toEqual({ stdio: "inherit" });
		expect(result.exitCode).toBe(0);
	});

	it("returns execution error when spawn emits error", async () => {
		const invocation = await buildInvocation(["--agent", "codex"]);
		const spawn = vi.fn((_command: string, _args: string[], _options: { stdio: StdioOptions }) => {
			const emitter = new EventEmitter();
			process.nextTick(() => {
				emitter.emit("error", new Error("boom"));
			});
			return emitter;
		});
		const stderrWrite = vi.fn(() => true);
		const stderr = { write: stderrWrite } as unknown as NodeJS.WriteStream;

		const result = await executeInvocation(invocation, { spawn, stderr });

		const output = stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
		expect(output).toContain("Error: boom");
		expect(result).toEqual({ exitCode: 1, reason: "execution-error" });
	});

	it("returns blocked exit code when invocation is blocked", async () => {
		vi.resetModules();
		const { BlockedError } = await import("../../src/cli/shim/errors.js");
		vi.doMock("../../src/cli/shim/resolve-invocation.js", () => ({
			resolveInvocationFromFlags: async () => {
				throw new BlockedError("Blocked by approval policy.");
			},
		}));

		const { runShim } = await import("../../src/cli/shim/index.js");
		const stderrWrites: string[] = [];
		const stderr = {
			write: (chunk: string) => {
				stderrWrites.push(String(chunk));
				return true;
			},
		} as NodeJS.WriteStream;

		const exitCode = await runShim(["--agent", "codex"], {
			stdinIsTTY: true,
			stderr,
			repoRoot: process.cwd(),
		});

		expect(exitCode).toBe(3);
		expect(stderrWrites.join("")).toContain("Blocked by approval policy.");

		vi.doUnmock("../../src/cli/shim/resolve-invocation.js");
	});

	it.each([
		{ label: "invalid usage", code: 2, reason: "invalid-usage" },
		{ label: "blocked", code: 3, reason: "blocked" },
	])("propagates %s exit codes from the agent", async ({ code, reason }) => {
		const invocation = await buildInvocation(["--agent", "codex"]);
		const spawn = createSpawnStub(code);
		const stderr = { write: vi.fn(() => true) } as unknown as NodeJS.WriteStream;

		const result = await executeInvocation(invocation, { spawn, stderr });

		const [, , options] = spawn.mock.calls[0] as SpawnCall;
		expect(options).toEqual({ stdio: "inherit" });
		expect(result).toEqual({ exitCode: code, reason });
	});

	it("prints only the structured payload for claude schema runs", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"claude",
			"--output-schema",
			'{"type":"object"}',
			"-p",
			"Hello",
		]);
		const envelope = JSON.stringify({
			type: "result",
			is_error: false,
			structured_output: { answer: "hi" },
		});
		const spawn = createCaptureSpawnStub(0, [envelope.slice(0, 10), envelope.slice(10)]);
		const stdout = createWriteCollector();
		const stderr = createWriteCollector();

		const result = await executeInvocation(invocation, {
			spawn,
			stdout: stdout.stream,
			stderr: stderr.stream,
		});

		const [, , options] = spawn.mock.calls[0] as SpawnCall;
		expect(options).toEqual({ stdio: ["inherit", "pipe", "inherit"] });
		expect(stdout.writes.join("")).toBe('{"answer":"hi"}\n');
		expect(result).toEqual({ exitCode: 0, reason: "success" });
	});

	it("fails when the claude envelope reports an error", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"claude",
			"--output-schema",
			'{"type":"object"}',
			"-p",
			"Hello",
		]);
		const envelope = JSON.stringify({ type: "result", is_error: true, result: "boom" });
		const spawn = createCaptureSpawnStub(0, [envelope]);
		const stdout = createWriteCollector();
		const stderr = createWriteCollector();

		const result = await executeInvocation(invocation, {
			spawn,
			stdout: stdout.stream,
			stderr: stderr.stream,
		});

		expect(stdout.writes).toEqual([]);
		expect(stderr.writes.join("")).toContain(envelope);
		expect(stderr.writes.join("")).toContain("Error: claude reported an error result.");
		expect(result).toEqual({ exitCode: 1, reason: "execution-error" });
	});

	it("fails when the claude envelope is missing structured output", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"claude",
			"--output-schema",
			'{"type":"object"}',
			"-p",
			"Hello",
		]);
		const spawn = createCaptureSpawnStub(0, ['{"type":"result","structured_output":null}']);
		const stdout = createWriteCollector();
		const stderr = createWriteCollector();

		const result = await executeInvocation(invocation, {
			spawn,
			stdout: stdout.stream,
			stderr: stderr.stream,
		});

		expect(stdout.writes).toEqual([]);
		expect(stderr.writes.join("")).toContain(
			"Error: claude response is missing structured_output.",
		);
		expect(result).toEqual({ exitCode: 1, reason: "execution-error" });
	});

	it("fails when claude stdout is not a JSON envelope", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"claude",
			"--output-schema",
			'{"type":"object"}',
			"-p",
			"Hello",
		]);
		const spawn = createCaptureSpawnStub(0, ["plain text output"]);
		const stdout = createWriteCollector();
		const stderr = createWriteCollector();

		const result = await executeInvocation(invocation, {
			spawn,
			stdout: stdout.stream,
			stderr: stderr.stream,
		});

		expect(stdout.writes).toEqual([]);
		expect(stderr.writes.join("")).toContain("Error: claude did not return a JSON envelope.");
		expect(result).toEqual({ exitCode: 1, reason: "execution-error" });
	});

	it("dumps captured stdout to stderr when a schema run exits nonzero", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"claude",
			"--output-schema",
			'{"type":"object"}',
			"-p",
			"Hello",
		]);
		const spawn = createCaptureSpawnStub(1, ["diagnostic output"]);
		const stdout = createWriteCollector();
		const stderr = createWriteCollector();

		const result = await executeInvocation(invocation, {
			spawn,
			stdout: stdout.stream,
			stderr: stderr.stream,
		});

		expect(stdout.writes).toEqual([]);
		expect(stderr.writes.join("")).toContain("diagnostic output");
		expect(result).toEqual({ exitCode: 1, reason: "execution-error" });
	});

	it("prints the codex last message and forwards the session log to stderr", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "oa-exec-test-"));
		try {
			const invocation = await buildInvocation(
				["--agent", "codex", "--output-schema", '{"type":"object"}', "-p", "Hello"],
				{ tempDir },
			);
			const plan = invocation.structuredOutput;
			if (!plan || plan.capture.type !== "last-message-file") {
				throw new Error("expected a codex last-message plan");
			}
			await writeFile(plan.capture.path, '{"answer":"hi"}\n', "utf8");

			const spawn = createCaptureSpawnStub(0, ["session log line\n"]);
			const stdout = createWriteCollector();
			const stderr = createWriteCollector();

			const result = await executeInvocation(invocation, {
				spawn,
				stdout: stdout.stream,
				stderr: stderr.stream,
			});

			expect(stderr.writes.join("")).toContain("session log line");
			expect(stdout.writes.join("")).toBe('{"answer":"hi"}\n');
			expect(result).toEqual({ exitCode: 0, reason: "success" });
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	it("fails when codex does not write a last message", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "oa-exec-test-"));
		try {
			const invocation = await buildInvocation(
				["--agent", "codex", "--output-schema", '{"type":"object"}', "-p", "Hello"],
				{ tempDir },
			);
			const spawn = createCaptureSpawnStub(0, []);
			const stdout = createWriteCollector();
			const stderr = createWriteCollector();

			const result = await executeInvocation(invocation, {
				spawn,
				stdout: stdout.stream,
				stderr: stderr.stream,
			});

			expect(stdout.writes).toEqual([]);
			expect(stderr.writes.join("")).toContain(
				"Error: codex did not produce a structured output message.",
			);
			expect(result).toEqual({ exitCode: 1, reason: "execution-error" });
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	it("includes structured output metadata in the translation trace", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"claude",
			"--output-schema",
			'{"type":"object"}',
			"-p",
			"Hello",
		]);
		const envelope = JSON.stringify({ structured_output: {} });
		const spawn = createCaptureSpawnStub(0, [envelope]);
		const stdout = createWriteCollector();
		const stderr = createWriteCollector();

		const result = await executeInvocation(invocation, {
			spawn,
			stdout: stdout.stream,
			stderr: stderr.stream,
			traceTranslate: true,
		});

		const traceLine = stderr.writes.find((line) => line.startsWith("OA_TRANSLATION="));
		expect(traceLine).toBeDefined();
		const payload = JSON.parse(traceLine?.replace("OA_TRANSLATION=", "").trim() ?? "{}");
		expect(payload.structuredOutput).toEqual({ capture: "json-envelope" });
		expect(result.exitCode).toBe(0);
	});

	it("emits a translation trace when enabled", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"codex",
			"--output",
			"json",
			"-p",
			"Hello",
		]);
		const spawn = createSpawnStub(0);
		const stderrWrites: string[] = [];
		const stderr = {
			write: (chunk: string) => {
				stderrWrites.push(String(chunk));
				return true;
			},
		} as NodeJS.WriteStream;

		const result = await executeInvocation(invocation, { spawn, stderr, traceTranslate: true });

		const traceLine = stderrWrites.find((line) => line.startsWith("OA_TRANSLATION="));
		expect(traceLine).toBeDefined();

		const payload = JSON.parse(traceLine?.replace("OA_TRANSLATION=", "").trim() ?? "{}");
		expect(payload.agent).toBe("codex");
		expect(payload.mode).toBe("one-shot");
		expect(payload.command).toBe("codex");
		expect(payload.args).toEqual([
			"exec",
			"--sandbox",
			"workspace-write",
			"--json",
			"--disable",
			"web_search_request",
			"Hello",
		]);
		expect(result.exitCode).toBe(0);
	});
});
