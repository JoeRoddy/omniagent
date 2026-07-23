import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

const ptyMock = vi.hoisted(() => ({
	runPtyScenario: vi.fn(),
}));

vi.mock("../../../src/lib/usage/pty.js", () => ({
	enterKey: () => "\r",
	runPtyScenario: ptyMock.runPtyScenario,
	typeTextSteps: (text: string, delayMs: number) =>
		[...text].map((char) => ({ write: char, waitMs: delayMs })),
}));

describe("Codex usage extraction", () => {
	let tempDirs: string[] = [];

	beforeEach(() => {
		ptyMock.runPtyScenario.mockReset();
		ptyMock.runPtyScenario.mockResolvedValue(buildPtyResult());
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
		await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
		tempDirs = [];
	});

	it("uses Codex API usage JSON before starting the TUI probe", async () => {
		const { extractCodexUsage } = await import("../../../src/lib/usage/codex.js");
		const now = new Date("2026-05-18T12:00:00.000Z");
		const homeDir = await createCodexHome();
		const fetchMock = vi.fn().mockResolvedValue({
			status: 200,
			json: async () => ({
				rate_limit: {
					primary_window: {
						used_percent: 6,
						limit_window_seconds: 18_000,
						reset_at: now.getTime() / 1000 + 30 * 60,
					},
					secondary_window: {
						used_percent: 25,
						limit_window_seconds: 604_800,
						reset_at: now.getTime() / 1000 + 7 * 24 * 60 * 60,
					},
				},
				additional_rate_limits: [
					{
						limit_name: "GPT-5.3-Codex-Spark",
						metered_feature: "codex_bengalfox",
						rate_limit: {
							primary_window: {
								used_percent: 0,
								limit_window_seconds: 18_000,
							},
							secondary_window: {
								used_percent: 1,
								limit_window_seconds: 604_800,
							},
						},
					},
				],
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await extractCodexUsage(buildContext({ homeDir, now }));

		expect(ptyMock.runPtyScenario).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledWith(
			"https://chatgpt.com/backend-api/wham/usage",
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					authorization: "Bearer test-access-token",
					"chatgpt-account-id": "test-account-id",
					"x-codex-installation-id": "test-installation-id",
				}),
			}),
		);
		expect(result.limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual([
			"main:hourly",
			"main:weekly",
			"spark:hourly",
			"spark:weekly",
		]);
		expect(result.limits.map((limit) => limit.percentUsed)).toEqual([6, 25, 0, 1]);
	});

	it("falls back to the TUI probe when the Codex API usage shape is unavailable", async () => {
		const { extractCodexUsage } = await import("../../../src/lib/usage/codex.js");
		const homeDir = await createCodexHome();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				status: 200,
				json: async () => ({}),
			}),
		);

		const result = await extractCodexUsage(
			buildContext({ homeDir, now: new Date("2026-05-18T12:00:00.000Z") }),
		);

		expect(ptyMock.runPtyScenario).toHaveBeenCalledOnce();
		expect(result.limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual([
			"main:hourly",
			"main:weekly",
		]);
	});

	it("isolates fallback TUI state from the user's Codex configuration", async () => {
		const { extractCodexUsage } = await import("../../../src/lib/usage/codex.js");
		const homeDir = await createCodexHome();
		const configPath = path.join(homeDir, ".codex", "config.toml");
		const configContents = 'model = "gpt-5.4-mini"\n';
		await writeFile(configPath, configContents);
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				status: 200,
				json: async () => ({}),
			}),
		);

		let probeCodexHome = "";
		ptyMock.runPtyScenario.mockImplementationOnce(async (options) => {
			probeCodexHome = options.env?.CODEX_HOME ?? "";
			expect(probeCodexHome).not.toBe(path.join(homeDir, ".codex"));
			expect(await readFile(path.join(probeCodexHome, "auth.json"), "utf8")).toContain(
				"test-access-token",
			);
			expect(await readFile(path.join(probeCodexHome, "installation_id"), "utf8")).toBe(
				"test-installation-id",
			);
			await expect(
				readFile(path.join(probeCodexHome, "config.toml"), "utf8"),
			).rejects.toMatchObject({ code: "ENOENT" });
			return buildPtyResult();
		});

		await extractCodexUsage(buildContext({ homeDir, now: new Date("2026-05-18T12:00:00.000Z") }));

		expect(await readFile(configPath, "utf8")).toBe(configContents);
		await expect(access(probeCodexHome)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("runs the built-in probe from home and continues past the Codex trust gate", async () => {
		const { extractCodexUsage } = await import("../../../src/lib/usage/codex.js");

		const result = await extractCodexUsage(
			buildContext({
				homeDir: "/Users/tester",
				now: new Date("2026-05-18T12:00:00.000Z"),
				repoRoot: "/tmp/untrusted-repo",
			}),
		);

		const options = ptyMock.runPtyScenario.mock.calls[0]?.[0];
		expect(options.cwd).toBe("/Users/tester");
		expect(result.limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual([
			"main:hourly",
			"main:weekly",
		]);

		const steps = options.steps;
		const trustPrompt = { raw: "", screen: "Do you trust the contents of this directory?" };
		const migrationPrompt = {
			raw: "",
			screen: "GPT-5.4 Mini will be deprecated soon\n› 1. Try new model\n  2. Use existing model",
		};
		const dismissedMigrationPrompt = { raw: migrationPrompt.screen, screen: "" };
		const readyPrompt = { raw: "", screen: "gpt-5.5 Context 0% used > " };
		expect(steps[0].waitFor(trustPrompt)).toBe(true);
		expect(steps[0].waitFor(migrationPrompt)).toBe(true);
		expect(steps[1].write(migrationPrompt)).toBe("2");
		expect(steps[1].write(trustPrompt)).toBeUndefined();
		expect(steps[1].skipIf(readyPrompt)).toBe(true);
		expect(steps[2].waitFor(trustPrompt)).toBe(true);
		expect(steps[2].optional).toBe(true);
		expect(steps[3]).toMatchObject({ write: "\r" });
		expect(steps[3].skipIf(readyPrompt)).toBe(true);
		expect(steps[4].waitFor(migrationPrompt)).toBe(true);
		expect(steps[4].waitFor(readyPrompt)).toBe(true);
		expect(steps[4].optional).toBe(true);
		expect(steps[5].write(migrationPrompt)).toBe("2");
		// A dialog that only lingers in raw output was already dismissed; typing again would
		// submit the selection to the composer.
		expect(steps[5].write(dismissedMigrationPrompt)).toBeUndefined();
		expect(steps[5].skipIf(readyPrompt)).toBe(true);
		expect(steps[6].waitFor(readyPrompt)).toBe(true);

		const statusSettleStep = steps.find((step: { waitMs?: number }) => step.waitMs === 5_000);
		const weeklyOnlyStatus = {
			raw: "",
			screen: "Model: gpt-5.4-mini\nWeekly limit: 60% left",
		};
		const mixedIncrementalStatus = {
			raw: "",
			screen: "Model: gpt-5.4-mini\n5h limit: [██\nWeekly limit: 60% left",
		};
		expect(statusSettleStep.skipIf(weeklyOnlyStatus)).toBe(true);
		expect(statusSettleStep.skipIf(mixedIncrementalStatus)).toBe(false);
	});

	async function createCodexHome(): Promise<string> {
		const homeDir = await mkdtemp(path.join(os.tmpdir(), "omniagent-codex-usage-"));
		tempDirs.push(homeDir);
		await mkdir(path.join(homeDir, ".codex"), { recursive: true });
		await writeFile(
			path.join(homeDir, ".codex", "auth.json"),
			JSON.stringify({
				tokens: {
					access_token: "test-access-token",
					account_id: "test-account-id",
				},
			}),
		);
		await writeFile(path.join(homeDir, ".codex", "installation_id"), "test-installation-id");
		return homeDir;
	}

	function buildContext(options: { homeDir: string; now: Date; repoRoot?: string }) {
		return {
			targetId: "codex",
			displayName: "OpenAI Codex",
			command: "codex",
			window: "hourly",
			windows: ["hourly", "weekly"],
			now: options.now,
			repoRoot: options.repoRoot ?? "/repo",
			agentsDir: `${options.repoRoot ?? "/repo"}/agents`,
			homeDir: options.homeDir,
			launch: {
				command: "codex",
				args: ["--no-alt-screen"],
				timeoutMs: 60_000,
			},
			signal: new AbortController().signal,
			debug: {
				enabled: false,
			},
		};
	}
});

function buildPtyResult() {
	return {
		command: "codex",
		args: ["--no-alt-screen"],
		exitCode: 0,
		timedOut: false,
		raw: "",
		screen: "",
		snapshots: {
			status: {
				raw: "",
				screen: `
Model: gpt-5.1-codex
5h limit: 85% left
Weekly limit: 41% left
`,
			},
		},
		debug: [],
	};
}
