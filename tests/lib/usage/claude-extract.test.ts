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

	it("uses Claude API rate-limit headers before starting the TUI probe", async () => {
		const { extractClaudeUsage } = await import("../../../src/lib/usage/claude.js");
		const now = new Date("2026-05-18T12:00:00.000Z");
		fetchMock.mockResolvedValue({
			status: 200,
			headers: new Headers({
				"anthropic-ratelimit-unified-5h-utilization": "0.12",
				"anthropic-ratelimit-unified-5h-reset": String(now.getTime() / 1000 + 30 * 60),
				"anthropic-ratelimit-unified-7d-utilization": "0.42",
				"anthropic-ratelimit-unified-7d-reset": String(now.getTime() / 1000 + 5 * 24 * 60 * 60),
			}),
		});

		const result = await extractClaudeUsage(buildContext({ homeDir, now }));

		expect(ptyMock.runPtyScenario).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.anthropic.com/v1/messages",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					authorization: "Bearer test-token-value-12345",
					"anthropic-beta": "oauth-2025-04-20",
				}),
			}),
		);
		expect(result.limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual([
			"current_session:hourly",
			"current_week:weekly",
		]);
		expect(result.limits.map((limit) => limit.percentUsed)).toEqual([12, 42]);
	});

	it("falls back to the TUI probe when API headers are unavailable", async () => {
		const { extractClaudeUsage } = await import("../../../src/lib/usage/claude.js");
		fetchMock.mockResolvedValue({
			status: 200,
			headers: new Headers(),
		});

		const result = await extractClaudeUsage(
			buildContext({ homeDir, now: new Date("2026-05-18T12:00:00.000Z") }),
		);

		expect(ptyMock.runPtyScenario).toHaveBeenCalledOnce();
		expect(result.limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual([
			"current_session:hourly",
			"current_week:weekly",
		]);
		expect(result.limits.map((limit) => limit.percentUsed)).toEqual([37, 64]);
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
