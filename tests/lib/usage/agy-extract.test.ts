import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

const ptyMock = vi.hoisted(() => ({
	runPtyScenario: vi.fn(),
}));

let tempDirs: string[] = [];

type MockPtyStep = {
	capture?: string;
	write?: string;
	skipIf?: (snapshot: { raw: string; screen: string }) => boolean;
	waitFor?: (snapshot: { raw: string; screen: string }) => boolean;
	optional?: boolean;
};

vi.mock("../../../src/lib/usage/pty.js", () => ({
	enterKey: () => "\r",
	escapeKey: () => "\x1b",
	runPtyScenario: ptyMock.runPtyScenario,
	typeTextSteps: (text: string, delayMs: number) =>
		[...text].map((char) => ({ write: char, waitMs: delayMs })),
}));

describe("Antigravity usage extraction", () => {
	beforeEach(() => {
		ptyMock.runPtyScenario.mockReset();
		ptyMock.runPtyScenario.mockResolvedValue({
			command: "agy",
			args: [],
			exitCode: 0,
			timedOut: false,
			raw: "",
			screen: "",
			snapshots: {
				usage: {
					raw: "",
					screen: `
└ Models & Quota

GEMINI MODELS
  Models within this group: Gemini Flash, Gemini Pro

  Weekly Limit
    [████████████████████████████████████░░░░░░░░░░░░░░] 71.69%
    72% remaining · Refreshes in 71h 49m

CLAUDE AND GPT MODELS
  Models within this group: Claude Opus, Claude Sonnet, GPT-OSS

  Weekly Limit
    [██████████████████████████████████████████████████] 99.94%
    100% remaining · Refreshes in 71h 46m
`,
				},
			},
			debug: [],
		});
	});

	afterEach(async () => {
		await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
		tempDirs = [];
	});

	it("uses the neutral omniagent state directory instead of unrelated trusted workspaces", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		const homeDir = await createTempDir("omniagent-agy-home-");
		const trustedWorkspace = path.join(homeDir, "trusted-workspace");
		const fallbackDir = path.join(homeDir, ".omniagent", "state", "usage", "antigravity-cli");
		await mkdir(trustedWorkspace, { recursive: true });
		await writeAgySettings(homeDir, {
			trustedWorkspaces: [trustedWorkspace],
		});

		const result = await extractAgyUsage(
			buildContext({
				homeDir,
				repoRoot: "/tmp/untrusted-repo",
			}),
		);

		const options = ptyMock.runPtyScenario.mock.calls[0]?.[0];
		expect(options.cwd).toBe(fallbackDir);
		expect(options.cwd).not.toBe(homeDir);
		expect(options.cwd).not.toBe(trustedWorkspace);
		expect(options.cwd).not.toBe("/tmp/untrusted-repo");
		expect(result.limits).toHaveLength(2);
		expect(result.limits[0]).toMatchObject({
			scope: "gemini_models",
			window: "weekly",
			label: "Gemini Models",
			percentRemaining: 71.69,
		});
		expect(result.limits[0]?.percentUsed).toBeCloseTo(28.31);
	});

	it("auto-accepts trust only for the managed usage directory", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		const homeDir = await createTempDir("omniagent-agy-home-");

		await extractAgyUsage(
			buildContext({
				homeDir,
				repoRoot: "/tmp/untrusted-repo",
			}),
		);

		const options = ptyMock.runPtyScenario.mock.calls[0]?.[0];
		const steps = options.steps as MockPtyStep[];
		const trustAcceptStep = steps[1];
		const readyAfterTrustStep = steps[2];
		const slashStep = steps.find((step) => step.write === "/");

		expect(trustAcceptStep?.write).toBe("\r");
		expect(
			trustAcceptStep?.skipIf?.({
				raw: "",
				screen: "Do you trust the contents of this project?",
			}),
		).toBe(false);
		expect(
			trustAcceptStep?.skipIf?.({
				raw: "",
				screen: "? for shortcuts",
			}),
		).toBe(true);
		expect(
			readyAfterTrustStep?.waitFor?.({
				raw: "Do you trust the contents of this project?",
				screen: "? for shortcuts",
			}),
		).toBe(true);
		expect(
			slashStep?.skipIf?.({
				raw: "Do you trust the contents of this project?",
				screen: "? for shortcuts",
			}),
		).toBe(false);
		expect(
			slashStep?.skipIf?.({
				raw: "",
				screen: "Do you trust the contents of this project?",
			}),
		).toBe(true);
	});

	it("does not auto-accept trust when falling back outside the managed usage directory", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		const homeDir = await createTempDir("omniagent-agy-home-");
		const repoRoot = path.join(homeDir, "repo");
		await mkdir(repoRoot, { recursive: true });
		await writeFile(path.join(homeDir, ".omniagent"), "not a directory", "utf8");

		await extractAgyUsage(
			buildContext({
				homeDir,
				repoRoot,
			}),
		);

		const options = ptyMock.runPtyScenario.mock.calls[0]?.[0];
		const steps = options.steps as MockPtyStep[];
		expect(options.cwd).toBe(repoRoot);
		expect(steps[1]?.write).toBe("/");
	});

	it("falls back to an empty omniagent state directory when no trusted workspace exists", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		const homeDir = await createTempDir("omniagent-agy-home-");
		const repoRoot = path.join(homeDir, "repo");
		await mkdir(repoRoot, { recursive: true });
		const fallbackDir = path.join(homeDir, ".omniagent", "state", "usage", "antigravity-cli");

		const result = await extractAgyUsage(
			buildContext({
				homeDir,
				repoRoot,
			}),
		);

		const options = ptyMock.runPtyScenario.mock.calls[0]?.[0];
		expect(options.cwd).toBe(fallbackDir);
		expect(options.cwd).not.toBe(homeDir);
		expect(options.cwd).not.toBe(repoRoot);
		await expect(access(fallbackDir)).resolves.toBeUndefined();
		expect(result.limits[0]).toMatchObject({
			scope: "gemini_models",
			window: "weekly",
			percentRemaining: 71.69,
		});
	});

	it("captures known sign-in failures instead of timing out waiting for usage rows", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");

		await extractAgyUsage(
			buildContext({
				homeDir: "/Users/tester",
				repoRoot: "/tmp/untrusted-repo",
			}),
		);

		const options = ptyMock.runPtyScenario.mock.calls[0]?.[0];
		const usageWait = options.steps.find((step: { capture?: string }) => step.capture === "usage");

		expect(usageWait.optional).toBe(true);
		expect(
			usageWait.waitFor({
				raw: "Antigravity is not signed in.",
				screen: "Antigravity is not signed in.",
			}),
		).toBe(true);
		expect(
			usageWait.waitFor({
				raw: "Signing in...",
				screen: "Signing in...",
			}),
		).toBe(false);
	});

	it("captures parser-recognized usage rows without requiring the Models & Quota heading", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");

		await extractAgyUsage(
			buildContext({
				homeDir: "/Users/tester",
				repoRoot: "/tmp/untrusted-repo",
			}),
		);

		const options = ptyMock.runPtyScenario.mock.calls[0]?.[0];
		const usageWait = options.steps.find((step: { capture?: string }) => step.capture === "usage");

		expect(
			usageWait.waitFor({
				raw: "GEMINI MODELS\r\nWeekly Limit\r\n72% remaining · Refreshes in 71h 49m\r\n",
				screen: "",
			}),
		).toBe(true);
	});

	it("reports the specific sign-in error when Antigravity is not authenticated", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		ptyMock.runPtyScenario.mockResolvedValueOnce({
			command: "agy",
			args: [],
			exitCode: 0,
			timedOut: false,
			raw: "Antigravity is not signed in.",
			screen: "Antigravity is not signed in.",
			snapshots: {
				usage: {
					raw: "Antigravity is not signed in.",
					screen: "Antigravity is not signed in.",
				},
			},
			debug: [],
		});

		await expect(
			extractAgyUsage(
				buildContext({
					homeDir: "/Users/tester",
					repoRoot: "/tmp/untrusted-repo",
				}),
			),
		).rejects.toThrow("Antigravity is not signed in. Run `agy` and complete the login.");
	});

	it("returns disabled quota buckets as usage rows without percentages", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		ptyMock.runPtyScenario.mockResolvedValueOnce({
			command: "agy",
			args: [],
			exitCode: 0,
			timedOut: false,
			raw: "",
			screen: "",
			snapshots: {
				usage: {
					raw: "",
					screen: `
└ Models & Quota

CLAUDE AND GPT MODELS
  Models within this group: Claude Opus, Claude Sonnet, GPT-OSS

  Weekly Limit
    Disabled
`,
				},
			},
			debug: [],
		});

		const result = await extractAgyUsage(
			buildContext({
				homeDir: "/Users/tester",
				repoRoot: "/tmp/untrusted-repo",
			}),
		);

		expect(result.limits).toHaveLength(1);
		expect(result.limits[0]).toMatchObject({
			scope: "claude_and_gpt_models",
			window: "weekly",
			label: "Claude And GPT Models",
			percentUsed: null,
			percentRemaining: null,
			remainingText: "Disabled",
			resetAt: null,
			resetText: null,
		});
		expect(result.limits[0]?.raw).toContain("Disabled");
	});

	it("reports the neutral launch directory if Antigravity still asks for trust", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		const homeDir = await createTempDir("omniagent-agy-home-");
		const repoRoot = path.join(homeDir, "repo");
		const fallbackDir = path.join(homeDir, ".omniagent", "state", "usage", "antigravity-cli");
		ptyMock.runPtyScenario.mockResolvedValueOnce({
			command: "agy",
			args: [],
			exitCode: 0,
			timedOut: false,
			raw: "Do you trust the contents of this project?",
			screen: "Do you trust the contents of this project?",
			snapshots: {},
			debug: [],
		});

		await expect(
			extractAgyUsage(
				buildContext({
					homeDir,
					repoRoot,
				}),
			),
		).rejects.toThrow(
			`Antigravity did not accept the managed usage launch directory trust prompt automatically. Run \`agy\` in ${fallbackDir} once, accept the trust prompt, then re-run usage.`,
		);
	});

	it("reports project trust when the managed usage directory cannot be created", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		const homeDir = await createTempDir("omniagent-agy-home-");
		const repoRoot = path.join(homeDir, "repo");
		await mkdir(repoRoot, { recursive: true });
		await writeFile(path.join(homeDir, ".omniagent"), "not a directory", "utf8");
		ptyMock.runPtyScenario.mockResolvedValueOnce({
			command: "agy",
			args: [],
			exitCode: 0,
			timedOut: false,
			raw: "Do you trust the contents of this project?",
			screen: "Do you trust the contents of this project?",
			snapshots: {},
			debug: [],
		});

		await expect(
			extractAgyUsage(
				buildContext({
					homeDir,
					repoRoot,
				}),
			),
		).rejects.toThrow(
			`Antigravity has not trusted this project yet. Run \`agy\` in ${repoRoot} once, accept the trust prompt, then re-run usage.`,
		);
	});
});

async function createTempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

async function writeAgySettings(homeDir: string, settings: unknown): Promise<void> {
	const settingsDir = path.join(homeDir, ".gemini", "antigravity-cli");
	await mkdir(settingsDir, { recursive: true });
	await writeFile(path.join(settingsDir, "settings.json"), JSON.stringify(settings), "utf8");
}

function buildContext(options: { homeDir: string; repoRoot: string }) {
	return {
		targetId: "agy",
		displayName: "Antigravity CLI",
		command: "agy",
		window: "weekly",
		windows: ["weekly"],
		now: new Date("2026-05-18T12:00:00.000Z"),
		repoRoot: options.repoRoot,
		agentsDir: `${options.repoRoot}/agents`,
		homeDir: options.homeDir,
		launch: {
			command: "agy",
			timeoutMs: 70_000,
		},
		signal: new AbortController().signal,
		debug: {
			enabled: false,
		},
	};
}
