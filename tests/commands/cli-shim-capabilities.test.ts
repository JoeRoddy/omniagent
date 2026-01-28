import type { StdioOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { runCli } from "../../src/cli/index.js";

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

describe("CLI shim capability warnings", () => {
	let exitSpy: ReturnType<typeof vi.spyOn>;
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
		stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	});

	afterEach(() => {
		exitSpy.mockRestore();
		stderrSpy.mockRestore();
	});

	it("warns when unsupported flags are requested", async () => {
		const spawn = createSpawnStub(0);
		await runCli(
			[
				"node",
				"omniagent",
				"--agent",
				"claude",
				"--output",
				"json",
				"--sandbox",
				"off",
				"--web",
				"on",
				"--model",
				"claude-opus",
			],
			{
				shim: {
					stdinIsTTY: true,
					spawn,
				},
			},
		);

		const output = stderrSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
		expect(output).toContain("does not support --output (json)");
		expect(output).toContain("does not support --sandbox (off)");
		expect(output).toContain("does not support --web (on)");
		expect(output).not.toContain("does not support --model");
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it("passes model flags for agents that support them", async () => {
		const spawn = createSpawnStub(0);
		await runCli(["node", "omniagent", "--agent", "copilot", "--model", "gpt-5"], {
			shim: {
				stdinIsTTY: true,
				spawn,
			},
		});

		const output = stderrSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
		expect(output).not.toContain("does not support --model");

		const [, args] = spawn.mock.calls[0] as SpawnCall;
		expect(args).toEqual(["--model", "gpt-5"]);
		expect(spawn).toHaveBeenCalledTimes(1);
	});

	it("uses per-agent prompt flag mappings", async () => {
		const spawn = createSpawnStub(0);
		await runCli(["node", "omniagent", "-p", "Hello Gemini", "--agent", "gemini"], {
			shim: {
				stdinIsTTY: true,
				spawn,
			},
		});

		const [, args] = spawn.mock.calls[0] as SpawnCall;
		expect(args).toEqual(["--approval-mode", "default", "--sandbox", "-p", "Hello Gemini"]);
	});
});
