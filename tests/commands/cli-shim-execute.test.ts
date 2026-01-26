import type { StdioOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { executeInvocation } from "../../src/cli/shim/execute.js";
import { parseShimFlags } from "../../src/cli/shim/flags.js";
import { resolveInvocationFromFlags } from "../../src/cli/shim/resolve-invocation.js";

type SpawnCall = [string, string[], { stdio: StdioOptions }];

type InvocationOptions = {
	stdinIsTTY?: boolean;
	stdinText?: string | null;
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

async function buildInvocation(argv: string[], options: InvocationOptions = {}) {
	const flags = parseShimFlags(argv);
	return await resolveInvocationFromFlags({
		flags,
		stdinIsTTY: options.stdinIsTTY ?? true,
		stdinText: options.stdinText ?? null,
		repoRoot: process.cwd(),
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
