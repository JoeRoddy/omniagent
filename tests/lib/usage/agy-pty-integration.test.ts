import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractAgyUsage } from "../../../src/lib/usage/agy.js";
import type { UsageConfirmation, UsageExtractionContext } from "../../../src/lib/usage/types.js";

const FAKE_AGY_SCRIPT = String.raw`
const mode = process.argv[1];
const trustMode =
	mode === "trust" || mode === "delayed-trust" || mode === "trust-login-selection";
const loginSelectionMode = mode === "login-selection";
let state = trustMode ? "trust" : "sign-in";
let input = "";

function render(content) {
	process.stdout.write("\x1b[2J\x1b[H" + content);
}

function renderReady() {
	state = "ready";
	render("Antigravity\r\n? for shortcuts");
}

function renderLoginSelection() {
	state = "login-selection";
	render([
		"Welcome to the Antigravity CLI. You are currently not signed in.",
		"",
		"Select login method:",
		"> 1. Google OAuth",
		"  2. Use a Google Cloud project",
	].join("\r\n"));
}

function renderUsage(includeClaude = false) {
	state = "usage";
	const lines = [
		"└ Models & Quota",
		"",
		"GEMINI MODELS",
		"  Models within this group: Gemini Flash, Gemini Pro",
		"",
		"  Weekly Limit",
		"    72% remaining · Refreshes in 71h 49m",
	];
	if (includeClaude) {
		lines.push(
			"",
			"CLAUDE AND GPT MODELS",
			"  Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
			"",
			"  Weekly Limit",
			"    55% remaining · Refreshes in 40h 10m",
		);
	}
	render(lines.join("\r\n"));
}

if (state === "trust") {
	render("Do you trust the contents of this project?");
} else if (loginSelectionMode) {
	renderLoginSelection();
} else {
	render("Antigravity is not signed in.");
	setTimeout(renderReady, mode === "delayed-auth" ? 2500 : 75);
}

process.stdin.setEncoding("utf8");
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on("data", (chunk) => {
	for (const character of chunk) {
		if (character === "\x1b") {
			process.exit(0);
		}
		if (character !== "\r" && character !== "\n") {
			input += character;
			continue;
		}
		if (state === "trust") {
			input = "";
			if (mode === "trust-login-selection") {
				renderLoginSelection();
				continue;
			}
			state = "loading";
			render("Loading trusted project...");
			setTimeout(renderReady, mode === "delayed-trust" ? 5250 : 0);
			continue;
		}
		if (state === "ready" && input === "/usage") {
			input = "";
			state = "loading";
			render("Loading Models & Quota...");
			setTimeout(() => {
				renderUsage(false);
				if (mode === "incremental-usage") {
					setTimeout(() => renderUsage(true), 1300);
				}
			}, 800);
		}
	}
});
`;

describe("Antigravity usage PTY integration", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(os.tmpdir(), "omniagent-agy-pty-"));
		await mkdir(path.join(tempDir, "repo"), { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("forwards approval, waits for ready, and enters /usage through the real PTY runner", async () => {
		const managedPath = path.join(tempDir, ".omniagent", "state", "usage", "antigravity-cli");
		const confirm = vi.fn<UsageConfirmation>().mockResolvedValue(true);

		const result = await extractAgyUsage(buildContext(tempDir, "trust", confirm));

		expect(confirm).toHaveBeenCalledWith({
			type: "trust-directory",
			targetId: "agy",
			displayName: "Antigravity CLI",
			path: managedPath,
			managed: true,
		});
		expect(result.limits).toHaveLength(1);
		expect(result.limits[0]).toMatchObject({
			scope: "gemini_models",
			percentRemaining: 72,
		});
	}, 10_000);

	it("ignores stale raw sign-in output once the current screen is ready", async () => {
		const result = await extractAgyUsage(buildContext(tempDir, "stale-auth"));

		expect(result.limits[0]).toMatchObject({
			scope: "gemini_models",
			percentRemaining: 72,
		});
	}, 10_000);

	it("waits through automatic authentication that exceeds the old stabilization window", async () => {
		const result = await extractAgyUsage(buildContext(tempDir, "delayed-auth"));

		expect(result.limits[0]).toMatchObject({
			scope: "gemini_models",
			percentRemaining: 72,
		});
	}, 15_000);

	it("reports the definitive login-selection screen without waiting for startup timeout", async () => {
		await expect(extractAgyUsage(buildContext(tempDir, "login-selection"))).rejects.toThrow(
			`Antigravity is not signed in. Run \`${process.execPath}\` and complete the login.`,
		);
	});

	it("reports login selection immediately after trust approval", async () => {
		const confirm = vi.fn<UsageConfirmation>().mockResolvedValue(true);

		await expect(
			extractAgyUsage(buildContext(tempDir, "trust-login-selection", confirm)),
		).rejects.toThrow(
			`Antigravity is not signed in. Run \`${process.execPath}\` and complete the login.`,
		);
		expect(confirm).toHaveBeenCalledOnce();
	}, 10_000);

	it("waits for readiness after trust beyond the old five-second deadline", async () => {
		const confirm = vi.fn<UsageConfirmation>().mockResolvedValue(true);
		const result = await extractAgyUsage(buildContext(tempDir, "delayed-trust", confirm));

		expect(confirm).toHaveBeenCalledOnce();
		expect(result.limits[0]).toMatchObject({
			scope: "gemini_models",
			percentRemaining: 72,
		});
	}, 15_000);

	it("waits for an incrementally rendered quota panel to stabilize", async () => {
		const result = await extractAgyUsage(buildContext(tempDir, "incremental-usage"));

		expect(result.limits.map((limit) => limit.scope)).toEqual([
			"gemini_models",
			"claude_and_gpt_models",
		]);
	}, 15_000);
});

function buildContext(
	homeDir: string,
	mode:
		| "trust"
		| "delayed-trust"
		| "trust-login-selection"
		| "stale-auth"
		| "delayed-auth"
		| "login-selection"
		| "incremental-usage",
	confirm?: UsageConfirmation,
): UsageExtractionContext {
	const repoRoot = path.join(homeDir, "repo");
	return {
		targetId: "agy",
		displayName: "Antigravity CLI",
		command: process.execPath,
		window: "weekly",
		windows: ["weekly"],
		now: new Date("2026-05-18T12:00:00.000Z"),
		repoRoot,
		agentsDir: path.join(repoRoot, "agents"),
		homeDir,
		launch: {
			command: process.execPath,
			args: ["-e", FAKE_AGY_SCRIPT, mode],
			timeoutMs: mode === "login-selection" || mode === "trust-login-selection" ? 3_000 : 12_000,
		},
		signal: new AbortController().signal,
		confirm,
		debug: {
			enabled: false,
		},
	};
}
