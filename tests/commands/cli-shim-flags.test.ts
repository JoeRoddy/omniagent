import type { StdioOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import {
	buildAgentArgs,
	parseShimFlags,
	resolveInvocationFromFlags,
	runShim,
} from "../../src/cli/shim/index.js";

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

describe("CLI shim flag parsing", () => {
	it("defaults approval to prompt and accepts auto-edit/yolo", () => {
		const defaults = parseShimFlags([]);
		expect(defaults.approval).toBe("prompt");
		expect(defaults.approvalExplicit).toBe(false);

		expect(parseShimFlags(["--approval", "auto-edit"]).approval).toBe("auto-edit");
		expect(parseShimFlags(["--approval", "yolo"]).approval).toBe("yolo");
	});

	it("treats --auto-edit and --yolo as approval aliases", () => {
		expect(parseShimFlags(["--auto-edit"]).approval).toBe("auto-edit");
		expect(parseShimFlags(["--yolo"]).approval).toBe("yolo");
	});

	it("defaults sandbox to off when --yolo is set without explicit sandbox", () => {
		const flags = parseShimFlags(["--yolo"]);
		expect(flags.approval).toBe("yolo");
		expect(flags.sandbox).toBe("off");
		expect(flags.sandboxExplicit).toBe(false);
	});

	it("does not override explicit sandbox when --yolo is set", () => {
		const flags = parseShimFlags(["--yolo", "--sandbox", "workspace-write"]);
		expect(flags.sandbox).toBe("workspace-write");
		expect(flags.sandboxExplicit).toBe(true);
	});

	it("defaults sandbox to workspace-write and accepts off", () => {
		expect(parseShimFlags([]).sandbox).toBe("workspace-write");
		expect(parseShimFlags(["--sandbox", "off"]).sandbox).toBe("off");
	});

	it("defaults output to text and uses the last-specified output flag", () => {
		expect(parseShimFlags([]).output).toBe("text");
		const flags = parseShimFlags(["--output", "json", "--stream-json"]);
		expect(flags.output).toBe("stream-json");
	});

	it("supports --json and --stream-json aliases", () => {
		expect(parseShimFlags(["--json"]).output).toBe("json");
		expect(parseShimFlags(["--stream-json"]).output).toBe("stream-json");
	});

	it("parses --web values and defaults to off", () => {
		expect(parseShimFlags([]).web).toBe(false);

		const cases: Array<[string[], boolean]> = [
			[["--web"], true],
			[["--web", "on"], true],
			[["--web", "true"], true],
			[["--web", "1"], true],
			[["--web", "off"], false],
			[["--web", "false"], false],
			[["--web", "0"], false],
			[["--web=on"], true],
			[["--web=0"], false],
		];

		for (const [argv, expected] of cases) {
			expect(parseShimFlags(argv).web).toBe(expected);
		}
	});

	it("enables translation tracing when requested", () => {
		expect(parseShimFlags([]).traceTranslate).toBe(false);
		expect(parseShimFlags(["--trace-translate"]).traceTranslate).toBe(true);
		expect(parseShimFlags(["--trace-translate=1"]).traceTranslate).toBe(true);
		expect(parseShimFlags(["--trace-translate=false"]).traceTranslate).toBe(false);
	});

	it("returns invalid usage for bad flag values", async () => {
		const cases = [
			{ argv: ["--approval", "nope"], message: "Invalid value for --approval" },
			{ argv: ["--sandbox", "nope"], message: "Invalid value for --sandbox" },
			{ argv: ["--web", "maybe"], message: "Invalid value for --web" },
			{ argv: ["--agent", "unknown-target"], message: "Unknown or disabled target" },
		];

		for (const { argv, message } of cases) {
			const stderrWrites: string[] = [];
			const stderr = {
				write: (chunk: string) => {
					stderrWrites.push(String(chunk));
					return true;
				},
			} as NodeJS.WriteStream;

			const exitCode = await runShim(argv, {
				stdinIsTTY: true,
				stderr,
				repoRoot: process.cwd(),
			});

			expect(exitCode).toBe(2);
			expect(stderrWrites.join("")).toContain(message);
		}
	});

	it("warns when stream-json output is unsupported", async () => {
		const invocation = await buildInvocation(["--agent", "copilot", "--output", "stream-json"]);
		const result = buildAgentArgs(invocation);

		expect(result.warnings).toContain(
			"Warning: copilot does not support --output (stream-json); ignoring.",
		);
		expect(result.args).toEqual([]);
	});

	it("forwards --web only as the corresponding agent flag", async () => {
		const invocation = await buildInvocation(["--agent", "codex", "--web"]);
		const result = buildAgentArgs(invocation);

		expect(result.shimArgs).toEqual([
			"--ask-for-approval",
			"on-request",
			"--sandbox",
			"workspace-write",
			"--search",
		]);
		expect(result.args).toEqual([
			"--ask-for-approval",
			"on-request",
			"--sandbox",
			"workspace-write",
			"--search",
		]);
	});

	it("resolves mode/output for common flag combinations", async () => {
		const cases = [
			{
				name: "interactive default",
				argv: ["--agent", "codex"],
				stdinIsTTY: true,
				stdinText: null,
				mode: "interactive",
				output: "text",
				prompt: null,
			},
			{
				name: "one-shot prompt",
				argv: ["--agent", "codex", "-p", "Hello"],
				stdinIsTTY: true,
				stdinText: null,
				mode: "one-shot",
				output: "text",
				prompt: "Hello",
			},
			{
				name: "one-shot stdin",
				argv: ["--agent", "codex"],
				stdinIsTTY: false,
				stdinText: "From stdin",
				mode: "one-shot",
				output: "text",
				prompt: "From stdin",
			},
			{
				name: "json output",
				argv: ["--agent", "codex", "--output", "json"],
				stdinIsTTY: true,
				stdinText: null,
				mode: "interactive",
				output: "json",
				prompt: null,
			},
		];

		for (const testCase of cases) {
			const invocation = await buildInvocation(testCase.argv, {
				stdinIsTTY: testCase.stdinIsTTY,
				stdinText: testCase.stdinText,
			});

			expect(invocation.mode).toBe(testCase.mode);
			expect(invocation.session.outputFormat).toBe(testCase.output);
			expect(invocation.prompt).toBe(testCase.prompt);

			const spawn = createSpawnStub(0);
			const exitCode = await runShim(testCase.argv, {
				stdinIsTTY: testCase.stdinIsTTY,
				stdinText: testCase.stdinText,
				spawn,
				repoRoot: process.cwd(),
			});

			expect(exitCode).toBe(0);
			expect(spawn).toHaveBeenCalledTimes(1);
		}
	});
});
