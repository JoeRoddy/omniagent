import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

const ptyMock = vi.hoisted(() => ({
	runPtyScenario: vi.fn(),
}));

vi.mock("../../../src/lib/usage/pty.js", () => ({
	enterKey: () => "\r",
	escapeKey: () => "\x1b",
	runPtyScenario: ptyMock.runPtyScenario,
}));

describe("Claude usage extraction", () => {
	let homeDir: string;
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		homeDir = await mkdtemp(path.join(os.tmpdir(), "omniagent-claude-usage-"));
		await mkdir(path.join(homeDir, ".claude"), { recursive: true });
		await writeFile(
			path.join(homeDir, ".claude", ".credentials.json"),
			JSON.stringify({ claudeAiOauth: { accessToken: "test-token-value-12345" } }),
		);

		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		ptyMock.runPtyScenario.mockReset();
		ptyMock.runPtyScenario.mockResolvedValue({
			command: "claude",
			args: ["--model", "haiku"],
			exitCode: 0,
			timedOut: false,
			raw: "",
			screen: "",
			snapshots: {
				usage: {
					raw: "",
					screen: `
Current session
  37% used
  Resets 3pm

Current week
  64% used
  Resets May 25 at 9am
`,
				},
			},
			debug: [],
		});
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
		await rm(homeDir, { recursive: true, force: true });
	});

	it("uses Claude's OAuth usage API before starting the TUI probe", async () => {
		const { extractClaudeUsage } = await import("../../../src/lib/usage/claude.js");
		const now = new Date("2026-05-18T12:00:00.000Z");
		fetchMock.mockResolvedValue({
			status: 200,
			json: async () => ({
				limits: [
					{
						kind: "session",
						group: "session",
						percent: 12,
						resets_at: new Date(now.getTime() + 30 * 60_000).toISOString(),
					},
					{
						kind: "weekly_all",
						group: "weekly",
						percent: 42,
						resets_at: new Date(now.getTime() + 5 * 24 * 60 * 60_000).toISOString(),
					},
					{
						kind: "weekly_scoped",
						group: "weekly",
						percent: 18,
						resets_at: new Date(now.getTime() + 5 * 24 * 60 * 60_000).toISOString(),
						scope: { model: { id: null, display_name: "Fable" }, surface: null },
					},
				],
			}),
		});

		const result = await extractClaudeUsage(buildContext({ homeDir, now }));

		expect(ptyMock.runPtyScenario).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.anthropic.com/api/oauth/usage",
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					authorization: "Bearer test-token-value-12345",
					"anthropic-beta": "oauth-2025-04-20",
				}),
			}),
		);
		expect(result.limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual([
			"current_session:hourly",
			"current_week:weekly",
			"fable:weekly",
		]);
		expect(result.limits.map((limit) => limit.percentUsed)).toEqual([12, 42, 18]);
		expect(result.limits[2]?.modelLabel).toBe("Fable");
	});

	it("falls back to the TUI probe when API headers are unavailable", async () => {
		const { extractClaudeUsage } = await import("../../../src/lib/usage/claude.js");
		fetchMock.mockResolvedValue({
			status: 200,
			headers: new Headers(),
			json: async () => ({}),
		});

		const result = await extractClaudeUsage(
			buildContext({ homeDir, now: new Date("2026-05-18T12:00:00.000Z") }),
		);

		expect(ptyMock.runPtyScenario).toHaveBeenCalledOnce();
		const scenarioOptions = ptyMock.runPtyScenario.mock.calls[0]?.[0] as {
			env?: NodeJS.ProcessEnv;
			steps: Array<{
				waitFor?: (snapshot: { raw: string; screen: string }) => boolean;
				write?: string;
			}>;
		};
		expect(scenarioOptions.env).toMatchObject({ CLAUDE_CODE_SAFE_MODE: "1" });
		const readyStep = scenarioOptions.steps[0];
		expect(
			readyStep?.waitFor?.({
				raw: "Claude Code",
				screen: "Claude Code v2.1.266",
			}),
		).toBe(false);
		expect(
			readyStep?.waitFor?.({
				raw: "Claude Code",
				screen: "Claude Code v2.1.266\n\n❯ Try something",
			}),
		).toBe(true);
		expect(scenarioOptions.steps[1]?.write).toBe("/usage\r");
		expect(result.limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual([
			"current_session:hourly",
			"current_week:weekly",
		]);
		expect(result.limits.map((limit) => limit.percentUsed)).toEqual([37, 64]);
	});

	it("surfaces Claude TUI usage errors instead of waiting for usage rows", async () => {
		const { extractClaudeUsage } = await import("../../../src/lib/usage/claude.js");
		fetchMock.mockResolvedValue({
			status: 200,
			headers: new Headers(),
			json: async () => ({}),
		});
		ptyMock.runPtyScenario.mockResolvedValueOnce({
			command: "claude",
			args: ["--model", "haiku"],
			exitCode: 0,
			timedOut: false,
			raw: "",
			screen: "",
			snapshots: {
				usage: {
					raw: "",
					screen: "Error: Usage endpoint is rate limited. Please try again in a moment.",
				},
			},
			debug: [{ type: "screen-snapshot", label: "usage", content: "rate limited" }],
		});

		await expect(
			extractClaudeUsage(buildContext({ homeDir, now: new Date("2026-05-18T12:00:00.000Z") })),
		).rejects.toMatchObject({
			message: "Claude usage error: Usage endpoint is rate limited. Please try again in a moment.",
			debug: [{ type: "screen-snapshot", label: "usage", content: "rate limited" }],
		});

		const scenarioOptions = ptyMock.runPtyScenario.mock.calls[0]?.[0] as {
			steps: Array<{
				capture?: string;
				waitFor?: (snapshot: { raw: string; screen: string }) => boolean;
			}>;
		};
		const usageStep = scenarioOptions.steps.find((step) => step.capture === "usage");
		expect(
			usageStep?.waitFor?.({
				raw: "",
				screen: "Error: Usage endpoint is rate limited. Please try again in a moment.",
			}),
		).toBe(true);
	});

	it("does not treat stale raw terminal errors as usage results", async () => {
		const { extractClaudeUsage } = await import("../../../src/lib/usage/claude.js");
		fetchMock.mockResolvedValue({
			status: 200,
			headers: new Headers(),
			json: async () => ({}),
		});
		ptyMock.runPtyScenario.mockResolvedValueOnce({
			command: "claude",
			args: ["--model", "haiku"],
			exitCode: 0,
			timedOut: false,
			raw: "",
			screen: "",
			snapshots: {
				usage: {
					raw: "Error: Previous unrelated startup error.",
					screen: `
Current session
  37% used
  Resets 3pm

Current week
  64% used
  Resets May 25 at 9am
`,
				},
			},
			debug: [],
		});

		const result = await extractClaudeUsage(
			buildContext({ homeDir, now: new Date("2026-05-18T12:00:00.000Z") }),
		);

		expect(result.limits.map((limit) => limit.percentUsed)).toEqual([37, 64]);

		const scenarioOptions = ptyMock.runPtyScenario.mock.calls[0]?.[0] as {
			steps: Array<{
				capture?: string;
				waitFor?: (snapshot: { raw: string; screen: string }) => boolean;
			}>;
		};
		const usageStep = scenarioOptions.steps.find((step) => step.capture === "usage");
		expect(
			usageStep?.waitFor?.({
				raw: "Error: Previous unrelated startup error.",
				screen: "Claude >",
			}),
		).toBe(false);
	});
});

function buildContext(options: { homeDir: string; now: Date }) {
	return {
		targetId: "claude",
		displayName: "Claude Code",
		command: "claude",
		window: "hourly",
		windows: ["hourly", "weekly"],
		now: options.now,
		repoRoot: "/repo",
		agentsDir: "/repo/agents",
		homeDir: options.homeDir,
		launch: {
			command: "claude",
			args: ["--model", "haiku"],
			timeoutMs: 60_000,
			cheapModel: "haiku",
		},
		signal: new AbortController().signal,
		debug: {
			enabled: false,
		},
	};
}
