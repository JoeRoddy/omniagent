import { EventEmitter } from "node:events";
import { runCli } from "../../src/cli/index.js";

type SpawnCall = [string, string[], { stdio: string }];

function createSpawnStub(exitCode = 0) {
	return vi.fn((_command: string, _args: string[], _options: { stdio: string }) => {
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
		expect(args).toEqual(["-p", "Hello"]);
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
		expect(args).toEqual(["-p", "From stdin"]);
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
		expect(args).toEqual(["-p", "Flag wins"]);
	});
});
