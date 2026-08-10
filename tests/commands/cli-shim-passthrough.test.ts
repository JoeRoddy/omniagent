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
			"-c",
			'web_search="disabled"',
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
			"-c",
			'web_search="disabled"',
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
				"-c",
				'web_search="disabled"',
				"--sandbox",
				"read-only",
			],
		},
		{
			name: "one-shot --flag=value",
			argv: ["--agent", "codex", "-p", "Hello", "--", "--sandbox=read-only"],
			expected: ["exec", "-c", 'web_search="disabled"', "--sandbox=read-only", "Hello"],
		},
		{
			name: "interactive attached short-option value",
			argv: ["--agent", "codex", "--", "-sread-only"],
			expected: ["--ask-for-approval", "on-request", "-c", 'web_search="disabled"', "-sread-only"],
		},
		{
			name: "interactive full-auto preset",
			argv: ["--agent", "codex", "--", "--full-auto"],
			expected: ["-c", 'web_search="disabled"', "--full-auto"],
		},
		{
			name: "interactive canonical yolo alias",
			argv: ["--agent", "codex", "--", "--dangerously-bypass-approvals-and-sandbox"],
			expected: ["-c", 'web_search="disabled"', "--dangerously-bypass-approvals-and-sandbox"],
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
			expectedOption: "--sandbox",
			expectedOrigin: "explicit shared --sandbox policy",
		},
		{
			name: "sandbox derived from yolo",
			argv: ["--agent", "codex", "--yolo", "--", "--sandbox=read-only"],
			expectedOption: "--sandbox",
			expectedOrigin: "sandbox policy derived from explicit --yolo",
		},
		{
			name: "explicit sandbox plus canonical yolo alias",
			argv: [
				"--agent",
				"codex",
				"--sandbox",
				"workspace-write",
				"--",
				"--dangerously-bypass-approvals-and-sandbox",
			],
			expectedOption: "--dangerously-bypass-approvals-and-sandbox",
			expectedOrigin: "explicit shared --sandbox policy",
		},
		{
			name: "explicit output plus experimental JSON alias",
			argv: ["--agent", "codex", "--output", "text", "-p", "Hello", "--", "--experimental-json"],
			expectedOption: "--experimental-json",
			expectedOrigin: "explicit shared --output format",
		},
		{
			name: "explicit sandbox plus full-auto preset",
			argv: ["--agent", "codex", "--sandbox", "off", "--", "--full-auto"],
			expectedOption: "--full-auto",
			expectedOrigin: "explicit shared --sandbox policy",
		},
		{
			name: "explicit sandbox taking precedence over yolo derivation",
			argv: [
				"--agent",
				"codex",
				"--yolo",
				"--sandbox",
				"workspace-write",
				"--",
				"--sandbox=read-only",
			],
			expectedOption: "--sandbox",
			expectedOrigin: "explicit shared --sandbox policy",
		},
		{
			name: "explicit web setting with separated short config",
			argv: ["--agent", "codex", "--web", "off", "--", "-c", 'web_search="disabled"'],
			expectedOption: "-c web_search=*",
			expectedOrigin: "explicit shared --web setting",
		},
		{
			name: "explicit web setting with a different short config value",
			argv: ["--agent", "codex", "--web", "off", "--", "-c", 'web_search="live"'],
			expectedOption: "-c web_search=*",
			expectedOrigin: "explicit shared --web setting",
		},
		{
			name: "explicit web setting with attached short config",
			argv: ["--agent", "codex", "--web", "off", "--", "-cweb_search=cached"],
			expectedOption: "-c web_search=*",
			expectedOrigin: "explicit shared --web setting",
		},
		{
			name: "explicit web setting with equals short config",
			argv: ["--agent", "codex", "--web", "off", "--", "-c=web_search=indexed"],
			expectedOption: "-c web_search=*",
			expectedOrigin: "explicit shared --web setting",
		},
		{
			name: "explicit web setting with separated long config",
			argv: ["--agent", "codex", "--web", "off", "--", "--config", "web_search=live"],
			expectedOption: "--config web_search=*",
			expectedOrigin: "explicit shared --web setting",
		},
		{
			name: "explicit web setting with equals long config",
			argv: ["--agent", "codex", "--web", "off", "--", "--config=web_search=disabled"],
			expectedOption: "--config web_search=*",
			expectedOrigin: "explicit shared --web setting",
		},
	])("rejects a passthrough collision with $name", async ({
		argv,
		expectedOption,
		expectedOrigin,
	}) => {
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
		expect(output).toContain(`Passthrough option ${expectedOption}`);
		expect(output).toContain(expectedOrigin);
		expect(output).toContain("Remove one of the conflicting options.");
	});

	it("stops collision matching at the target-native end-of-options delimiter", async () => {
		const spawn = createSpawnStub(0);
		const exitCode = await runShim(
			["--agent", "codex", "--sandbox", "workspace-write", "--", "--version", "--", "--sandbox"],
			{ stdinIsTTY: true, spawn },
		);

		expect(exitCode).toBe(0);
		const [, args] = spawn.mock.calls[0] as SpawnCall;
		expect(args).toEqual([
			"--ask-for-approval",
			"on-request",
			"--sandbox",
			"workspace-write",
			"-c",
			'web_search="disabled"',
			"--version",
			"--",
			"--sandbox",
		]);
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
			"-c",
			'web_search="disabled"',
			"--disable",
			"apps",
		]);

		const unrelatedConfigSpawn = createSpawnStub(0);
		await runShim(["--agent", "codex", "--", "--config", 'model="gpt-5"'], {
			stdinIsTTY: true,
			spawn: unrelatedConfigSpawn,
		});
		const [, unrelatedConfigArgs] = unrelatedConfigSpawn.mock.calls[0] as SpawnCall;
		expect(unrelatedConfigArgs).toEqual([
			"--ask-for-approval",
			"on-request",
			"--sandbox",
			"workspace-write",
			"-c",
			'web_search="disabled"',
			"--config",
			'model="gpt-5"',
		]);

		const currentSettingSpawn = createSpawnStub(0);
		await runShim(["--agent", "codex", "--", "-c", 'web_search="disabled"'], {
			stdinIsTTY: true,
			spawn: currentSettingSpawn,
		});
		const [, currentSettingArgs] = currentSettingSpawn.mock.calls[0] as SpawnCall;
		expect(currentSettingArgs).toEqual([
			"--ask-for-approval",
			"on-request",
			"--sandbox",
			"workspace-write",
			"-c",
			'web_search="disabled"',
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
