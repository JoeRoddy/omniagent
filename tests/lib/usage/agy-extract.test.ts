import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import type { UsageConfirmation } from "../../../src/lib/usage/types.js";

const ptyMock = vi.hoisted(() => ({
	runPtyScenario: vi.fn(),
}));

let tempDirs: string[] = [];

type MockPtyStep = {
	capture?: string;
	write?:
		| string
		| ((snapshot: {
				raw: string;
				screen: string;
		  }) => string | undefined | Promise<string | undefined>);
	skipIf?: (snapshot: { raw: string; screen: string }) => boolean;
	waitFor?: (snapshot: { raw: string; screen: string }) => boolean;
	optional?: boolean;
	waitForTimeoutMs?: number;
};

vi.mock("../../../src/lib/usage/pty.js", () => ({
	enterKey: () => "\r",
	escapeKey: () => "\x1b",
	runPtyScenario: ptyMock.runPtyScenario,
}));

describe("Antigravity usage extraction", () => {
	beforeEach(() => {
		ptyMock.runPtyScenario.mockReset();
		ptyMock.runPtyScenario.mockResolvedValue(buildUsagePtyResult());
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

	it("forwards explicit approval to the managed usage directory trust prompt", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		const homeDir = await createTempDir("omniagent-agy-home-");
		const fallbackDir = path.join(homeDir, ".omniagent", "state", "usage", "antigravity-cli");
		const confirm = vi.fn().mockResolvedValue(true);
		let forwardedKey: string | undefined;
		ptyMock.runPtyScenario.mockImplementationOnce(async (options) => {
			const steps = options.steps as MockPtyStep[];
			const [trustDecisionStep, trustForwardStep, prepareUsageStep] = dynamicWriteSteps(steps);
			expect(await resolveStepWrite(trustDecisionStep, trustSnapshot())).toBeUndefined();
			forwardedKey = await resolveStepWrite(trustForwardStep, trustSnapshot());
			await resolveStepWrite(prepareUsageStep, readySnapshot());
			return buildUsagePtyResult();
		});

		const result = await extractAgyUsage(
			buildContext({
				homeDir,
				repoRoot: "/tmp/untrusted-repo",
				confirm,
			}),
		);

		const options = ptyMock.runPtyScenario.mock.calls[0]?.[0];
		const steps = options.steps as MockPtyStep[];
		const readyAfterTrustStep = steps.find((step) => step.waitForTimeoutMs === 5_000);

		expect(options.cwd).toBe(fallbackDir);
		expect(forwardedKey).toBe("\r");
		expect(readyAfterTrustStep?.optional).toBe(true);
		expect(confirm).toHaveBeenCalledWith({
			type: "trust-directory",
			targetId: "agy",
			displayName: "Antigravity CLI",
			path: fallbackDir,
			managed: true,
		});
		expect(result.limits).toHaveLength(2);
	});

	it("requests explicit approval for the project fallback directory", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		const homeDir = await createTempDir("omniagent-agy-home-");
		const repoRoot = path.join(homeDir, "repo");
		const confirm = vi.fn().mockResolvedValue(true);
		await mkdir(repoRoot, { recursive: true });
		await writeFile(path.join(homeDir, ".omniagent"), "not a directory", "utf8");
		ptyMock.runPtyScenario.mockImplementationOnce(async (options) => {
			const [trustDecisionStep, trustForwardStep, prepareUsageStep] = dynamicWriteSteps(
				options.steps as MockPtyStep[],
			);
			expect(await resolveStepWrite(trustDecisionStep, trustSnapshot())).toBeUndefined();
			expect(await resolveStepWrite(trustForwardStep, trustSnapshot())).toBe("\r");
			await resolveStepWrite(prepareUsageStep, readySnapshot());
			return buildUsagePtyResult();
		});

		await extractAgyUsage(
			buildContext({
				homeDir,
				repoRoot,
				confirm,
			}),
		);

		const options = ptyMock.runPtyScenario.mock.calls[0]?.[0];
		expect(options.cwd).toBe(repoRoot);
		expect(confirm).toHaveBeenCalledWith(
			expect.objectContaining({ path: repoRoot, managed: false }),
		);
	});

	it("does not forward a trust key if the prompt changes while confirmation is pending", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		const homeDir = await createTempDir("omniagent-agy-home-");
		let resolveConfirmation: ((approved: boolean) => void) | undefined;
		const confirmation = new Promise<boolean>((resolve) => {
			resolveConfirmation = resolve;
		});
		const confirm = vi.fn(() => confirmation);
		let forwardedKey: string | undefined;
		ptyMock.runPtyScenario.mockImplementationOnce(async (options) => {
			const [trustDecisionStep, trustForwardStep, prepareUsageStep] = dynamicWriteSteps(
				options.steps as MockPtyStep[],
			);
			const decision = resolveStepWrite(trustDecisionStep, trustSnapshot());
			await Promise.resolve();
			resolveConfirmation?.(true);
			expect(await decision).toBeUndefined();
			forwardedKey = await resolveStepWrite(trustForwardStep, readySnapshot());
			await resolveStepWrite(prepareUsageStep, readySnapshot());
			return buildUsagePtyResult();
		});

		const result = await extractAgyUsage(
			buildContext({
				homeDir,
				repoRoot: "/tmp/untrusted-repo",
				confirm,
			}),
		);

		expect(forwardedKey).toBeUndefined();
		expect(result.limits).toHaveLength(2);
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
		const startupWait = options.steps[0];
		const stabilizationWait = options.steps[1];
		const usageWait = options.steps.find((step: { capture?: string }) => step.capture === "usage");

		expect(usageWait.optional).toBe(true);
		expect(
			startupWait.waitFor({
				raw: "Antigravity is not signed in.",
				screen: "Antigravity is not signed in.",
			}),
		).toBe(true);
		expect(
			stabilizationWait.waitFor({
				raw: "Antigravity is not signed in.",
				screen: "Antigravity is not signed in.",
			}),
		).toBe(false);
		expect(
			usageWait.waitFor({
				raw: "Antigravity is not signed in.",
				screen: "Antigravity is not signed in.",
			}),
		).toBe(true);
		expect(
			usageWait.waitFor({
				raw: "Antigravity is not signed in.\nSigning in...",
				screen: "Loading Models & Quota...",
			}),
		).toBe(false);
		expect(
			usageWait.waitFor({
				raw: "Antigravity is not signed in.\nSigning in...",
				screen: "Signing in...",
			}),
		).toBe(false);
		expect(
			stabilizationWait.waitFor({
				raw: "Antigravity is not signed in.\nSigning in...",
				screen: "? for shortcuts",
			}),
		).toBe(true);
	});

	it("does not type or dismiss the screen when the current state is signed out", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		const signInSnapshot = {
			raw: "Antigravity is not signed in.",
			screen: "Antigravity is not signed in.",
		};
		const writes: Array<string | undefined> = [];
		ptyMock.runPtyScenario.mockImplementationOnce(async (options) => {
			const steps = options.steps as MockPtyStep[];
			const [, , prepareUsageStep] = dynamicWriteSteps(steps);
			await resolveStepWrite(prepareUsageStep, signInSnapshot);
			for (const step of usageWriteSteps(steps)) {
				writes.push(await resolveStepWrite(step, signInSnapshot));
			}
			return buildEmptyPtyResult(signInSnapshot);
		});

		await expect(
			extractAgyUsage(
				buildContext({
					homeDir: "/Users/tester",
					repoRoot: "/tmp/untrusted-repo",
				}),
			),
		).rejects.toThrow("Antigravity is not signed in");
		expect(writes).toHaveLength(8);
		expect(writes.every((write) => write == null)).toBe(true);
	});

	it("rechecks the live screen before Enter and Escape", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		const blockedSnapshot = {
			raw: "? for shortcuts\nDo you trust the contents of this project?",
			screen: "? for shortcuts\nDo you trust the contents of this project?",
		};
		let commandEnter: string | undefined;
		let cleanupEscape: string | undefined;
		ptyMock.runPtyScenario.mockImplementationOnce(async (options) => {
			const steps = options.steps as MockPtyStep[];
			const [, , prepareUsageStep] = dynamicWriteSteps(steps);
			await resolveStepWrite(prepareUsageStep, readySnapshot());
			const writes = usageWriteSteps(steps);
			for (const step of writes.slice(0, 6)) {
				expect(await resolveStepWrite(step, readySnapshot())).toBeTypeOf("string");
			}
			commandEnter = await resolveStepWrite(writes[6] as MockPtyStep, blockedSnapshot);
			cleanupEscape = await resolveStepWrite(writes[7] as MockPtyStep, blockedSnapshot);
			return buildEmptyPtyResult(blockedSnapshot);
		});

		await expect(
			extractAgyUsage(
				buildContext({
					homeDir: "/Users/tester",
					repoRoot: "/tmp/untrusted-repo",
				}),
			),
		).rejects.toMatchObject({ code: "trust_required" });
		expect(commandEnter).toBeUndefined();
		expect(cleanupEscape).toBeUndefined();
	});

	it("stops all remaining writes when authentication starts transitioning", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		const signingInSnapshot = {
			raw: "Signing in...",
			screen: "Signing in...",
		};
		const writes: Array<string | undefined> = [];
		ptyMock.runPtyScenario.mockImplementationOnce(async (options) => {
			const steps = options.steps as MockPtyStep[];
			const [, , prepareUsageStep] = dynamicWriteSteps(steps);
			await resolveStepWrite(prepareUsageStep, readySnapshot());
			const usageWrites = usageWriteSteps(steps);
			writes.push(await resolveStepWrite(usageWrites[0] as MockPtyStep, readySnapshot()));
			writes.push(await resolveStepWrite(usageWrites[1] as MockPtyStep, signingInSnapshot));
			for (const step of usageWrites.slice(2)) {
				writes.push(await resolveStepWrite(step, readySnapshot()));
			}
			return buildEmptyPtyResult(signingInSnapshot);
		});

		await expect(
			extractAgyUsage(
				buildContext({
					homeDir: "/Users/tester",
					repoRoot: "/tmp/untrusted-repo",
				}),
			),
		).rejects.toThrow("Antigravity /usage output did not include");
		expect(writes[0]).toBe("/");
		expect(writes.slice(1).every((write) => write == null)).toBe(true);
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
		const staleUsage = "GEMINI MODELS\nWeekly Limit\n72% remaining · Refreshes in 71h 49m";
		ptyMock.runPtyScenario.mockResolvedValueOnce({
			command: "agy",
			args: [],
			exitCode: 0,
			timedOut: false,
			raw: `${staleUsage}\nAntigravity is not signed in.`,
			screen: "Antigravity is not signed in.",
			snapshots: {
				usage: {
					raw: `${staleUsage}\nAntigravity is not signed in.`,
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

	it("does not treat stale raw sign-in text as the current authentication state", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		ptyMock.runPtyScenario.mockResolvedValueOnce({
			command: "agy",
			args: [],
			exitCode: 0,
			timedOut: false,
			raw: "Antigravity is not signed in.",
			screen: "? for shortcuts",
			snapshots: {
				usage: {
					raw: "Antigravity is not signed in.",
					screen: "Loading Models & Quota...",
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
		).rejects.toThrow("Antigravity /usage output did not include Models & Quota limit groups.");
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

	it("returns trust_required when confirmation is unavailable", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		const homeDir = await createTempDir("omniagent-agy-home-");
		const repoRoot = path.join(homeDir, "repo");
		const fallbackDir = path.join(homeDir, ".omniagent", "state", "usage", "antigravity-cli");
		ptyMock.runPtyScenario.mockImplementationOnce(async (options) => {
			const steps = options.steps as MockPtyStep[];
			const [trustDecisionStep, trustForwardStep, prepareUsageStep] = dynamicWriteSteps(steps);
			expect(await resolveStepWrite(trustDecisionStep, trustSnapshot())).toBeUndefined();
			expect(await resolveStepWrite(trustForwardStep, trustSnapshot())).toBeUndefined();
			await resolveStepWrite(prepareUsageStep, trustSnapshot());
			expect(
				await resolveStepWrite(usageWriteSteps(steps).at(-1) as MockPtyStep, trustSnapshot()),
			).toBeUndefined();
			return buildEmptyPtyResult(trustSnapshot());
		});

		await expect(
			extractAgyUsage(
				buildContext({
					homeDir,
					repoRoot,
				}),
			),
		).rejects.toMatchObject({
			code: "trust_required",
			message: expect.stringContaining(fallbackDir),
		});
	});

	it("forwards rejection as Escape and returns trust_denied", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		const homeDir = await createTempDir("omniagent-agy-home-");
		const repoRoot = path.join(homeDir, "repo");
		const confirm = vi.fn().mockResolvedValue(false);
		let forwardedKey: string | undefined;
		ptyMock.runPtyScenario.mockImplementationOnce(async (options) => {
			const [trustDecisionStep, trustForwardStep, prepareUsageStep] = dynamicWriteSteps(
				options.steps as MockPtyStep[],
			);
			expect(await resolveStepWrite(trustDecisionStep, trustSnapshot())).toBeUndefined();
			forwardedKey = await resolveStepWrite(trustForwardStep, trustSnapshot());
			await resolveStepWrite(prepareUsageStep, { raw: trustSnapshot().raw, screen: "" });
			return buildEmptyPtyResult({ raw: trustSnapshot().raw, screen: "" });
		});

		await expect(
			extractAgyUsage(
				buildContext({
					homeDir,
					repoRoot,
					confirm,
				}),
			),
		).rejects.toMatchObject({ code: "trust_denied" });
		expect(forwardedKey).toBe("\x1b");
	});

	it("returns a trust-specific failure when approval does not reach the ready screen", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		const homeDir = await createTempDir("omniagent-agy-home-");
		const repoRoot = path.join(homeDir, "repo");
		const confirm = vi.fn().mockResolvedValue(true);
		ptyMock.runPtyScenario.mockImplementationOnce(async (options) => {
			const steps = options.steps as MockPtyStep[];
			const [trustDecisionStep, trustForwardStep, prepareUsageStep] = dynamicWriteSteps(steps);
			expect(await resolveStepWrite(trustDecisionStep, trustSnapshot())).toBeUndefined();
			expect(await resolveStepWrite(trustForwardStep, trustSnapshot())).toBe("\r");
			await resolveStepWrite(prepareUsageStep, trustSnapshot());
			expect(
				await resolveStepWrite(usageWriteSteps(steps).at(-1) as MockPtyStep, trustSnapshot()),
			).toBeUndefined();
			return buildEmptyPtyResult(trustSnapshot());
		});

		await expect(
			extractAgyUsage(
				buildContext({
					homeDir,
					repoRoot,
					confirm,
				}),
			),
		).rejects.toMatchObject({ code: "trust_acceptance_failed" });
	});

	it("reports sign-in instead of failed trust after an approved prompt", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		const homeDir = await createTempDir("omniagent-agy-home-");
		const confirm = vi.fn().mockResolvedValue(true);
		const signInSnapshot = {
			raw: "Do you trust the contents of this project?\nAntigravity is not signed in.",
			screen: "Antigravity is not signed in.",
		};
		ptyMock.runPtyScenario.mockImplementationOnce(async (options) => {
			const [trustDecisionStep, trustForwardStep, prepareUsageStep] = dynamicWriteSteps(
				options.steps as MockPtyStep[],
			);
			expect(await resolveStepWrite(trustDecisionStep, trustSnapshot())).toBeUndefined();
			expect(await resolveStepWrite(trustForwardStep, trustSnapshot())).toBe("\r");
			await resolveStepWrite(prepareUsageStep, signInSnapshot);
			return buildEmptyPtyResult(signInSnapshot);
		});

		await expect(
			extractAgyUsage(
				buildContext({
					homeDir,
					repoRoot: "/tmp/untrusted-repo",
					confirm,
				}),
			),
		).rejects.toThrow("Antigravity is not signed in. Run `agy` and complete the login.");
	});

	it("does not reinterpret a later auth transition as failed trust acceptance", async () => {
		const { extractAgyUsage } = await import("../../../src/lib/usage/agy.js");
		const homeDir = await createTempDir("omniagent-agy-home-");
		const confirm = vi.fn().mockResolvedValue(true);
		const signingInSnapshot = {
			raw: "Signing in...",
			screen: "Signing in...",
		};
		ptyMock.runPtyScenario.mockImplementationOnce(async (options) => {
			const steps = options.steps as MockPtyStep[];
			const [trustDecisionStep, trustForwardStep, prepareUsageStep] = dynamicWriteSteps(steps);
			await resolveStepWrite(trustDecisionStep, trustSnapshot());
			await resolveStepWrite(trustForwardStep, trustSnapshot());
			await resolveStepWrite(prepareUsageStep, readySnapshot());
			await resolveStepWrite(usageWriteSteps(steps)[0] as MockPtyStep, signingInSnapshot);
			return buildEmptyPtyResult(signingInSnapshot);
		});

		await expect(
			extractAgyUsage(
				buildContext({
					homeDir,
					repoRoot: "/tmp/untrusted-repo",
					confirm,
				}),
			),
		).rejects.toMatchObject({
			message: "Antigravity /usage output did not include Models & Quota limit groups.",
		});
	});
});

function buildUsagePtyResult() {
	return {
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
	};
}

function buildEmptyPtyResult(snapshot: { raw: string; screen: string }) {
	return {
		command: "agy",
		args: [],
		exitCode: 0,
		timedOut: false,
		raw: snapshot.raw,
		screen: snapshot.screen,
		snapshots: { startup: snapshot },
		debug: [],
	};
}

function trustSnapshot(): { raw: string; screen: string } {
	return {
		raw: "Do you trust the contents of this project?",
		screen: "Do you trust the contents of this project?",
	};
}

function readySnapshot(): { raw: string; screen: string } {
	return { raw: "? for shortcuts", screen: "? for shortcuts" };
}

function dynamicWriteSteps(steps: MockPtyStep[]): [MockPtyStep, MockPtyStep, MockPtyStep] {
	const dynamicSteps = steps.filter((step) => typeof step.write === "function");
	const trustDecisionStep = dynamicSteps[0];
	const trustForwardStep = dynamicSteps[1];
	const prepareUsageStep = dynamicSteps[2];
	if (trustDecisionStep == null || trustForwardStep == null || prepareUsageStep == null) {
		throw new Error("Expected trust decision, forwarding, and usage preparation steps.");
	}
	return [trustDecisionStep, trustForwardStep, prepareUsageStep];
}

function usageWriteSteps(steps: MockPtyStep[]): MockPtyStep[] {
	return steps.filter((step) => typeof step.write === "function").slice(3);
}

async function resolveStepWrite(
	step: MockPtyStep,
	snapshot: { raw: string; screen: string },
): Promise<string | undefined> {
	if (typeof step.write !== "function") {
		throw new Error("Expected a dynamic PTY write step.");
	}
	return step.write(snapshot);
}

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

function buildContext(options: { homeDir: string; repoRoot: string; confirm?: UsageConfirmation }) {
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
		confirm: options.confirm,
		debug: {
			enabled: false,
		},
	};
}
