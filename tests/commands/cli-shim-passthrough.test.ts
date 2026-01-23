import { EventEmitter } from "node:events";
import { runCli } from "../../src/cli/index.js";
import { runShim } from "../../src/cli/shim/index.js";

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
		expect(args).toEqual(["--some-flag", "--model", "gpt-5"]);
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
});
