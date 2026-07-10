import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractAgyUsage } from "../../../src/lib/usage/agy.js";
import type { UsageConfirmation, UsageExtractionContext } from "../../../src/lib/usage/types.js";

const FAKE_AGY_SCRIPT = String.raw`
const mode = process.argv[1];
let state = mode === "trust" ? "trust" : "sign-in";
let input = "";

function render(content) {
	process.stdout.write("\x1b[2J\x1b[H" + content);
}

function renderReady() {
	state = "ready";
	render("Antigravity\r\n? for shortcuts");
}

function renderUsage() {
	state = "usage";
	render([
		"└ Models & Quota",
		"",
		"GEMINI MODELS",
		"  Models within this group: Gemini Flash, Gemini Pro",
		"",
		"  Weekly Limit",
		"    72% remaining · Refreshes in 71h 49m",
	].join("\r\n"));
}

if (state === "trust") {
	render("Do you trust the contents of this project?");
} else {
	render("Antigravity is not signed in.");
	setTimeout(renderReady, 75);
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
			renderReady();
			continue;
		}
		if (state === "ready" && input === "/usage") {
			input = "";
			state = "loading";
			render("Loading Models & Quota...");
			setTimeout(renderUsage, 800);
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
});

function buildContext(
	homeDir: string,
	mode: "trust" | "stale-auth",
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
			timeoutMs: 8_000,
		},
		signal: new AbortController().signal,
		confirm,
		debug: {
			enabled: false,
		},
	};
}
