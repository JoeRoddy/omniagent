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

describe("CLI shim one-shot mode", () => {
	let exitSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
	});

	afterEach(() => {
		exitSpy.mockRestore();
	});

	it("runs one-shot mode when --prompt is provided", async () => {
		const spawn = createSpawnStub(0);
		await runCli(["node", "omniagent", "-p", "Hello", "--agent", "codex"], {
			shim: {
				stdinIsTTY: true,
				spawn,
			},
		});

		const [, args] = spawn.mock.calls[0] as SpawnCall;
		expect(args).toEqual([
			"exec",
			"--sandbox",
			"workspace-write",
			"--disable",
			"web_search_request",
			"Hello",
		]);
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it("uses piped stdin when --prompt is not provided", async () => {
		const spawn = createSpawnStub(0);
		await runCli(["node", "omniagent", "--agent", "codex"], {
			shim: {
				stdinIsTTY: false,
				stdinText: "From stdin",
				spawn,
			},
		});

		const [, args] = spawn.mock.calls[0] as SpawnCall;
		expect(args).toEqual([
			"exec",
			"--sandbox",
			"workspace-write",
			"--disable",
			"web_search_request",
			"From stdin",
		]);
	});

	it("prefers --prompt over piped stdin when both are present", async () => {
		const spawn = createSpawnStub(0);
		await runCli(["node", "omniagent", "--prompt", "Flag wins", "--agent", "codex"], {
			shim: {
				stdinIsTTY: false,
				stdinText: "Piped text",
				spawn,
			},
		});

		const [, args] = spawn.mock.calls[0] as SpawnCall;
		expect(args).toEqual([
			"exec",
			"--sandbox",
			"workspace-write",
			"--disable",
			"web_search_request",
			"Flag wins",
		]);
	});

	it("ignores piped stdin when --prompt is explicit", async () => {
		const spawn = createSpawnStub(0);
		await runCli(["node", "omniagent", "--prompt", "Use prompt", "--agent", "codex"], {
			shim: {
				stdinIsTTY: false,
				stdinText: "Piped text",
				spawn,
			},
		});

		const [, , options] = spawn.mock.calls[0] as SpawnCall;
		expect(options).toEqual({ stdio: ["ignore", "inherit", "inherit"] });
	});

	it("applies shared flags in one-shot mode and warns on unsupported ones", async () => {
		const spawn = createSpawnStub(0);
		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		await runCli(
			[
				"node",
				"omniagent",
				"-p",
				"Ship it",
				"--agent",
				"claude",
				"--approval",
				"auto-edit",
				"--output",
				"stream-json",
				"--sandbox",
				"off",
				"--web",
				"on",
				"--model",
				"claude-3-opus",
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
			"--output-format",
			"stream-json",
			"--verbose",
			"--model",
			"claude-3-opus",
			"-p",
			"Ship it",
		]);

		const output = stderrSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
		expect(output).toContain("does not support --sandbox (off)");
		expect(output).toContain("does not support --web (on)");
		expect(output).toContain("does not support --approval (auto-edit)");
		expect(output).not.toContain("does not support --model");
		expect(spawn).toHaveBeenCalledTimes(1);

		stderrSpy.mockRestore();
	});

	it("passes --approval auto-edit in one-shot mode for automation", async () => {
		const spawn = createSpawnStub(0);
		await runCli(
			["node", "omniagent", "-p", "Run automation", "--agent", "codex", "--approval", "auto-edit"],
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
			"--disable",
			"web_search_request",
			"Run automation",
		]);
	});

	it("passes --yolo in one-shot mode without prompting", async () => {
		const spawn = createSpawnStub(0);
		await runCli(["node", "omniagent", "-p", "No prompts", "--agent", "codex", "--yolo"], {
			shim: {
				stdinIsTTY: true,
				spawn,
			},
		});

		const [, args] = spawn.mock.calls[0] as SpawnCall;
		expect(args).toEqual([
			"exec",
			"--yolo",
			"--sandbox",
			"danger-full-access",
			"--disable",
			"web_search_request",
			"No prompts",
		]);
	});
});
