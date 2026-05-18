import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli/index.js";

const joinOutput = (calls: Array<[unknown]>) => calls.map(([arg]) => String(arg)).join("\n");

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-usage-"));
	const homeDir = path.join(root, "home");
	await mkdir(homeDir, { recursive: true });
	const homeSpy = vi.spyOn(os, "homedir").mockReturnValue(homeDir);
	const originalPath = process.env.PATH;
	try {
		await writeFile(path.join(root, "package.json"), "{}");
		process.env.PATH = "";
		await fn(root);
	} finally {
		process.env.PATH = originalPath;
		homeSpy.mockRestore();
		await rm(root, { recursive: true, force: true });
	}
}

async function withCwd(dir: string, fn: () => Promise<void>): Promise<void> {
	const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);
	try {
		await fn();
	} finally {
		cwdSpy.mockRestore();
	}
}

async function createFakeCliBin(root: string, commands: string[]): Promise<string> {
	const binDir = path.join(root, "bin");
	await mkdir(binDir, { recursive: true });
	for (const command of commands) {
		const cliPath = path.join(binDir, command);
		await writeFile(cliPath, "#!/usr/bin/env sh\nexit 0\n", "utf8");
		await chmod(cliPath, 0o755);
	}
	process.env.PATH = [binDir, process.env.PATH].filter(Boolean).join(path.delimiter);
	return binDir;
}

async function writeConfig(root: string, body: string): Promise<void> {
	const agentsDir = path.join(root, "agents");
	await mkdir(agentsDir, { recursive: true });
	await writeFile(path.join(agentsDir, "omniagent.config.cjs"), body, "utf8");
}

function usageConfig(options: {
	disableTargets?: string[];
	extractors?: Record<string, string>;
	extraTargets?: string;
}): string {
	const disableTargets = JSON.stringify(options.disableTargets ?? ["gemini"]);
	const disabled = new Set(options.disableTargets ?? ["gemini"]);
	const extractors = options.extractors ?? {};
	const codexExtractor =
		extractors.codex ??
		`async (ctx) => ({
			targetId: ctx.targetId,
			displayName: ctx.displayName,
			command: ctx.command,
			limits: [
				{
					id: ctx.targetId + ".main.hourly",
					targetId: ctx.targetId,
					agent: ctx.targetId,
					scope: "main",
					window: "5h",
					percentUsed: 40,
					percentRemaining: 60,
					resetAt: "2026-05-18T18:00:00.000Z",
					resetText: "6:00 PM",
					raw: "40% used"
				},
				{
					id: ctx.targetId + ".main.weekly",
					targetId: ctx.targetId,
					agent: ctx.targetId,
					scope: "main",
					window: "weekly",
					percentUsed: 70,
					percentRemaining: 30,
					resetAt: null,
					resetText: "Monday",
					raw: "70% used"
				}
			],
			debug: [
				{ type: "raw-output", label: "full raw", content: "account: private\\nsession: private" }
			]
		})`;
	const claudeExtractor =
		extractors.claude ??
		`async (ctx) => ({
			targetId: ctx.targetId,
			displayName: ctx.displayName,
			command: ctx.command,
			limits: [
				{
					id: ctx.targetId + ".session.hourly",
					targetId: ctx.targetId,
					agent: ctx.targetId,
					scope: "session",
					window: "hourly",
					percentUsed: 10,
					percentRemaining: 90,
					resetAt: null,
					resetText: "soon",
					raw: "10% used"
				}
			]
		})`;
	return `
module.exports = {
	disableTargets: ${disableTargets},
	targets: [
		${
			disabled.has("codex")
				? ""
				: `
		{
			id: "codex",
			displayName: "Mock Codex",
			aliases: ["cx"],
			cli: {
				modes: {
					interactive: { command: "codex" },
					oneShot: { command: "codex" }
				}
			},
			usage: {
				windows: ["hourly", "weekly"],
				launch: { command: "codex" },
				extract: ${codexExtractor}
			}
		}`
		}
		${disabled.has("codex") || disabled.has("claude") ? "" : ","}
		${
			disabled.has("claude")
				? ""
				: `
		{
			id: "claude",
			displayName: "Mock Claude",
			cli: {
				modes: {
					interactive: { command: "claude" },
					oneShot: { command: "claude" }
				}
			},
			usage: {
				windows: ["hourly", "weekly"],
				launch: { command: "claude" },
				extract: ${claudeExtractor}
			}
		}`
		}
		${options.extraTargets ? `,${options.extraTargets}` : ""}
	]
};
`;
}

describe.sequential("usage command", () => {
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

	it("parses usage and renders the required table columns", async () => {
		await withTempRepo(async (root) => {
			await createFakeCliBin(root, ["codex"]);
			await writeConfig(root, usageConfig({ disableTargets: ["claude", "gemini"] }));

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage"]);
			});

			const output = joinOutput(logSpy.mock.calls);
			expect(output).toContain("Agent");
			expect(output).toContain("Limit");
			expect(output).toContain("Usage");
			expect(output).toContain("Left");
			expect(output).toContain("Reset");
			expect(output).toContain("Mock Codex");
			expect(output).toContain("[#####-------]");
			expect(output).toContain("40% used");
			expect(output).toContain("60%");
			const header = output.split("\n")[0] ?? "";
			expect(header.indexOf("Limit")).toBeLessThan(header.indexOf("Left"));
			expect(header.indexOf("Left")).toBeLessThan(header.indexOf("Usage"));
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("labels duplicate scoped windows without prefixing the main limits", async () => {
		await withTempRepo(async (root) => {
			await createFakeCliBin(root, ["codex"]);
			await writeConfig(
				root,
				usageConfig({
					disableTargets: ["claude", "gemini"],
					extractors: {
						codex: `async (ctx) => ({
							targetId: ctx.targetId,
							displayName: ctx.displayName,
							command: ctx.command,
							limits: [
								{
									id: "codex.main.hourly",
									targetId: ctx.targetId,
									agent: ctx.targetId,
									scope: "main",
									window: "hourly",
									percentUsed: 10,
									percentRemaining: 90,
									resetAt: null,
									resetText: "soon",
									raw: "10% used"
								},
								{
									id: "codex.main.weekly",
									targetId: ctx.targetId,
									agent: ctx.targetId,
									scope: "main",
									window: "weekly",
									percentUsed: 20,
									percentRemaining: 80,
									resetAt: null,
									resetText: "Monday",
									raw: "20% used"
								},
								{
									id: "codex.spark.hourly",
									targetId: ctx.targetId,
									agent: ctx.targetId,
									scope: "spark",
									window: "hourly",
									percentUsed: 30,
									percentRemaining: 70,
									resetAt: null,
									resetText: "later",
									raw: "30% used"
								},
								{
									id: "codex.spark.weekly",
									targetId: ctx.targetId,
									agent: ctx.targetId,
									scope: "spark",
									window: "weekly",
									percentUsed: 40,
									percentRemaining: 60,
									resetAt: null,
									resetText: "Friday",
									raw: "40% used"
								}
							]
						})`,
					},
				}),
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage"]);
			});

			const output = joinOutput(logSpy.mock.calls);
			expect(output).toContain("  5h");
			expect(output).toContain("  Weekly");
			expect(output).toContain("Spark 5h");
			expect(output).toContain("Spark Weekly");
			expect(output).not.toContain("Main 5h");
			expect(output).not.toContain("Main Weekly");
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("colors the human table when color output is enabled", async () => {
		const originalForceColor = process.env.FORCE_COLOR;
		const originalNoColor = process.env.NO_COLOR;
		process.env.FORCE_COLOR = "1";
		delete process.env.NO_COLOR;
		try {
			await withTempRepo(async (root) => {
				await createFakeCliBin(root, ["codex"]);
				await writeConfig(root, usageConfig({ disableTargets: ["claude", "gemini"] }));

				await withCwd(root, async () => {
					await runCli(["node", "omniagent", "usage"]);
				});

				const output = joinOutput(logSpy.mock.calls);
				expect(output).toContain("\x1b[1mAgent");
				expect(output).toContain("Reset\x1b[0m");
				expect(output).toContain("\x1b[32m[#####-------]\x1b[0m");
				expect(output).toContain("\x1b[33m[########----]\x1b[0m");
				expect(exitSpy).not.toHaveBeenCalled();
			});
		} finally {
			if (originalForceColor == null) {
				delete process.env.FORCE_COLOR;
			} else {
				process.env.FORCE_COLOR = originalForceColor;
			}
			if (originalNoColor == null) {
				delete process.env.NO_COLOR;
			} else {
				process.env.NO_COLOR = originalNoColor;
			}
		}
	});

	it("selects an explicit target by alias", async () => {
		await withTempRepo(async (root) => {
			const binDir = await createFakeCliBin(root, ["codex", "claude"]);
			await writeConfig(root, usageConfig({}));

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage", "cx", "--json"]);
			});

			const envelope = JSON.parse(joinOutput(logSpy.mock.calls));
			expect(envelope.targets).toHaveLength(1);
			expect(envelope.targets[0].targetId).toBe("codex");
			expect(envelope.targets[0].displayName).toBe("Mock Codex");
			expect(envelope.targets[0].command).toBe(path.join(binDir, "codex"));
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("rejects multiple positional targets with exit code 2", async () => {
		await withTempRepo(async (root) => {
			await writeConfig(root, usageConfig({}));

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage", "codex", "claude"]);
			});

			expect(joinOutput(errorSpy.mock.calls)).toContain("accepts at most one target");
			expect(exitSpy).toHaveBeenCalledWith(2);
		});
	});

	it("rejects unknown explicit targets with exit code 2", async () => {
		await withTempRepo(async (root) => {
			await writeConfig(root, usageConfig({}));

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage", "unknown"]);
			});

			const error = joinOutput(errorSpy.mock.calls);
			expect(error).toContain("Unknown target: unknown");
			expect(error).toContain("Supported usage targets");
			expect(exitSpy).toHaveBeenCalledWith(2);
		});
	});

	it("prints JSON envelopes for invalid usage while preserving exit code 2", async () => {
		await withTempRepo(async (root) => {
			await writeConfig(root, usageConfig({}));

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage", "unknown", "--json"]);
			});

			const envelope = JSON.parse(joinOutput(logSpy.mock.calls));
			expect(envelope.targets).toEqual([]);
			expect(envelope.errors[0]).toMatchObject({
				code: "unknown_target",
				message: expect.stringContaining("Unknown target: unknown"),
			});
			expect(errorSpy).not.toHaveBeenCalled();
			expect(exitSpy).toHaveBeenCalledWith(2);
		});
	});

	it("selects only installed usage-capable targets by default", async () => {
		await withTempRepo(async (root) => {
			await createFakeCliBin(root, ["codex", "copilot"]);
			await writeConfig(root, usageConfig({}));

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage"]);
			});

			const output = joinOutput(logSpy.mock.calls);
			expect(output).toContain("Mock Codex");
			expect(output).not.toContain("Mock Claude");
			expect(output).not.toContain("Copilot");
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("checks usage launch command availability instead of the general target CLI", async () => {
		await withTempRepo(async (root) => {
			const binDir = await createFakeCliBin(root, ["usage-codex"]);
			await writeConfig(
				root,
				usageConfig({ disableTargets: ["claude", "gemini"] }).replace(
					'launch: { command: "codex" }',
					'launch: { command: "usage-codex" }',
				),
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage", "codex", "--json"]);
			});

			const envelope = JSON.parse(joinOutput(logSpy.mock.calls));
			expect(envelope.targets).toHaveLength(1);
			expect(envelope.targets[0].command).toBe(path.join(binDir, "usage-codex"));
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("filters all-target mode by usage launch command availability", async () => {
		await withTempRepo(async (root) => {
			await createFakeCliBin(root, ["codex", "claude"]);
			await writeConfig(
				root,
				usageConfig({}).replace(
					'launch: { command: "codex" }',
					'launch: { command: "missing-usage-codex" }',
				),
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage"]);
			});

			const output = joinOutput(logSpy.mock.calls);
			expect(output).not.toContain("Mock Codex");
			expect(output).toContain("Mock Claude");
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("reports explicit missing usage launch CLI with exit code 1", async () => {
		await withTempRepo(async (root) => {
			await createFakeCliBin(root, ["codex"]);
			await writeConfig(
				root,
				usageConfig({ disableTargets: ["claude", "gemini"] }).replace(
					'launch: { command: "codex" }',
					'launch: { command: "missing-usage-codex" }',
				),
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage", "codex"]);
			});

			const error = joinOutput(errorSpy.mock.calls);
			expect(error).toContain("requires its CLI");
			expect(error).toContain("missing-usage-codex");
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	it("rejects explicit unsupported Copilot with exit code 2", async () => {
		await withTempRepo(async (root) => {
			await createFakeCliBin(root, ["copilot"]);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage", "copilot"]);
			});

			const error = joinOutput(errorSpy.mock.calls);
			expect(error).toContain("does not support usage extraction");
			expect(error).toContain("Supported usage targets");
			expect(exitSpy).toHaveBeenCalledWith(2);
		});
	});

	it("reports explicit missing CLI with exit code 1", async () => {
		await withTempRepo(async (root) => {
			await writeConfig(root, usageConfig({ disableTargets: ["claude", "gemini"] }));

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage", "codex"]);
			});

			expect(joinOutput(errorSpy.mock.calls)).toContain("requires its CLI");
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	it("prints an actionable message when no usage-capable CLIs are available", async () => {
		await withTempRepo(async (root) => {
			await writeConfig(root, usageConfig({}));

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage"]);
			});

			const output = joinOutput(logSpy.mock.calls);
			expect(output).toContain("No installed active usage-capable agents were found");
			expect(output).toContain("codex");
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("normalizes and filters hourly and weekly windows", async () => {
		await withTempRepo(async (root) => {
			await createFakeCliBin(root, ["codex"]);
			await writeConfig(root, usageConfig({ disableTargets: ["claude", "gemini"] }));

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage", "codex", "--window=5h", "--json"]);
			});
			let envelope = JSON.parse(joinOutput(logSpy.mock.calls));
			expect(envelope.targets[0].limits).toHaveLength(1);
			expect(envelope.targets[0].limits[0].window).toBe("hourly");

			logSpy.mockClear();
			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage", "codex", "--window=weekly", "--json"]);
			});
			envelope = JSON.parse(joinOutput(logSpy.mock.calls));
			expect(envelope.targets[0].limits).toHaveLength(1);
			expect(envelope.targets[0].limits[0].window).toBe("weekly");
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("passes timeout seconds into the usage extraction context", async () => {
		await withTempRepo(async (root) => {
			await createFakeCliBin(root, ["codex"]);
			await writeConfig(
				root,
				usageConfig({
					disableTargets: ["claude", "gemini"],
					extractors: {
						codex: `async (ctx) => ({
							targetId: ctx.targetId,
							displayName: ctx.displayName,
							command: ctx.command,
							limits: [
								{
									id: "codex.hourly",
									targetId: ctx.targetId,
									agent: ctx.targetId,
									window: "hourly",
									percentUsed: ctx.launch.timeoutMs === 5000 ? 10 : 90,
									percentRemaining: ctx.launch.timeoutMs === 5000 ? 90 : 10,
									resetAt: null,
									resetText: String(ctx.launch.timeoutMs),
									raw: String(ctx.launch.timeoutMs)
								}
							]
						})`,
					},
				}),
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage", "codex", "--timeout=5", "--json"]);
			});

			const envelope = JSON.parse(joinOutput(logSpy.mock.calls));
			expect(envelope.targets[0].limits[0].raw).toBe("5000");
			expect(envelope.targets[0].limits[0].percentUsed).toBe(10);
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("rejects invalid timeout values with exit code 2", async () => {
		await withTempRepo(async (root) => {
			await writeConfig(root, usageConfig({}));

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage", "--timeout=nope"]);
			});

			expect(joinOutput(errorSpy.mock.calls)).toContain("--timeout must be a positive duration");
			expect(exitSpy).toHaveBeenCalledWith(2);
		});
	});

	it("accepts custom windows and notes no matching rows without failing", async () => {
		await withTempRepo(async (root) => {
			await createFakeCliBin(root, ["codex"]);
			await writeConfig(root, usageConfig({ disableTargets: ["claude", "gemini"] }));

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage", "codex", "--window=monthly", "--json"]);
			});

			const envelope = JSON.parse(joinOutput(logSpy.mock.calls));
			expect(envelope.targets[0].limits).toHaveLength(0);
			expect(envelope.notes[0]).toContain('window "monthly"');
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("notes requested window no-match when an extractor returns zero limits", async () => {
		await withTempRepo(async (root) => {
			await createFakeCliBin(root, ["codex"]);
			await writeConfig(
				root,
				usageConfig({
					disableTargets: ["claude", "gemini"],
					extractors: {
						codex: `async (ctx) => ({
							targetId: ctx.targetId,
							displayName: ctx.displayName,
							command: ctx.command,
							limits: []
						})`,
					},
				}),
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage", "codex", "--window=weekly", "--json"]);
			});

			const envelope = JSON.parse(joinOutput(logSpy.mock.calls));
			expect(envelope.targets[0].limits).toHaveLength(0);
			expect(envelope.notes[0]).toContain('window "weekly"');
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("emits a stable JSON envelope and excludes debug artifacts by default", async () => {
		await withTempRepo(async (root) => {
			await createFakeCliBin(root, ["codex"]);
			await writeConfig(root, usageConfig({ disableTargets: ["claude", "gemini"] }));

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage", "codex", "--json"]);
			});

			const envelope = JSON.parse(joinOutput(logSpy.mock.calls));
			expect(envelope.schemaVersion).toBe(1);
			expect(typeof envelope.generatedAt).toBe("string");
			expect(envelope.targets[0].limits[0].percentUsed).toBe(40);
			expect(envelope.targets[0].errors).toBeUndefined();
			expect(envelope.errors).toEqual([]);
			expect(envelope.notes).toEqual([]);
			expect(envelope.debug).toBeUndefined();
			expect(JSON.stringify(envelope)).not.toContain("account: private");
		});
	});

	it("makes debug imply JSON and includes debug artifacts", async () => {
		await withTempRepo(async (root) => {
			await createFakeCliBin(root, ["codex"]);
			await writeConfig(root, usageConfig({ disableTargets: ["claude", "gemini"] }));

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage", "codex", "--debug"]);
			});

			const envelope = JSON.parse(joinOutput(logSpy.mock.calls));
			expect(envelope.debug[0].type).toBe("raw-output");
			expect(envelope.debug[0].targetId).toBe("codex");
			expect(envelope.debug[0].displayName).toBe("Mock Codex");
			expect(envelope.debug[0].content).toContain("account: private");
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("renders partial all-agent failures and exits 1", async () => {
		await withTempRepo(async (root) => {
			await createFakeCliBin(root, ["codex", "claude"]);
			await writeConfig(
				root,
				usageConfig({
					extractors: {
						claude: `async () => { throw new Error("usage probe failed"); }`,
					},
				}),
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage"]);
			});

			const output = joinOutput(logSpy.mock.calls);
			expect(output).toContain("Mock Codex");
			expect(output).toContain("Mock Claude");
			expect(output).toContain("Error: usage probe failed");
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	it("renders timed out extractions as error rows and exits 1", async () => {
		await withTempRepo(async (root) => {
			await createFakeCliBin(root, ["codex"]);
			await writeConfig(
				root,
				usageConfig({
					disableTargets: ["claude", "gemini"],
					extractors: {
						codex: `async () => new Promise(() => {})`,
					},
				}),
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage", "codex", "--timeout=10ms"]);
			});

			const output = joinOutput(logSpy.mock.calls);
			expect(output).toContain("Mock Codex");
			expect(output).toContain("error");
			expect(output).toContain("failed");
			expect(output).toContain("Usage extraction timed out after 10ms.");
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	it("prints JSON envelopes for extraction failures", async () => {
		await withTempRepo(async (root) => {
			await createFakeCliBin(root, ["codex"]);
			await writeConfig(
				root,
				usageConfig({
					disableTargets: ["claude", "gemini"],
					extractors: {
						codex: `async () => { throw new Error("status timed out"); }`,
					},
				}),
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage", "codex", "--json"]);
			});

			const envelope = JSON.parse(joinOutput(logSpy.mock.calls));
			expect(envelope.targets).toEqual([]);
			expect(envelope.errors[0]).toMatchObject({
				targetId: "codex",
				code: "usage_extraction_failed",
				message: "status timed out",
			});
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	it("promotes extractor-returned errors to the top-level JSON errors array", async () => {
		await withTempRepo(async (root) => {
			await createFakeCliBin(root, ["codex"]);
			await writeConfig(
				root,
				usageConfig({
					disableTargets: ["claude", "gemini"],
					extractors: {
						codex: `async (ctx) => ({
							targetId: ctx.targetId,
							displayName: ctx.displayName,
							command: ctx.command,
							limits: [],
							errors: [
								{
									targetId: ctx.targetId,
									displayName: ctx.displayName,
									code: "partial_parse",
									message: "some rows could not be parsed"
								}
							]
						})`,
					},
				}),
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "usage", "codex", "--json"]);
			});

			const envelope = JSON.parse(joinOutput(logSpy.mock.calls));
			expect(envelope.targets[0].errors).toBeUndefined();
			expect(envelope.errors[0]).toMatchObject({
				targetId: "codex",
				code: "partial_parse",
				message: "some rows could not be parsed",
			});
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});
});
