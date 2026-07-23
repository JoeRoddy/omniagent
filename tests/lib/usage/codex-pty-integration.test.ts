import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractCodexUsage } from "../../../src/lib/usage/codex.js";
import type { UsageExtractionContext } from "../../../src/lib/usage/types.js";

// Simulates the Codex TUI startup flow: an optional trust prompt and an optional
// model-deprecation dialog in either order, followed by the composer prompt and a
// weekly-only /status response. The deprecation dialog handles numeric options immediately,
// matching Codex; selecting anything but "Use existing model" or sending trailing input in the
// same write dead-ends so tests fail if the probe switches the model or leaks an extra key.
const FAKE_CODEX_SCRIPT = String.raw`
const mode = process.argv[1];
const states = {
	"trust-migration": ["trust", "migration"],
	"migration-trust": ["migration", "trust"],
	migration: ["migration"],
	trust: ["trust"],
	incremental: [],
}[mode];
let state = states.shift() ?? "ready";
let input = "";

function render(content) {
	process.stdout.write("\x1b[2J\x1b[H" + content);
}

function renderState() {
	if (state === "trust") {
		render("Do you trust the contents of this directory?\r\n> 1. Yes, continue\r\n  2. No, exit");
	} else if (state === "migration") {
		render(
			[
				"GPT-5.4 Mini will be deprecated soon",
				"",
				"Codex now uses GPT-5.6 Luna in place of GPT-5.4 Mini.",
				"",
				"› 1. Try new model",
				"  2. Use existing model",
			].join("\r\n"),
		);
	} else if (state === "ready") {
		render("› Summarize recent commits\r\n\r\n  gpt-5.4-mini · Context 0% used");
	}
}

function advance() {
	state = states.shift() ?? "ready";
	renderState();
}

renderState();

process.stdin.setEncoding("utf8");
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on("data", (chunk) => {
	let migrationSelectionHandled = false;
	for (const character of chunk) {
		if (migrationSelectionHandled) {
			render("Unexpected trailing input after model selection.");
			state = "switched";
			continue;
		}
		if (state === "migration") {
			if (character === "2") {
				input = "";
				advance();
				migrationSelectionHandled = true;
			} else {
				render("Switching to GPT-5.6 Luna...");
				state = "switched";
			}
			continue;
		}
		if (character === "\x15") {
			input = "";
			continue;
		}
		if (character !== "\r" && character !== "\n") {
			input += character;
			continue;
		}
		const entered = input;
		input = "";
		if (entered === "/exit") {
			process.exit(0);
		}
		if (state === "trust") {
			advance();
			continue;
		}
		if (state === "ready" && entered === "/status") {
			if (mode === "incremental") {
				render("Model: gpt-5.4-mini\r\nWeekly limit: [██");
				setTimeout(() => {
					render(
						"Model: gpt-5.4-mini\r\nWeekly limit: [███░] 93% left (resets 13:03 on 28 Jul)",
					);
				}, 1_000);
				continue;
			}
			render(
				[
					"╭────────────────────╮",
					"│  >_ OpenAI Codex (v0.144.6)",
					"│",
					"│  Model:            gpt-5.4-mini (reasoning low)",
					"│  Directory:        ~",
					"│  Account:          user@example.com (Pro)",
					"│",
					"│  Weekly limit:     [███░] 93% left (resets 13:03 on 28 Jul)",
					"│  GPT-5.3-Codex-Spark Weekly limit: [████] 100% left (resets 16:38 on 28 Jul)",
					"╰────────────────────╯",
					"",
					"› Summarize recent commits",
					"",
					"  gpt-5.4-mini · Context 0% used",
				].join("\r\n"),
			);
		}
	}
});
`;

describe("Codex usage PTY integration", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(os.tmpdir(), "omniagent-codex-pty-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("dismisses a model-deprecation dialog shown after trust onboarding", async () => {
		const result = await extractCodexUsage(buildContext(tempDir, "trust-migration"));

		expect(result.limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual([
			"main:weekly",
			"spark:weekly",
		]);
	}, 15_000);

	it("dismisses a model-deprecation dialog shown before trust onboarding", async () => {
		const result = await extractCodexUsage(buildContext(tempDir, "migration-trust"));

		expect(result.limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual([
			"main:weekly",
			"spark:weekly",
		]);
	}, 15_000);

	it("dismisses a model-deprecation dialog when no trust prompt appears", async () => {
		const result = await extractCodexUsage(buildContext(tempDir, "migration"));

		expect(result.limits.map((limit) => limit.percentRemaining)).toEqual([93, 100]);
	}, 15_000);

	it("continues past the trust prompt when no deprecation dialog appears", async () => {
		const result = await extractCodexUsage(buildContext(tempDir, "trust"));

		expect(result.limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual([
			"main:weekly",
			"spark:weekly",
		]);
	}, 15_000);

	it("waits for an incrementally rendered main limit to include its percentage", async () => {
		const result = await extractCodexUsage(buildContext(tempDir, "incremental"));

		expect(result.limits.map((limit) => limit.percentRemaining)).toEqual([93]);
	}, 15_000);
});

function buildContext(
	homeDir: string,
	mode: "trust-migration" | "migration-trust" | "migration" | "trust" | "incremental",
): UsageExtractionContext {
	// homeDir has no .codex/auth.json, so extraction falls back to the TUI probe.
	return {
		targetId: "codex",
		displayName: "OpenAI Codex",
		command: process.execPath,
		window: "hourly",
		windows: ["hourly", "weekly"],
		now: new Date("2026-07-21T12:00:00.000Z"),
		repoRoot: homeDir,
		agentsDir: path.join(homeDir, "agents"),
		homeDir,
		launch: {
			command: process.execPath,
			args: ["-e", FAKE_CODEX_SCRIPT, mode],
			timeoutMs: 12_000,
		},
		signal: new AbortController().signal,
		debug: {
			enabled: false,
		},
	};
}
