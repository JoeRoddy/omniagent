import type { StdioOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli/index.js";

type SpawnCall = [string, string[], { stdio: StdioOptions }];

function createSpawnStub(exitCode = 0) {
	const spawn = vi.fn((_command: string, _args: string[], _options: { stdio: StdioOptions }) => {
		const emitter = new EventEmitter();
		process.nextTick(() => {
			emitter.emit("exit", exitCode);
		});
		return emitter;
	});
	return spawn;
}

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-shim-"));
	try {
		await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("CLI shim interactive mode", () => {
	let exitSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
	});

	afterEach(() => {
		exitSpy.mockRestore();
	});

	it("starts interactive mode by default using the configured default agent", async () => {
		await withTempRepo(async (root) => {
			const agentsDir = path.join(root, "agents");
			await mkdir(agentsDir, { recursive: true });
			await writeFile(
				path.join(agentsDir, "omniagent.config.cjs"),
				"module.exports = { defaultAgent: 'codex' };",
				"utf8",
			);

			const spawn = createSpawnStub(0);
			await runCli(["node", "omniagent"], {
				shim: {
					repoRoot: root,
					stdinIsTTY: true,
					spawn,
				},
			});

			expect(spawn).toHaveBeenCalledTimes(1);
			const [command, args] = spawn.mock.calls[0] as SpawnCall;
			expect(command).toBe("codex");
			expect(args).toEqual([
				"--ask-for-approval",
				"on-request",
				"--sandbox",
				"workspace-write",
				"--disable",
				"web_search_request",
			]);
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("applies shared flags in interactive mode when supported", async () => {
		const spawn = createSpawnStub(0);
		await runCli(
			["node", "omniagent", "--agent", "codex", "--model", "gpt-5", "--approval", "prompt"],
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
			"-m",
			"gpt-5",
			"--disable",
			"web_search_request",
		]);
	});

	it("returns invalid usage when no default agent is configured", async () => {
		await withTempRepo(async (root) => {
			const spawn = createSpawnStub(0);
			await runCli(["node", "omniagent"], {
				shim: {
					repoRoot: root,
					stdinIsTTY: true,
					spawn,
				},
			});

			expect(exitSpy).toHaveBeenCalledWith(2);
			expect(spawn).not.toHaveBeenCalled();
		});
	});
});
