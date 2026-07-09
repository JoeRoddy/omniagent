import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

const ptyMock = vi.hoisted(() => ({
	runPtyScenario: vi.fn(),
}));

let tempDirs: string[] = [];

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

	it("runs the usage probe from an existing Antigravity trusted workspace", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		const homeDir = await createTempDir("omniagent-agy-home-");
		const trustedWorkspace = path.join(homeDir, "trusted-workspace");
		await mkdir(trustedWorkspace, { recursive: true });
		await writeAgySettings(homeDir, {
			trustedWorkspaces: [path.join(homeDir, "stale-workspace"), trustedWorkspace],
		});

		const result = await extractAgyUsage(
			buildContext({
				homeDir,
				repoRoot: "/tmp/untrusted-repo",
			}),
		);

		const options = ptyMock.runPtyScenario.mock.calls[0]?.[0];
		expect(options.cwd).toBe(trustedWorkspace);
		expect(options.cwd).not.toBe(homeDir);
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

	it("falls back to home when Antigravity has no trusted workspace setting", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");

		const result = await extractAgyUsage(
			buildContext({
				homeDir: "/Users/tester",
				repoRoot: "/tmp/untrusted-repo",
			}),
		);

		const options = ptyMock.runPtyScenario.mock.calls[0]?.[0];
		expect(options.cwd).toBe("/Users/tester");
		expect(options.cwd).not.toBe("/tmp/untrusted-repo");
		expect(result.limits[0]).toMatchObject({
			scope: "gemini_models",
			window: "weekly",
			percentRemaining: 71.69,
		});
	});

	it("reports the neutral launch directory if Antigravity still asks for trust", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
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
					homeDir: "/Users/tester",
					repoRoot: "/tmp/untrusted-repo",
				}),
			),
		).rejects.toThrow(
			"Antigravity has not trusted the usage launch directory yet. Run `agy` in /Users/tester once, accept the trust prompt, then re-run usage.",
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
