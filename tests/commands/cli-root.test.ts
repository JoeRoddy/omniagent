import { runCli } from "../../src/cli/index.js";

const joinOutput = (calls: Array<[unknown]>) => calls.map(([arg]) => String(arg)).join("\n");

// Shim errors are written to the injected stderr stream rather than console.error.
const captureStderr = (writes: string[]) =>
	({
		write: (chunk: string) => {
			writes.push(String(chunk));
			return true;
		},
	}) as unknown as NodeJS.WriteStream;

describe("CLI root command", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let exitSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
		process.exitCode = undefined;
	});

	afterEach(() => {
		logSpy.mockRestore();
		errorSpy.mockRestore();
		exitSpy.mockRestore();
		process.exitCode = undefined;
	});

	it("supports --help output at the root level", async () => {
		await runCli(["node", "omniagent", "--help"]);

		const output = joinOutput(logSpy.mock.calls);
		expect(output).toContain("omniagent CLI");
		expect(output).toContain("Commands:");
		expect(output).toContain("Options:");
		expect(output).toContain("Capabilities by agent:");
		expect(output).toContain("Unsupported shared flags for a selected agent emit a warning");
		expect(output).toContain("output-schema");
		expect(output).toContain("output-schema-retries");
		expect(output).toContain("prompt-based");
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it("lists the short forms for the flags that have them", async () => {
		await runCli(["node", "omniagent", "--help"]);

		const output = joinOutput(logSpy.mock.calls);
		expect(output).toContain("-p, --prompt");
		expect(output).toContain("-m, --model");
		expect(output).toContain("-a, --agent");
		expect(output).toContain("-e, --effort");
	});

	it("admits attached short-flag values instead of splitting them into unknown flags", async () => {
		// yargs-parser has no attached-value syntax and would otherwise read `-acodex` as a group of
		// single-character flags, rejecting the invocation before parseShimFlags ever sees it.
		// Reaching target resolution is the proof that parsing got all the way through.
		const argvs = [
			["-phi"],
			["-p", "hi", "-msol"],
			["-p", "hi", "-exhigh"],
			["-phi", "-acodex", "-msol", "-exhigh"],
		];

		for (const argv of argvs) {
			const writes: string[] = [];
			await runCli(["node", "omniagent", ...argv, "--agent", "definitely-not-an-agent"], {
				shim: { stderr: captureStderr(writes), stdinIsTTY: true, repoRoot: process.cwd() },
			});

			const output = [...writes, joinOutput(errorSpy.mock.calls)].join("\n");
			expect(output).toContain("Unknown or disabled target: definitely-not-an-agent.");
			expect(output).not.toContain("Unknown option");
			expect(output).not.toContain("Unknown arguments");
		}
	});

	it("keeps an attached value that begins with a dash intact", async () => {
		// Expanding to `-p` plus the value would let yargs read the value as another option: `--help`
		// would print help instead of becoming the prompt, and `-m-foo` would be rejected outright.
		const writes: string[] = [];
		await runCli(["node", "omniagent", "-p--help", "--agent", "definitely-not-an-agent"], {
			shim: { stderr: captureStderr(writes), stdinIsTTY: true, repoRoot: process.cwd() },
		});

		expect(joinOutput(logSpy.mock.calls)).not.toContain("Commands:");
		expect(writes.join("\n")).toContain("Unknown or disabled target: definitely-not-an-agent.");
	});

	it("accepts an attached model value that begins with a dash", async () => {
		const writes: string[] = [];
		await runCli(
			["node", "omniagent", "-p", "hi", "-m-foo", "--agent", "definitely-not-an-agent"],
			{
				shim: { stderr: captureStderr(writes), stdinIsTTY: true, repoRoot: process.cwd() },
			},
		);

		const output = [...writes, joinOutput(errorSpy.mock.calls)].join("\n");
		expect(output).toContain("Unknown or disabled target: definitely-not-an-agent.");
		expect(output).not.toContain("Unknown arguments");
	});

	it("still rejects an unknown short flag that only looks attached", async () => {
		await runCli(["node", "omniagent", "-zfoo"]);

		expect(joinOutput(errorSpy.mock.calls)).toContain("Unknown");
	});

	it("leaves passthrough args after -- untouched by short-flag expansion", async () => {
		const writes: string[] = [];
		await runCli(
			["node", "omniagent", "-phi", "--agent", "definitely-not-an-agent", "--", "-msol"],
			{ shim: { stderr: captureStderr(writes), stdinIsTTY: true, repoRoot: process.cwd() } },
		);

		const output = [...writes, joinOutput(errorSpy.mock.calls)].join("\n");
		expect(output).toContain("Unknown or disabled target: definitely-not-an-agent.");
		expect(output).not.toContain("Unknown option");
	});

	it("supports --version output at the root level", async () => {
		await runCli(["node", "omniagent", "--version"]);

		const output = joinOutput(logSpy.mock.calls).trim();
		expect(output).toMatch(/\d+\.\d+\.\d+/);
		expect(exitSpy).not.toHaveBeenCalled();
	});
});
