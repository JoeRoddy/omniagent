import { buildClaudeUsageLimits, parseClaudeUsage } from "../../../src/lib/usage/claude.js";
import { buildCodexUsageLimits, parseCodexStatus } from "../../../src/lib/usage/codex.js";
import {
	cleanControlOutput,
	makeUsageLimit,
	normalizeUsageWindow,
	parsePercentRemaining,
	parsePercentUsed,
	parseResetAt,
	parseResetText,
} from "../../../src/lib/usage/format.js";
import { parseGeminiModelDialog } from "../../../src/lib/usage/gemini.js";

describe("usage parser utilities", () => {
	it("cleans control output and parses common limit fragments", () => {
		const raw = "\x1b[32m85% left (resets 14:30 on 18 May)\x1b[0m\r\n";
		const cleaned = cleanControlOutput(raw).trim();

		expect(cleaned).toBe("85% left (resets 14:30 on 18 May)");
		expect(parsePercentRemaining(cleaned)).toBe(85);
		expect(parsePercentUsed("12.5% used")).toBe(12.5);
		expect(parseResetText(cleaned)).toBe("resets 14:30 on 18 May");
	});

	it("normalizes reset timestamps and hourly windows", () => {
		const now = new Date("2026-05-18T12:00:00.000Z");

		expect(parseResetAt("resets 14:30 on 18 May", { now, sourceTimeZone: "utc" })).toBe(
			"2026-05-18T14:30:00.000Z",
		);
		expect(
			makeUsageLimit({
				targetId: "codex",
				scope: "main",
				window: "5h",
				percentUsed: 15,
				percentRemaining: 85,
				resetText: "resets 14:30 on 18 May",
				raw: "85% left (resets 14:30 on 18 May)",
				now,
				resetSourceTimeZone: "utc",
			}),
		).toMatchObject({
			id: "codex.main.hourly",
			targetId: "codex",
			window: "hourly",
			percentUsed: 15,
			percentRemaining: 85,
			resetAt: "2026-05-18T14:30:00.000Z",
		});
	});

	it("canonicalizes known windows regardless of casing", () => {
		expect(normalizeUsageWindow("Weekly")).toBe("weekly");
		expect(normalizeUsageWindow("CURRENT_WEEK")).toBe("weekly");
		expect(normalizeUsageWindow("Hourly")).toBe("hourly");
		expect(normalizeUsageWindow("five-hour")).toBe("hourly");
		expect(normalizeUsageWindow("SESSION")).toBe("hourly");
		expect(normalizeUsageWindow("Model")).toBe("model");
		expect(normalizeUsageWindow("Custom_Window")).toBe("custom_window");
	});
});

describe("Codex usage parser", () => {
	it("parses main and Spark status limits", () => {
		const parsed = parseCodexStatus(`
╭──────────────────────────╮
│ Model: gpt-5.1-codex     │
│ Directory: /repo         │
│ Account: user@example.com│
│ 5h limit: 85% left       │
│   (resets 14:30 on 18 May)
│ Weekly limit: 41% left (resets May 25 at 9am)
│ GPT-5.3-Codex-Spark limit:
│ 5h limit: 90% left
│ Weekly limit: 60% left (resets May 25)
╰──────────────────────────╯
› /exit  exit Codex
`);

		expect(parsed).toMatchObject({
			model: "gpt-5.1-codex",
			account: "user@example.com",
			main5hLimit: "85% left (resets 14:30 on 18 May)",
			mainWeeklyLimit: "41% left (resets May 25 at 9am)",
			spark5hLimit: "90% left",
			sparkWeeklyLimit: "60% left (resets May 25)",
		});
	});

	it("parses Codex limits after an initial refresh-requested status", () => {
		const parsed = parseCodexStatus(`
╭──────────────────────────╮
│ Model: gpt-5.1-codex     │
│ Limits: refresh requested; run /status again shortly.
╰──────────────────────────╯

› /status

╭──────────────────────────╮
│ Model: gpt-5.1-codex     │
│ 5h limit: 79% left (resets 12:24)
│ Weekly limit: 82% left (resets 17:18 on 23 May)
│ GPT-5.3-Codex-Spark limit:
│ 5h limit: 100% left (resets 16:39)
│ Weekly limit: 100% left (resets 08:31 on 24 May)
╰──────────────────────────╯

› exit
gpt-5.5 xhigh · Context 0% used
`);

		expect(parsed).toMatchObject({
			main5hLimit: "79% left (resets 12:24)",
			mainWeeklyLimit: "82% left (resets 17:18 on 23 May)",
			spark5hLimit: "100% left (resets 16:39)",
			sparkWeeklyLimit: "100% left (resets 08:31 on 24 May)",
		});
	});

	it("omits absent limit rows when building normalized results", () => {
		const limits = buildCodexUsageLimits(
			{
				model: "",
				directory: "",
				permissions: "",
				agentsMd: "",
				account: "",
				collaborationMode: "",
				session: "",
				main5hLimit: "85% left",
				mainWeeklyLimit: "",
				spark5hLimit: " ",
				sparkWeeklyLimit: "60% left",
			},
			{ targetId: "codex", now: new Date("2026-05-18T12:00:00.000Z") },
		);

		expect(limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual([
			"main:hourly",
			"spark:weekly",
		]);
		expect(limits.map((limit) => limit.percentRemaining)).toEqual([85, 60]);
	});
});

describe("Claude usage parser", () => {
	it("parses current session and current week usage", () => {
		const parsed = parseClaudeUsage(`
Current session
  37% used
  Resets 3pm

Current week
  64% used
  Resets May 25 at 9am
`);

		expect(parsed).toEqual({
			currentSessionUsed: "37% used",
			currentSessionResets: "3pm",
			currentWeekUsed: "64% used",
			currentWeekResets: "May 25 at 9am",
		});
	});

	it("omits absent current session or week rows when building normalized results", () => {
		const limits = buildClaudeUsageLimits(
			{
				currentSessionUsed: "",
				currentSessionResets: "",
				currentWeekUsed: "64% used",
				currentWeekResets: "May 25 at 9am",
			},
			{ targetId: "claude", now: new Date("2026-05-18T12:00:00.000Z") },
		);

		expect(limits).toHaveLength(1);
		expect(limits[0]).toMatchObject({
			scope: "current_week",
			window: "weekly",
			percentUsed: 64,
			percentRemaining: 36,
		});
	});
});

describe("Gemini usage parser", () => {
	it("parses selected models and usage rows", () => {
		const parsed = parseGeminiModelDialog(`
│ ● 1. gemini-2.5-pro │
│   2. gemini-2.5-flash │
│ Model usage │
│ Flash       █████     21% Resets: 4pm │
│ Pro         ▬▬▬       73% Resets: May 25 │
│ gemini-2.5-pro-exp…   5% │
│ (Esc to close) │
`);

		expect(parsed.selectedModel).toBe("gemini-2.5-pro");
		expect(parsed.availableModels).toEqual(["gemini-2.5-pro", "gemini-2.5-flash"]);
		expect(parsed.usage).toEqual([
			{
				name: "Flash",
				percentUsed: 21,
				resetText: "4pm",
				raw: "Flash       █████     21% Resets: 4pm",
			},
			{
				name: "Pro",
				percentUsed: 73,
				resetText: "May 25",
				raw: "Pro         ▬▬▬       73% Resets: May 25",
			},
			{
				name: "gemini-2.5-pro-exp…",
				percentUsed: 5,
				resetText: "",
				raw: "gemini-2.5-pro-exp…   5%",
			},
		]);
	});
});
