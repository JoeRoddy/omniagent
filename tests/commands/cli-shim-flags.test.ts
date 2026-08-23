import type { StdioOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	buildAgentArgs,
	parseShimFlags,
	resolveInvocationFromFlags,
	runShim,
} from "../../src/cli/shim/index.js";
import { resolveModelAlias } from "../../src/lib/agents/switch.js";
import type { TargetCliDefinition } from "../../src/lib/targets/config-types.js";

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

	it("parses --output-schema in both value forms", () => {
		expect(parseShimFlags([]).outputSchema).toBeNull();
		expect(parseShimFlags([]).outputSchemaExplicit).toBe(false);

		const spaced = parseShimFlags(["--output-schema", "./schema.json"]);
		expect(spaced.outputSchema).toBe("./schema.json");
		expect(spaced.outputSchemaExplicit).toBe(true);

		const inline = parseShimFlags(['--output-schema={"type":"object"}']);
		expect(inline.outputSchema).toBe('{"type":"object"}');
		expect(inline.outputSchemaExplicit).toBe(true);
	});

	it("rejects --output-schema without a value", () => {
		expect(() => parseShimFlags(["--output-schema"])).toThrow("Missing value for --output-schema");
	});

	it("rejects --output-schema combined with explicit output flags", () => {
		const conflicts = [
			["--output-schema", "s.json", "--output", "json"],
			["--output-schema", "s.json", "--output", "text"],
			["--output-schema", "s.json", "--json"],
			["--stream-json", "--output-schema", "s.json"],
		];
		for (const argv of conflicts) {
			expect(() => parseShimFlags(argv)).toThrow(
				"--output-schema cannot be combined with --output, --json, or --stream-json.",
			);
		}
	});

	it("parses --output-schema-retries in both value forms", () => {
		expect(parseShimFlags([]).outputSchemaRetries).toBeNull();

		const spaced = parseShimFlags(["--output-schema", "s.json", "--output-schema-retries", "4"]);
		expect(spaced.outputSchemaRetries).toBe(4);

		const inline = parseShimFlags(["--output-schema", "s.json", "--output-schema-retries=0"]);
		expect(inline.outputSchemaRetries).toBe(0);
	});

	it("rejects invalid --output-schema-retries values", () => {
		for (const value of ["1.5", "eleven", "11"]) {
			expect(() =>
				parseShimFlags(["--output-schema", "s.json", "--output-schema-retries", value]),
			).toThrow("Invalid value for --output-schema-retries. Provide an integer between 0 and 10.");
		}
	});

	it("rejects --output-schema-retries without --output-schema", () => {
		expect(() => parseShimFlags(["--output-schema-retries", "2"])).toThrow(
			"--output-schema-retries requires --output-schema.",
		);
	});

	it("appends claude structured output args before the prompt", async () => {
		const schema = '{"type":"object","properties":{}}';
		const invocation = await buildInvocation([
			"--agent",
			"claude",
			"--output-schema",
			schema,
			"-p",
			"Hello",
		]);
		const result = buildAgentArgs(invocation);

		expect(result.warnings).toEqual([]);
		expect(result.args).toEqual([
			"--json-schema",
			'{"type":"object","properties":{}}',
			"--output-format",
			"json",
			"-p",
			"Hello",
		]);
	});

	it("appends codex structured output file args before the positional prompt", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "oa-flags-test-"));
		try {
			const invocation = await buildInvocation(
				["--agent", "codex", "--output-schema", '{"type":"object"}', "-p", "Hello"],
				{ tempDir },
			);
			const result = buildAgentArgs(invocation);

			expect(result.warnings).toEqual([]);
			expect(result.args.slice(0, 3)).toEqual(["exec", "--sandbox", "workspace-write"]);
			const schemaIndex = result.args.indexOf("--output-schema");
			expect(schemaIndex).toBeGreaterThan(-1);
			expect(result.args[schemaIndex + 1]).toMatch(/schema\.json$/);
			expect(result.args[schemaIndex + 2]).toBe("--output-last-message");
			expect(result.args[schemaIndex + 3]).toMatch(/last-message\.txt$/);
			expect(result.args[result.args.length - 1]).toBe("Hello");
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
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

	it("warns when copilot json output is requested in interactive mode", async () => {
		const invocation = await buildInvocation(["--agent", "copilot", "--output", "stream-json"]);
		const result = buildAgentArgs(invocation);

		expect(result.warnings).toContain(
			"Warning: copilot does not support --output (stream-json); ignoring.",
		);
		expect(result.args).toEqual([]);
	});

	it("maps copilot json output to output-format json in one-shot mode", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"copilot",
			"--output",
			"json",
			"-p",
			"Hello",
		]);
		const result = buildAgentArgs(invocation);

		expect(result.warnings).toEqual([]);
		expect(result.args).toEqual(["--output-format", "json", "-p", "Hello"]);
	});

	it("maps copilot stream-json to the same jsonl output flag in one-shot mode", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"copilot",
			"--output",
			"stream-json",
			"-p",
			"Hello",
		]);
		const result = buildAgentArgs(invocation);

		expect(result.warnings).toEqual([]);
		expect(result.args).toEqual(["--output-format", "json", "-p", "Hello"]);
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

	it("keeps suppressed defaults out of shimArgs while preserving passthroughArgs", async () => {
		const invocation = await buildInvocation(["--agent", "codex", "--", "--sandbox=read-only"]);
		const result = buildAgentArgs(invocation);

		expect(result.shimArgs).toEqual([
			"--ask-for-approval",
			"on-request",
			"-c",
			'web_search="disabled"',
		]);
		expect(result.passthroughArgs).toEqual(["--sandbox=read-only"]);
		expect(result.args).toEqual([...result.shimArgs, "--sandbox=read-only"]);
	});

	it("applies declared collision rules to custom targets using the default translator", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"codex",
			"--",
			"--native-sandbox",
			"read-only",
		]);
		const customCli: TargetCliDefinition = {
			modes: {
				interactive: { command: "custom" },
				oneShot: { command: "custom", args: ["run"] },
			},
			flags: {
				sandbox: {
					values: {
						"workspace-write": ["--native-sandbox", "workspace"],
						off: ["--native-sandbox", "none"],
					},
				},
			},
			passthrough: {
				collisions: [{ option: "--native-sandbox", sources: ["sandbox"] }],
			},
		};
		const result = buildAgentArgs({
			...invocation,
			agent: { ...invocation.agent, id: "custom" },
			target: { ...invocation.target, id: "custom", cli: customCli },
		});

		expect(result.shimArgs).toEqual([]);
		expect(result.passthroughArgs).toEqual(["--native-sandbox", "read-only"]);
		expect(result.args).toEqual(["--native-sandbox", "read-only"]);
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

describe("CLI shim --effort flag", () => {
	function hasPair(args: string[], flag: string, value: string): boolean {
		return args.some((arg, index) => arg === flag && args[index + 1] === value);
	}

	it("has no default level and parses the shared ladder", () => {
		const defaults = parseShimFlags([]);
		expect(defaults.effort).toBeNull();
		expect(defaults.effortExplicit).toBe(false);

		expect(parseShimFlags(["--effort", "low"]).effort).toBe("low");
		expect(parseShimFlags(["--effort", "medium"]).effort).toBe("medium");
		expect(parseShimFlags(["--effort=high"]).effort).toBe("high");
		expect(parseShimFlags(["--effort", "xhigh"]).effort).toBe("xhigh");
		expect(parseShimFlags(["--effort", "MAX"]).effort).toBe("max");
		expect(parseShimFlags(["--effort", "max"]).effortExplicit).toBe(true);
	});

	it("rejects an unknown level before the agent starts", async () => {
		const stderrWrites: string[] = [];
		const stderr = {
			write: (chunk: string) => {
				stderrWrites.push(String(chunk));
				return true;
			},
		} as NodeJS.WriteStream;
		const spawn = createSpawnStub(0);

		const exitCode = await runShim(["--agent", "codex", "--effort", "ultra"], {
			stdinIsTTY: true,
			stderr,
			spawn,
			repoRoot: process.cwd(),
		});

		expect(exitCode).toBe(2);
		expect(stderrWrites.join("")).toContain("Invalid value for --effort");
		expect(spawn).not.toHaveBeenCalled();
	});

	it("emits no effort arguments when the flag is absent", async () => {
		const invocation = await buildInvocation(["--agent", "codex"]);
		const result = buildAgentArgs(invocation);

		expect(result.args.join(" ")).not.toContain("model_reasoning_effort");
		expect(result.warnings).toEqual([]);
	});

	it("maps the shared level onto each agent's native surface", async () => {
		const cases = [
			{ agent: "codex", level: "xhigh", flag: "-c", value: 'model_reasoning_effort="xhigh"' },
			{ agent: "codex", level: "max", flag: "-c", value: 'model_reasoning_effort="max"' },
			{ agent: "claude", level: "xhigh", flag: "--effort", value: "xhigh" },
			{ agent: "claude", level: "max", flag: "--effort", value: "max" },
			{ agent: "agy", level: "high", flag: "--effort", value: "high" },
			{ agent: "copilot", level: "high", flag: "--reasoning-effort", value: "high" },
			{ agent: "copilot", level: "xhigh", flag: "--reasoning-effort", value: "xhigh" },
			{ agent: "copilot", level: "max", flag: "--reasoning-effort", value: "max" },
		];

		for (const testCase of cases) {
			const invocation = await buildInvocation([
				"--agent",
				testCase.agent,
				"--effort",
				testCase.level,
			]);
			const result = buildAgentArgs(invocation);

			expect(result.warnings).toEqual([]);
			expect(hasPair(result.args, testCase.flag, testCase.value)).toBe(true);
		}
	});

	it("warns and ignores the level for a target without an effort mapping", async () => {
		const invocation = await buildInvocation(["--agent", "codex", "--effort", "max"]);
		const customCli: TargetCliDefinition = {
			modes: {
				interactive: { command: "custom" },
				oneShot: { command: "custom", args: ["run"] },
			},
		};
		const result = buildAgentArgs({
			...invocation,
			agent: { ...invocation.agent, id: "custom" },
			target: { ...invocation.target, id: "custom", cli: customCli },
		});

		expect(result.warnings).toContain("Warning: custom does not support --effort (max); ignoring.");
		expect(result.args).toEqual([]);
	});

	it("rejects a passthrough effort override that conflicts with an explicit level", async () => {
		const stderrWrites: string[] = [];
		const stderr = {
			write: (chunk: string) => {
				stderrWrites.push(String(chunk));
				return true;
			},
		} as NodeJS.WriteStream;
		const spawn = createSpawnStub(0);

		const exitCode = await runShim(
			["--agent", "codex", "--effort", "high", "--", "-c", 'model_reasoning_effort="low"'],
			{ stdinIsTTY: true, stderr, spawn, repoRoot: process.cwd() },
		);

		expect(exitCode).toBe(2);
		expect(stderrWrites.join("")).toContain(
			"conflicts with explicit shared --effort level. Remove one of the conflicting options.",
		);
		expect(spawn).not.toHaveBeenCalled();
	});

	it("detects a spaced config override so TOML whitespace cannot bypass the collision", async () => {
		// Codex accepts `key = "value"` as readily as `key="value"`, and applies the last override
		// it is given, so a spaced passthrough would silently outrank the explicit shared level.
		const spacedForms = [
			["-c", 'model_reasoning_effort = "low"'],
			["--config", 'model_reasoning_effort = "low"'],
			["-c", 'model_reasoning_effort  =  "low"'],
			["-c", 'model_reasoning_effort\t=\t"low"'],
			['-cmodel_reasoning_effort = "low"'],
			['--config=model_reasoning_effort = "low"'],
		];

		for (const passthrough of spacedForms) {
			const stderrWrites: string[] = [];
			const stderr = {
				write: (chunk: string) => {
					stderrWrites.push(String(chunk));
					return true;
				},
			} as NodeJS.WriteStream;
			const spawn = createSpawnStub(0);

			const exitCode = await runShim(
				["--agent", "codex", "--effort", "high", "--", ...passthrough],
				{ stdinIsTTY: true, stderr, spawn, repoRoot: process.cwd() },
			);

			expect(exitCode).toBe(2);
			expect(stderrWrites.join("")).toContain(
				"conflicts with explicit shared --effort level. Remove one of the conflicting options.",
			);
			expect(spawn).not.toHaveBeenCalled();
		}
	});

	it("detects a spaced web_search override too, since the matcher is shared", async () => {
		const stderrWrites: string[] = [];
		const stderr = {
			write: (chunk: string) => {
				stderrWrites.push(String(chunk));
				return true;
			},
		} as NodeJS.WriteStream;
		const spawn = createSpawnStub(0);

		const exitCode = await runShim(
			["--agent", "codex", "--web", "on", "--", "-c", 'web_search = "live"'],
			{ stdinIsTTY: true, stderr, spawn, repoRoot: process.cwd() },
		);

		expect(exitCode).toBe(2);
		expect(stderrWrites.join("")).toContain(
			"conflicts with explicit shared --web setting. Remove one of the conflicting options.",
		);
		expect(spawn).not.toHaveBeenCalled();
	});

	it("leaves a quoted config key alone, since codex does not resolve it to the bare key", async () => {
		// Verified against codex 0.149.0 by holding the value at an invalid effort and watching who
		// rejects it: the bare and tab/space-separated keys reach the API, which fails the run with
		// invalid_enum_value, while `"model_reasoning_effort"` and `'model_reasoning_effort'` behave
		// exactly like an unknown key and are silently dropped. Codex applies TOML quoting rules to
		// an override's value, not its key, so canonicalizing quotes away here would reject a
		// command line codex runs fine.
		for (const quotedKey of ['"model_reasoning_effort"', "'model_reasoning_effort'"]) {
			const passthroughArg = `${quotedKey} = "low"`;
			const invocation = await buildInvocation([
				"--agent",
				"codex",
				"--effort",
				"high",
				"--",
				"-c",
				passthroughArg,
			]);
			const result = buildAgentArgs(invocation);

			expect(result.warnings).toEqual([]);
			expect(hasPair(result.args, "-c", 'model_reasoning_effort="high"')).toBe(true);
			expect(result.args).toContain(passthroughArg);
		}
	});

	it("leaves a passthrough effort override alone when no level is requested", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"codex",
			"--",
			"-c",
			'model_reasoning_effort="low"',
		]);
		const result = buildAgentArgs(invocation);

		expect(result.warnings).toEqual([]);
		expect(result.shimArgs.join(" ")).not.toContain("model_reasoning_effort");
		expect(result.args.filter((arg) => arg.startsWith("model_reasoning_effort="))).toEqual([
			'model_reasoning_effort="low"',
		]);
	});
});

describe("CLI shim short flags", () => {
	it("accepts -a and -e as shorthand for --agent and --effort", () => {
		expect(parseShimFlags(["-a", "codex"]).agent).toBe("codex");
		expect(parseShimFlags(["-a", "codex"]).agentExplicit).toBe(true);
		expect(parseShimFlags(["-e", "xhigh"]).effort).toBe("xhigh");
		expect(parseShimFlags(["-e", "xhigh"]).effortExplicit).toBe(true);
	});

	it("accepts attached values, matching -p and -m", () => {
		expect(parseShimFlags(["-acodex"]).agent).toBe("codex");
		expect(parseShimFlags(["-ehigh"]).effort).toBe("high");

		const combined = parseShimFlags(["-phi", "-acodex", "-msol", "-exhigh"]);
		expect(combined.prompt).toBe("hi");
		expect(combined.agent).toBe("codex");
		expect(combined.model).toBe("sol");
		expect(combined.effort).toBe("xhigh");
	});

	it("normalizes short-flag values exactly like the long forms", () => {
		expect(parseShimFlags(["-a", "CODEX"]).agent).toBe(parseShimFlags(["--agent", "CODEX"]).agent);
		expect(parseShimFlags(["-e", "MAX"]).effort).toBe(parseShimFlags(["--effort", "MAX"]).effort);
	});

	it("does not shadow the long flags that share a leading letter", () => {
		expect(parseShimFlags(["--approval", "yolo"]).approval).toBe("yolo");
		expect(parseShimFlags(["--auto-edit"]).approval).toBe("auto-edit");
		expect(parseShimFlags(["--agent", "codex"]).agent).toBe("codex");
		expect(parseShimFlags(["--effort=high"]).effort).toBe("high");
		expect(parseShimFlags(["--agent", "codex"]).effort).toBeNull();
	});

	it("reuses the long-form validation for bad short-flag values", () => {
		expect(() => parseShimFlags(["-e", "ultra"])).toThrowError(/Invalid value for --effort/);
		expect(() => parseShimFlags(["-eultra"])).toThrowError(/Invalid value for --effort/);
		expect(() => parseShimFlags(["-e"])).toThrowError(/Missing value for --effort/);
		expect(() => parseShimFlags(["-a"])).toThrowError(/Missing value for --agent/);
		expect(() => parseShimFlags(["-e", "--json"])).toThrowError(/Missing value for --effort/);
	});

	it("resolves -a to the same invocation as --agent", async () => {
		const short = await buildInvocation(["-a", "codex", "-p", "hi", "-e", "high"]);
		const long = await buildInvocation(["--agent", "codex", "-p", "hi", "--effort", "high"]);

		expect(buildAgentArgs(short).args).toEqual(buildAgentArgs(long).args);
	});
});

describe("CLI shim model aliases", () => {
	function modelValue(args: string[], flag: string): string | undefined {
		const index = args.lastIndexOf(flag);
		return index === -1 ? undefined : args[index + 1];
	}

	it("expands an alias declared by the target", async () => {
		const invocation = await buildInvocation(["--agent", "codex", "-p", "hi", "-m", "sol"]);
		const result = buildAgentArgs(invocation);

		expect(invocation.requests.model).toBe("gpt-5.6-sol");
		expect(invocation.session.model).toBe("gpt-5.6-sol");
		expect(modelValue(result.args, "-m")).toBe("gpt-5.6-sol");
		expect(result.warnings).toEqual([]);
	});

	it("matches an alias regardless of case", async () => {
		const invocation = await buildInvocation(["--agent", "codex", "-p", "hi", "-m", "SOL"]);

		expect(invocation.requests.model).toBe("gpt-5.6-sol");
	});

	it("forwards an official model id untouched", async () => {
		const invocation = await buildInvocation(["--agent", "codex", "-p", "hi", "-m", "gpt-5.6-sol"]);

		expect(invocation.requests.model).toBe("gpt-5.6-sol");
		expect(modelValue(buildAgentArgs(invocation).args, "-m")).toBe("gpt-5.6-sol");
	});

	it("forwards an unrecognized value untouched so new ids work without a release", async () => {
		const invocation = await buildInvocation([
			"--agent",
			"codex",
			"-p",
			"hi",
			"-m",
			"gpt-9-unreleased",
		]);

		expect(invocation.requests.model).toBe("gpt-9-unreleased");
		expect(modelValue(buildAgentArgs(invocation).args, "-m")).toBe("gpt-9-unreleased");
	});

	it("leaves a target that declares no aliases alone", async () => {
		// Claude resolves its own shorthand, so the shim must not rewrite it.
		const invocation = await buildInvocation(["--agent", "claude", "-p", "hi", "-m", "opus"]);

		expect(invocation.requests.model).toBe("opus");
		expect(modelValue(buildAgentArgs(invocation).args, "--model")).toBe("opus");
	});

	it("resolves aliases from any target's own table, not a built-in list", async () => {
		// The table is part of the target API: a target the shim has never heard of gets the same
		// treatment as codex, purely from what its own definition declares.
		const invocation = await buildInvocation(["--agent", "codex", "-p", "hi", "-m", "zippy"]);
		const customCli: TargetCliDefinition = {
			modes: {
				interactive: { command: "custom" },
				oneShot: { command: "custom", args: ["run"] },
			},
			prompt: { type: "positional", position: "last" },
			flags: { model: { flag: ["--model"], aliases: { zippy: "custom-model-9" } } },
		};
		const target = { ...invocation.target, id: "custom", cli: customCli };
		const model = resolveModelAlias(target, "zippy");
		const result = buildAgentArgs({
			...invocation,
			agent: { ...invocation.agent, id: "custom" },
			target,
			requests: { ...invocation.requests, model: model ?? undefined },
		});

		expect(model).toBe("custom-model-9");
		expect(modelValue(result.args, "--model")).toBe("custom-model-9");
	});

	it("passes an alias through untouched behind the -- delimiter", async () => {
		const invocation = await buildInvocation(["--agent", "codex", "-p", "hi", "--", "-m", "sol"]);
		const result = buildAgentArgs(invocation);

		expect(invocation.requests.model).toBeUndefined();
		expect(modelValue(result.args, "-m")).toBe("sol");
	});
});
