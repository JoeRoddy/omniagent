import type { StdioOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { runCli } from "../../src/cli/index.js";
import { runShim } from "../../src/cli/shim/index.js";

type SpawnCall = [string, string[], { stdio: StdioOptions }];

function createSpawnStub(exitCode = 0) {
	return vi.fn((_command: string, _args: string[], _options: { stdio: StdioOptions }) => {
		const emitter = new EventEmitter();
		process.nextTick(() => {
			emitter.emit("exit", exitCode);
		});
		return emitter;
	});
}

describe("CLI shim passthrough", () => {
	let exitSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
	});

	afterEach(() => {
		exitSpy.mockRestore();
	});

	it("passes args after -- verbatim when --agent is provided", async () => {
		const spawn = createSpawnStub(0);
		await runCli(
			["node", "omniagent", "--agent", "codex", "--", "--some-flag", "--model", "gpt-5"],
			{
				shim: {
					stdinIsTTY: true,
					spawn,
				},
			},
		);

		const [, args] = spawn.mock.calls[0] as SpawnCall;
		expect(args).toEqual([
			"--ask-for-approval",
			"on-request",
			"--sandbox",
			"workspace-write",
			"--disable",
			"web_search_request",
			"--some-flag",
			"--model",
			"gpt-5",
		]);
	});

	it("rejects passthrough when --agent is missing", async () => {
		const spawn = createSpawnStub(0);
		await runCli(["node", "omniagent", "--", "--some-flag"], {
			shim: {
				stdinIsTTY: true,
				spawn,
			},
		});

		expect(exitSpy).toHaveBeenCalledWith(2);
		expect(spawn).not.toHaveBeenCalled();
	});

	it("rejects unknown flags before --", async () => {
		const exitCode = await runShim(["--unknown-flag", "--agent", "codex"], {
			stdinIsTTY: true,
		});

		expect(exitCode).toBe(2);
	});

	it("places shim-translated flags before passthrough args", async () => {
		const spawn = createSpawnStub(0);
		await runCli(
			[
				"node",
				"omniagent",
				"-p",
				"Hello",
				"--agent",
				"codex",
				"--approval",
				"auto-edit",
				"--output",
				"json",
				"--",
				"--some-flag",
				"--extra",
				"value",
			],
			{
				shim: {
					stdinIsTTY: true,
					spawn,
				},
			},
		);

		const [, args] = spawn.mock.calls[0] as SpawnCall;
		expect(args).toEqual([
			"exec",
			"--full-auto",
			"--sandbox",
			"workspace-write",
			"--json",
			"--disable",
			"web_search_request",
			"--some-flag",
			"--extra",
			"value",
			"Hello",
		]);
	});

	it.each([
		{
			name: "interactive --flag value",
			argv: ["--agent", "codex", "-m", "gpt-5.3-codex-spark", "--", "--sandbox", "read-only"],
			expected: [
				"--ask-for-approval",
				"on-request",
				"-m",
				"gpt-5.3-codex-spark",
				"--disable",
				"web_search_request",
				"--sandbox",
				"read-only",
			],
		},
		{
			name: "one-shot --flag=value",
			argv: ["--agent", "codex", "-p", "Hello", "--", "--sandbox=read-only"],
			expected: ["exec", "--disable", "web_search_request", "--sandbox=read-only", "Hello"],
		},
	])("lets passthrough replace a shim default in $name mode", async ({ argv, expected }) => {
		const spawn = createSpawnStub(0);
		const exitCode = await runShim(argv, { stdinIsTTY: true, spawn });

		expect(exitCode).toBe(0);
		const [, args] = spawn.mock.calls[0] as SpawnCall;
		expect(args).toEqual(expected);
	});

	it.each([
		{
			name: "explicit shared sandbox",
			argv: ["--agent", "codex", "--sandbox", "workspace-write", "--", "--sandbox", "read-only"],
			expectedOrigin: "explicit shared --sandbox policy",
		},
		{
			name: "sandbox derived from yolo",
			argv: ["--agent", "codex", "--yolo", "--", "--sandbox=read-only"],
			expectedOrigin: "sandbox policy derived from explicit --yolo",
		},
	])("rejects a passthrough collision with $name", async ({ argv, expectedOrigin }) => {
		const spawn = createSpawnStub(0);
		const stderrWrites: string[] = [];
		const stderr = {
			write: (chunk: string) => {
				stderrWrites.push(String(chunk));
				return true;
			},
		} as NodeJS.WriteStream;

		const exitCode = await runShim(argv, { stdinIsTTY: true, spawn, stderr });

		expect(exitCode).toBe(2);
		expect(spawn).not.toHaveBeenCalled();
		const output = stderrWrites.join("");
		expect(output).toContain("Passthrough option --sandbox");
		expect(output).toContain(expectedOrigin);
		expect(output).toContain("Remove one of the conflicting options.");
	});

	it("matches repeatable native options by value without suppressing unrelated values", async () => {
		const unrelatedSpawn = createSpawnStub(0);
		await runShim(["--agent", "codex", "--", "--disable", "apps"], {
			stdinIsTTY: true,
			spawn: unrelatedSpawn,
		});
		const [, unrelatedArgs] = unrelatedSpawn.mock.calls[0] as SpawnCall;
		expect(unrelatedArgs).toEqual([
			"--ask-for-approval",
			"on-request",
			"--sandbox",
			"workspace-write",
			"--disable",
			"web_search_request",
			"--disable",
			"apps",
		]);

		const matchingSpawn = createSpawnStub(0);
		await runShim(["--agent", "codex", "--", "--disable=web_search_request"], {
			stdinIsTTY: true,
			spawn: matchingSpawn,
		});
		const [, matchingArgs] = matchingSpawn.mock.calls[0] as SpawnCall;
		expect(matchingArgs).toEqual([
			"--ask-for-approval",
			"on-request",
			"--sandbox",
			"workspace-write",
			"--disable=web_search_request",
		]);

		const mixedSpawn = createSpawnStub(0);
		await runShim(
			["--agent", "codex", "--", "--disable", "apps", "--disable", "web_search_request"],
			{ stdinIsTTY: true, spawn: mixedSpawn },
		);
		const [, mixedArgs] = mixedSpawn.mock.calls[0] as SpawnCall;
		expect(mixedArgs).toEqual([
			"--ask-for-approval",
			"on-request",
			"--sandbox",
			"workspace-write",
			"--disable",
			"apps",
			"--disable",
			"web_search_request",
		]);
	});

	it.each([
		{
			name: "prompt delivery",
			argv: ["--agent", "claude", "-p", "Hello", "--", "-p", "Other"],
			expectedOrigin: "required one-shot prompt delivery",
		},
		{
			name: "structured output",
			argv: [
				"--agent",
				"claude",
				"-p",
				"Hello",
				"--output-schema",
				'{"type":"object"}',
				"--",
				"--output-format=json",
			],
			expectedOrigin: "required shared --output-schema arguments",
		},
		{
			name: "structured-output fallback",
			argv: [
				"--agent",
				"copilot",
				"-p",
				"Hello",
				"--output-schema",
				'{"type":"object"}',
				"--",
				"--silent",
			],
			expectedOrigin: "required shared --output-schema arguments",
		},
	])("rejects collisions with required $name arguments", async ({ argv, expectedOrigin }) => {
		const spawn = createSpawnStub(0);
		const stderrWrites: string[] = [];
		const stderr = {
			write: (chunk: string) => {
				stderrWrites.push(String(chunk));
				return true;
			},
		} as NodeJS.WriteStream;

		const exitCode = await runShim(argv, { stdinIsTTY: true, spawn, stderr });

		expect(exitCode).toBe(2);
		expect(spawn).not.toHaveBeenCalled();
		expect(stderrWrites.join("")).toContain(expectedOrigin);
	});
});
