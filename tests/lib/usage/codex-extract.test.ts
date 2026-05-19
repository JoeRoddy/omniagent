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
	beforeEach(() => {
		ptyMock.runPtyScenario.mockReset();
		ptyMock.runPtyScenario.mockResolvedValue({
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
		});
	});

	it("runs the built-in probe from home and continues past the Codex trust gate", async () => {
		const { extractCodexUsage } = await import("../../../src/lib/usage/codex.js");

		const result = await extractCodexUsage({
			targetId: "codex",
			displayName: "OpenAI Codex",
			command: "codex",
			window: "hourly",
			windows: ["hourly", "weekly"],
			now: new Date("2026-05-18T12:00:00.000Z"),
			repoRoot: "/tmp/untrusted-repo",
			agentsDir: "/tmp/untrusted-repo/agents",
			homeDir: "/Users/tester",
			launch: {
				command: "codex",
				args: ["--no-alt-screen"],
				timeoutMs: 60_000,
			},
			signal: new AbortController().signal,
			debug: {
				enabled: false,
			},
		});

		const options = ptyMock.runPtyScenario.mock.calls[0]?.[0];
		expect(options.cwd).toBe("/Users/tester");
		expect(result.limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual([
			"main:hourly",
			"main:weekly",
		]);

		const steps = options.steps;
		expect(
			steps[0].waitFor({ raw: "", screen: "Do you trust the contents of this directory?" }),
		).toBe(true);
		expect(steps[1]).toMatchObject({ write: "\r" });
		expect(steps[1].skipIf({ raw: "", screen: "gpt-5.5 Context 0% used > " })).toBe(true);
		expect(steps[2].waitFor({ raw: "", screen: "gpt-5.5 Context 0% used > " })).toBe(true);
	});
});
