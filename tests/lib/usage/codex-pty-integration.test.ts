import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractCodexUsage } from "../../../src/lib/usage/codex.js";
import type { UsageExtractionContext } from "../../../src/lib/usage/types.js";

type FakeCodexMode =
	| "trust-migration"
	| "migration-trust"
	| "migration"
	| "trust"
	| "incremental-main"
	| "incremental-spark"
	| "refresh"
	| "environment";

// Simulates the Codex startup states and current weekly-only /status output. Numeric migration
// options submit immediately; any trailing input after the selection deliberately dead-ends.
const FAKE_CODEX_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const mode = process.argv[1];
const expectedCodexHome = process.argv[2];
const states = {
	"trust-migration": ["trust", "migration"],
	"migration-trust": ["migration", "trust"],
	migration: ["migration"],
	trust: ["trust"],
	"incremental-main": [],
	"incremental-spark": [],
	refresh: [],
	environment: [],
}[mode];
let state = states.shift() ?? "ready";
let input = "";
let statusRequests = 0;

if (mode === "environment") {
	if (process.env.CODEX_HOME !== expectedCodexHome) {
		process.stderr.write("CODEX_HOME was replaced.");
		process.exit(2);
	}
	fs.writeFileSync(path.join(expectedCodexHome, "credential-refresh-marker"), "persisted");
}

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

function renderCompleteStatus(includeSpark = true) {
	const lines = [
		"╭────────────────────╮",
		"│  >_ OpenAI Codex (v0.144.6)",
		"│",
		"│  Model:            gpt-5.4-mini (reasoning low)",
		"│  Directory:        ~",
		"│  Account:          user@example.com (Pro)",
		"│",
		"│  Weekly limit:     [███░] 93% left (resets 13:03 on 28 Jul)",
	];
	if (includeSpark) {
		lines.push(
			"│  GPT-5.3-Codex-Spark Weekly limit: [████] 100% left (resets 16:38 on 28 Jul)",
		);
	}
	lines.push(
		"╰────────────────────╯",
		"",
		"› Summarize recent commits",
		"",
		"  gpt-5.4-mini · Context 0% used",
	);
	render(lines.join("\r\n"));
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
			state = "failed";
			continue;
		}
		if (state === "migration") {
			if (character === "2") {
				input = "";
				advance();
				migrationSelectionHandled = true;
			} else {
				render("Switching to GPT-5.6 Luna...");
				state = "failed";
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
		if (state !== "ready" || entered !== "/status") {
			continue;
		}

		statusRequests += 1;
		if (mode === "refresh" && statusRequests === 1) {
			render("Model: gpt-5.4-mini\r\nLimits: refresh requested; run /status again shortly.");
			continue;
		}
		if (mode === "incremental-main") {
			render("Model: gpt-5.4-mini\r\nWeekly limit: [██");
			setTimeout(() => renderCompleteStatus(false), 1_000);
			continue;
		}
		if (mode === "incremental-spark") {
			render(
				"Model: gpt-5.4-mini\r\nWeekly limit: 93% left\r\n" +
					"GPT-5.3-Codex-Spark Weekly limit: [██",
			);
			setTimeout(() => renderCompleteStatus(true), 1_000);
			continue;
		}
		renderCompleteStatus(true);
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

	it.each([
		["after trust onboarding", "trust-migration"],
		["before trust onboarding", "migration-trust"],
		["without trust onboarding", "migration"],
		["when only trust onboarding appears", "trust"],
	] as const)(
		"handles the model-migration dialog %s",
		async (_description, mode) => {
			const result = await extractCodexUsage(buildContext(tempDir, mode));

			expect(result.limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual([
				"main:weekly",
				"spark:weekly",
			]);
		},
		15_000,
	);

	it("waits for an incrementally rendered main limit", async () => {
		const result = await extractCodexUsage(buildContext(tempDir, "incremental-main"));

		expect(result.limits.map((limit) => limit.percentRemaining)).toEqual([93]);
	}, 15_000);

	it("waits for an incrementally rendered Spark limit", async () => {
		const result = await extractCodexUsage(buildContext(tempDir, "incremental-spark"));

		expect(result.limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual([
			"main:weekly",
			"spark:weekly",
		]);
		expect(result.limits.map((limit) => limit.percentRemaining)).toEqual([93, 100]);
	}, 15_000);

	it("retries status after Codex reports that a refresh was requested", async () => {
		const result = await extractCodexUsage(buildContext(tempDir, "refresh"));

		expect(result.limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual([
			"main:weekly",
			"spark:weekly",
		]);
	}, 15_000);

	it("preserves the active CODEX_HOME for fallback credential updates", async () => {
		const activeCodexHome = path.join(tempDir, "active-codex-home");
		await mkdir(activeCodexHome, { recursive: true });
		const originalCodexHome = process.env.CODEX_HOME;
		process.env.CODEX_HOME = activeCodexHome;
		try {
			const result = await extractCodexUsage(buildContext(tempDir, "environment", activeCodexHome));

			expect(result.limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual([
				"main:weekly",
				"spark:weekly",
			]);
			expect(await readFile(path.join(activeCodexHome, "credential-refresh-marker"), "utf8")).toBe(
				"persisted",
			);
		} finally {
			if (originalCodexHome == null) {
				delete process.env.CODEX_HOME;
			} else {
				process.env.CODEX_HOME = originalCodexHome;
			}
		}
	}, 15_000);
});

function buildContext(
	homeDir: string,
	mode: FakeCodexMode,
	expectedCodexHome = "",
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
			args: ["--input-type=commonjs", "-e", FAKE_CODEX_SCRIPT, mode, expectedCodexHome],
			timeoutMs: 12_000,
		},
		signal: new AbortController().signal,
		debug: {
			enabled: false,
		},
	};
}
