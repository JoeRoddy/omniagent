import {
	buildClaudeApiUsageResult,
	buildClaudeUsageLimits,
	extractClaudeAccessToken,
	parseClaudeUsage,
} from "../../../src/lib/usage/claude.js";
import {
	buildCodexApiUsageResult,
	buildCodexUsageLimits,
	buildCodexUsageResult,
	extractCodexBackendAuth,
	parseCodexStatus,
} from "../../../src/lib/usage/codex.js";
import {
	cleanControlOutput,
	makeUsageLimit,
	normalizeUsageWindow,
	parsePercentRemaining,
	parsePercentUsed,
	parseResetAt,
	parseResetText,
} from "../../../src/lib/usage/format.js";
import {
	buildGeminiApiUsageResult,
	extractGeminiOAuthCredentials,
	parseGeminiModelDialog,
} from "../../../src/lib/usage/gemini.js";

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
	it("builds Codex usage limits from the ChatGPT usage endpoint", () => {
		const now = new Date("2026-05-18T12:00:00.000Z");
		const result = buildCodexApiUsageResult(
			{
				rate_limit: {
					primary_window: {
						used_percent: 6,
						limit_window_seconds: 18_000,
						reset_at: now.getTime() / 1000 + 60 * 60,
					},
					secondary_window: {
						used_percent: 25,
						limit_window_seconds: 604_800,
						reset_at: now.getTime() / 1000 + 7 * 24 * 60 * 60,
					},
				},
				additional_rate_limits: [
					{
						limit_name: "GPT-5.3-Codex-Spark",
						metered_feature: "codex_bengalfox",
						rate_limit: {
							primary_window: {
								used_percent: 0,
								limit_window_seconds: 18_000,
								reset_at: now.getTime() / 1000 + 5 * 60 * 60,
							},
							secondary_window: {
								used_percent: 1,
								limit_window_seconds: 604_800,
								reset_at: now.getTime() / 1000 + 6 * 24 * 60 * 60,
							},
						},
					},
				],
			},
			{
				targetId: "codex",
				displayName: "OpenAI Codex",
				command: "codex",
				now,
			},
		);

		expect(result.limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual([
			"main:hourly",
			"main:weekly",
			"spark:hourly",
			"spark:weekly",
		]);
		expect(result.limits.map((limit) => limit.percentUsed)).toEqual([6, 25, 0, 1]);
		expect(result.limits.map((limit) => limit.percentRemaining)).toEqual([94, 75, 100, 99]);
		expect(result.limits[0]?.resetAt).toBe("2026-05-18T13:00:00.000Z");
		expect(result.limits[1]?.resetAt).toBe("2026-05-25T12:00:00.000Z");
	});

	it("requires complete main Codex API rate-limit windows", () => {
		expect(() =>
			buildCodexApiUsageResult(
				{
					rate_limit: {
						primary_window: {
							used_percent: 6,
							limit_window_seconds: 18_000,
						},
					},
				},
				{
					targetId: "codex",
					displayName: "OpenAI Codex",
					now: new Date("2026-05-18T12:00:00.000Z"),
				},
			),
		).toThrow("Codex usage API response did not include complete main rate-limit windows.");
	});

	it("extracts Codex ChatGPT backend auth from auth.json", () => {
		expect(
			extractCodexBackendAuth(
				JSON.stringify({
					tokens: {
						access_token: "access-token-value",
						account_id: "account-id-value",
					},
				}),
			),
		).toEqual({
			accessToken: "access-token-value",
			accountId: "account-id-value",
		});
		expect(extractCodexBackendAuth("{}")).toBeNull();
	});

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

	it("parses Spark limit headings without pinning the Codex model version", () => {
		const parsed = parseCodexStatus(`
╭──────────────────────────╮
│ Model: gpt-5.1-codex     │
│ 5h limit: 85% left       │
│ Weekly limit: 41% left
│ GPT-5.4-Codex-Spark limit:
│ 5h limit: 90% left
│ Weekly limit: 60% left
╰──────────────────────────╯
`);

		expect(parsed).toMatchObject({
			main5hLimit: "85% left",
			mainWeeklyLimit: "41% left",
			spark5hLimit: "90% left",
			sparkWeeklyLimit: "60% left",
		});
	});

	it("treats missing Codex Spark limits as optional", () => {
		const parsed = parseCodexStatus(`
╭──────────────────────────╮
│ Model: gpt-5.1-codex     │
│ 5h limit: 85% left       │
│ Weekly limit: 41% left
╰──────────────────────────╯
`);

		const limits = buildCodexUsageLimits(parsed, {
			targetId: "codex",
			now: new Date("2026-05-18T12:00:00.000Z"),
		});

		expect(parsed.spark5hLimit).toBe("");
		expect(parsed.sparkWeeklyLimit).toBe("");
		expect(limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual([
			"main:hourly",
			"main:weekly",
		]);
	});

	it("does not append unrelated Codex percent fragments to raw limit rows", () => {
		const parsed = parseCodexStatus(`
╭──────────────────────────╮
│ Model: gpt-5.1-codex     │
│ 5h limit: 91% left (resets 17:31)
│ Weekly limit: 79% left (resets 17:18 on 23 May)
│ GPT-5.4-Codex-Spark limit:
│ 5h limit: 100% left (resets 20:22) [██████████████████░░] 91% left (resets 17:31)
│ Weekly limit: 100% left
│ (resets 08:31 on 24 May)
╰──────────────────────────╯
`);

		expect(parsed.spark5hLimit).toBe("100% left (resets 20:22)");
		expect(parsed.sparkWeeklyLimit).toBe("100% left (resets 08:31 on 24 May)");
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

	it("returns partial Codex limits with an error when one required main row is missing", () => {
		const result = buildCodexUsageResult(
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
				spark5hLimit: "",
				sparkWeeklyLimit: "",
			},
			{
				targetId: "codex",
				displayName: "OpenAI Codex",
				now: new Date("2026-05-18T12:00:00.000Z"),
			},
		);

		expect(result.limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual(["main:hourly"]);
		expect(result.errors).toEqual([
			{
				targetId: "codex",
				displayName: "OpenAI Codex",
				code: "partial_parse",
				message: "Codex usage output did not include the weekly limit row.",
			},
		]);
	});

	it("returns partial Codex weekly limits when the 5h row is missing", () => {
		const result = buildCodexUsageResult(
			{
				model: "",
				directory: "",
				permissions: "",
				agentsMd: "",
				account: "",
				collaborationMode: "",
				session: "",
				main5hLimit: "",
				mainWeeklyLimit: "60% left",
				spark5hLimit: "",
				sparkWeeklyLimit: "",
			},
			{
				targetId: "codex",
				displayName: "OpenAI Codex",
				now: new Date("2026-05-18T12:00:00.000Z"),
			},
		);

		expect(result.limits.map((limit) => `${limit.scope}:${limit.window}`)).toEqual(["main:weekly"]);
		expect(result.errors?.[0]?.message).toBe(
			"Codex usage output did not include the 5h limit row.",
		);
	});

	it("throws when Codex output has no required main limit rows", () => {
		expect(() =>
			buildCodexUsageResult(
				{
					model: "",
					directory: "",
					permissions: "",
					agentsMd: "",
					account: "",
					collaborationMode: "",
					session: "",
					main5hLimit: "",
					mainWeeklyLimit: "",
					spark5hLimit: "90% left",
					sparkWeeklyLimit: "60% left",
				},
				{
					targetId: "codex",
					displayName: "OpenAI Codex",
					now: new Date("2026-05-18T12:00:00.000Z"),
				},
			),
		).toThrow("Codex usage output did not include the required 5h and weekly limit rows.");
	});

	it("treats Codex time-only resets as local CLI times", () => {
		const originalTimeZone = process.env.TZ;
		process.env.TZ = "America/New_York";
		try {
			const now = new Date(2026, 4, 18, 14, 0);
			const limits = buildCodexUsageLimits(
				{
					model: "",
					directory: "",
					permissions: "",
					agentsMd: "",
					account: "",
					collaborationMode: "",
					session: "",
					main5hLimit: "97% left (resets 17:31)",
					mainWeeklyLimit: "",
					spark5hLimit: "",
					sparkWeeklyLimit: "",
				},
				{ targetId: "codex", now },
			);

			expect(limits[0]?.resetAt).toBe(new Date(2026, 4, 18, 17, 31).toISOString());
			expect(new Date(limits[0]?.resetAt ?? "").getTime() - now.getTime()).toBe(
				(3 * 60 + 31) * 60 * 1000,
			);
		} finally {
			if (originalTimeZone == null) {
				delete process.env.TZ;
			} else {
				process.env.TZ = originalTimeZone;
			}
		}
	});
});

describe("Claude usage parser", () => {
	it("builds Claude usage limits from Anthropic rate-limit headers", () => {
		const now = new Date("2026-05-18T12:00:00.000Z");
		const headers = new Headers({
			"anthropic-ratelimit-unified-5h-utilization": "0.375",
			"anthropic-ratelimit-unified-5h-reset": String(now.getTime() / 1000 + 60 * 60),
			"anthropic-ratelimit-unified-7d-utilization": "0.64",
			"anthropic-ratelimit-unified-7d-reset": String(now.getTime() / 1000 + 7 * 24 * 60 * 60),
		});

		const result = buildClaudeApiUsageResult(headers, {
			targetId: "claude",
			displayName: "Claude Code",
			command: "claude",
			now,
		});

		expect(result.limits).toHaveLength(2);
		expect(result.limits[0]).toMatchObject({
			scope: "current_session",
			window: "hourly",
			percentUsed: 37.5,
			percentRemaining: 62.5,
			resetAt: "2026-05-18T13:00:00.000Z",
		});
		expect(result.limits[1]).toMatchObject({
			scope: "current_week",
			window: "weekly",
			percentUsed: 64,
			percentRemaining: 36,
			resetAt: "2026-05-25T12:00:00.000Z",
		});
	});

	it("requires complete Claude API utilization headers", () => {
		expect(() =>
			buildClaudeApiUsageResult(new Headers(), {
				targetId: "claude",
				displayName: "Claude Code",
				now: new Date("2026-05-18T12:00:00.000Z"),
			}),
		).toThrow("Claude usage API response did not include complete usage headers.");
	});

	it("extracts Claude access tokens from known credential shapes", () => {
		expect(extractClaudeAccessToken('{"accessToken":"direct-token-value-12345"}')).toBe(
			"direct-token-value-12345",
		);
		expect(
			extractClaudeAccessToken(
				JSON.stringify({ claudeAiOauth: { accessToken: "nested-token-value-12345" } }),
			),
		).toBe("nested-token-value-12345");
		expect(extractClaudeAccessToken("raw-token-value-with-enough-length")).toBe(
			"raw-token-value-with-enough-length",
		);
	});

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
	it("builds Gemini usage limits from Code Assist quota buckets", () => {
		const now = new Date("2026-05-18T12:00:00.000Z");
		const result = buildGeminiApiUsageResult(
			{
				buckets: [
					{
						modelId: "gemini-2.5-flash",
						remainingFraction: 1,
						resetTime: "2026-05-19T12:00:00Z",
					},
					{
						modelId: "gemini-2.5-flash-lite",
						remainingFraction: 0.999,
						resetTime: "2026-05-19T01:00:00Z",
					},
					{
						modelId: "gemini-2.5-pro",
						remainingFraction: 0,
						resetTime: "1970-01-01T00:00:00Z",
					},
					{
						modelId: "gemini-3.1-flash-lite",
						remainingFraction: "0.5",
						resetTime: "2026-05-19T02:00:00Z",
					},
					{
						modelId: "gemini-3.1-flash-lite-preview",
						remainingFraction: 0.75,
						resetTime: "2026-05-19T03:00:00Z",
					},
				],
			},
			{
				targetId: "gemini",
				displayName: "Gemini CLI",
				command: "gemini",
				now,
			},
		);

		expect(result.limits.map((limit) => `${limit.modelId}:${limit.label}`)).toEqual([
			"flash:Flash",
			"flash-lite:Flash Lite",
			"pro:Pro",
			"gemini-3.1-flash-lite:gemini-3.1-…",
		]);
		expect(result.limits.map((limit) => limit.percentUsed)).toEqual([0, 25, 100, 50]);
		expect(result.limits[0]?.resetAt).toBe("2026-05-19T12:00:00.000Z");
		expect(result.limits[2]?.resetAt).toBeNull();
	});

	it("requires Gemini quota buckets", () => {
		expect(() =>
			buildGeminiApiUsageResult(
				{},
				{
					targetId: "gemini",
					displayName: "Gemini CLI",
					now: new Date("2026-05-18T12:00:00.000Z"),
				},
			),
		).toThrow("Gemini Code Assist quota API response did not include model quota buckets.");
	});

	it("extracts Gemini OAuth credentials", () => {
		expect(
			extractGeminiOAuthCredentials(
				JSON.stringify({
					access_token: "access-token-value",
					refresh_token: "refresh-token-value",
					expiry_date: "1770000000000",
				}),
			),
		).toEqual({
			accessToken: "access-token-value",
			refreshToken: "refresh-token-value",
			expiryDate: 1770000000000,
		});
		expect(extractGeminiOAuthCredentials("{}")).toBeNull();
	});

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
