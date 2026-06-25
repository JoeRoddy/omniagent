import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { cleanControlOutput, compactLines, makeUsageLimit, parsePercentUsed } from "./format.js";
import { enterKey, escapeKey, runPtyScenario } from "./pty.js";
import type {
	NormalizedUsageLimit,
	UsageExtractionContext,
	UsageExtractionResult,
} from "./types.js";

const execFileAsync = promisify(execFile);
const CLAUDE_CODE_KEYCHAIN_SERVICE = "Claude Code-credentials";
const CLAUDE_CODE_CREDENTIALS_PATH = [".claude", ".credentials.json"];
const CLAUDE_USAGE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_USAGE_API_TIMEOUT_MS = 10_000;
const CLAUDE_USAGE_API_HEADERS = {
	"anthropic-version": "2023-06-01",
	"anthropic-beta": "oauth-2025-04-20",
	"content-type": "application/json",
	"user-agent": "claude-code/2.1.5",
} as const;
const CLAUDE_USAGE_API_BODY = {
	model: "claude-haiku-4-5-20251001",
	max_tokens: 1,
	messages: [{ role: "user", content: "hi" }],
} as const;

export type ParsedClaudeUsage = {
	currentSessionUsed: string;
	currentSessionResets: string;
	currentWeekUsed: string;
	currentWeekResets: string;
};

export async function extractClaudeUsage(
	context: UsageExtractionContext,
): Promise<UsageExtractionResult> {
	try {
		return await extractClaudeUsageFromApi(context);
	} catch (error) {
		if (context.signal.aborted) {
			throw error;
		}
		return extractClaudeUsageFromTui(context);
	}
}

async function extractClaudeUsageFromTui(
	context: UsageExtractionContext,
): Promise<UsageExtractionResult> {
	const command = context.command ?? context.launch?.command ?? "claude";
	const model = context.launch?.cheapModel ?? "haiku";
	validateClaudeModel(model);

	const ptyResult = await runPtyScenario({
		command,
		args: context.launch?.args ?? ["--model", model],
		cwd: context.repoRoot,
		cols: 100,
		rows: 40,
		timeoutMs: context.launch?.timeoutMs ?? 60_000,
		signal: context.signal,
		debug: context.debug,
		steps: [
			{ waitFor: /Claude|>|❯/u, waitForSource: "screen", waitForTimeoutMs: 4_000 },
			{ write: enterKey() },
			{ waitFor: /Claude|>|❯/u, waitForSource: "screen", waitForTimeoutMs: 8_000 },
			{ write: `/usage${enterKey()}` },
			{
				waitFor: hasClaudeUsageResult,
				waitForTimeoutMs: 15_000,
				capture: "usage",
				captureWaitMs: 500,
			},
			{ write: escapeKey() },
			{ waitMs: 500 },
			{ write: `/exit${enterKey()}` },
		],
	});

	const usageSnapshot = ptyResult.snapshots.usage ?? ptyResult;
	const cleanedOutput = cleanControlOutput(usageSnapshot.raw);
	const parsed = parseClaudeUsage(usageSnapshot.screen, cleanedOutput);
	const limits = buildClaudeUsageLimits(parsed, context);
	if (limits.length === 0) {
		const usageError = extractClaudeUsageError(usageSnapshot.screen, cleanedOutput);
		if (usageError != null) {
			const error = new Error(`Claude usage error: ${usageError}`);
			Object.assign(error, { debug: ptyResult.debug });
			throw error;
		}
		throw new Error("Claude usage output did not include session or weekly usage rows.");
	}

	return {
		targetId: context.targetId,
		displayName: context.displayName,
		command,
		limits,
		debug: ptyResult.debug.length > 0 ? ptyResult.debug : undefined,
	};
}

async function extractClaudeUsageFromApi(
	context: UsageExtractionContext,
): Promise<UsageExtractionResult> {
	const command = context.command ?? context.launch?.command ?? "claude";
	const token = await readClaudeAccessToken(context);
	if (token == null) {
		throw new Error("Claude Code OAuth token was not available.");
	}

	const response = await fetchClaudeUsageHeaders(token, context.signal);
	if (response.status >= 400) {
		throw new Error(`Claude usage API returned HTTP ${response.status}.`);
	}

	const result = buildClaudeApiUsageResult(response.headers, {
		targetId: context.targetId,
		displayName: context.displayName,
		now: context.now,
		command,
	});
	if (result.limits.length === 0) {
		throw new Error("Claude usage API response did not include usage headers.");
	}
	return result;
}

type ClaudeApiUsageContext = Pick<UsageExtractionContext, "targetId" | "displayName" | "now"> & {
	command?: string;
};

type ClaudeUsageHeaders = Pick<Headers, "get">;

type ClaudeUsageApiResponse = {
	status: number;
	headers: ClaudeUsageHeaders;
};

export function buildClaudeApiUsageResult(
	headers: ClaudeUsageHeaders,
	context: ClaudeApiUsageContext,
): UsageExtractionResult {
	const sessionUsed = parseUsageHeaderFraction(
		headers.get("anthropic-ratelimit-unified-5h-utilization"),
	);
	const weekUsed = parseUsageHeaderFraction(
		headers.get("anthropic-ratelimit-unified-7d-utilization"),
	);

	if (sessionUsed == null || weekUsed == null) {
		throw new Error("Claude usage API response did not include complete usage headers.");
	}

	return {
		targetId: context.targetId,
		displayName: context.displayName,
		command: context.command,
		limits: [
			makeClaudeApiUsageLimit({
				targetId: context.targetId,
				scope: "current_session",
				window: "session",
				percentUsed: sessionUsed,
				resetAt: parseEpochSecondsHeader(headers.get("anthropic-ratelimit-unified-5h-reset")),
				now: context.now,
			}),
			makeClaudeApiUsageLimit({
				targetId: context.targetId,
				scope: "current_week",
				window: "weekly",
				percentUsed: weekUsed,
				resetAt: parseEpochSecondsHeader(headers.get("anthropic-ratelimit-unified-7d-reset")),
				now: context.now,
			}),
		],
	};
}

export function extractClaudeAccessToken(blob: string): string | null {
	const trimmed = blob.trim();
	if (!trimmed) {
		return null;
	}

	try {
		const parsed = JSON.parse(trimmed) as unknown;
		const token = findAccessToken(parsed);
		if (token != null) {
			return token;
		}
	} catch {
		// Fall through to the shape-tolerant extractors below.
	}

	const match = /"accessToken"\s*:\s*"([^"]+)"/.exec(trimmed);
	if (match?.[1]) {
		return match[1];
	}

	if (/^[A-Za-z0-9_\-.~+/=]{20,}$/.test(trimmed)) {
		return trimmed;
	}
	return null;
}

async function readClaudeAccessToken(
	context: Pick<UsageExtractionContext, "homeDir" | "signal">,
): Promise<string | null> {
	const tokenFromFile = await readClaudeAccessTokenFromFile(context.homeDir);
	if (tokenFromFile != null) {
		return tokenFromFile;
	}

	if (process.platform !== "darwin") {
		return null;
	}
	return readClaudeAccessTokenFromKeychain(context.signal);
}

async function readClaudeAccessTokenFromFile(homeDir: string): Promise<string | null> {
	try {
		const raw = await readFile(path.join(homeDir, ...CLAUDE_CODE_CREDENTIALS_PATH), "utf8");
		return extractClaudeAccessToken(raw);
	} catch {
		return null;
	}
}

async function readClaudeAccessTokenFromKeychain(signal: AbortSignal): Promise<string | null> {
	const username = os.userInfo().username;
	const keychainArgs = [
		["find-generic-password", "-s", CLAUDE_CODE_KEYCHAIN_SERVICE, "-a", username, "-w"],
		["find-generic-password", "-s", CLAUDE_CODE_KEYCHAIN_SERVICE, "-w"],
	];

	for (const args of keychainArgs) {
		try {
			const { stdout } = await execFileAsync("security", args, {
				timeout: 5_000,
				signal,
				maxBuffer: 1024 * 1024,
			});
			const token = extractClaudeAccessToken(stdout);
			if (token != null) {
				return token;
			}
		} catch {
			if (signal.aborted) {
				throw signal.reason;
			}
		}
	}
	return null;
}

async function fetchClaudeUsageHeaders(
	token: string,
	parentSignal: AbortSignal,
): Promise<ClaudeUsageApiResponse> {
	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort(new Error("Claude usage API request timed out."));
	}, CLAUDE_USAGE_API_TIMEOUT_MS);
	const abortFromParent = () => {
		controller.abort(parentSignal.reason);
	};
	parentSignal.addEventListener("abort", abortFromParent, { once: true });

	try {
		const response = await fetch(CLAUDE_USAGE_API_URL, {
			method: "POST",
			headers: {
				...CLAUDE_USAGE_API_HEADERS,
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(CLAUDE_USAGE_API_BODY),
			signal: controller.signal,
		});
		return {
			status: response.status,
			headers: response.headers,
		};
	} finally {
		clearTimeout(timeout);
		parentSignal.removeEventListener("abort", abortFromParent);
	}
}

function findAccessToken(value: unknown): string | null {
	if (value == null || typeof value !== "object") {
		return null;
	}

	const record = value as Record<string, unknown>;
	if (typeof record.accessToken === "string") {
		return record.accessToken;
	}

	for (const child of Object.values(record)) {
		const token = findAccessToken(child);
		if (token != null) {
			return token;
		}
	}
	return null;
}

function makeClaudeApiUsageLimit(options: {
	targetId: string;
	scope: string;
	window: "session" | "weekly";
	percentUsed: number;
	resetAt: string | null;
	now: Date;
}): NormalizedUsageLimit {
	const percentUsed = clampPercent(options.percentUsed);
	const resetText = options.resetAt == null ? null : `resets ${options.resetAt}`;
	const raw = `${formatPercent(percentUsed)} used${resetText == null ? "" : ` (${resetText})`}`;
	const limit = makeUsageLimit({
		targetId: options.targetId,
		scope: options.scope,
		window: options.window,
		percentUsed,
		percentRemaining: 100 - percentUsed,
		resetText,
		raw,
		now: options.now,
	});
	return {
		...limit,
		resetAt: options.resetAt,
	};
}

function parseUsageHeaderFraction(value: string | null): number | null {
	if (value == null || !value.trim()) {
		return null;
	}
	const fraction = Number(value);
	if (!Number.isFinite(fraction)) {
		return null;
	}
	return fraction * 100;
}

function parseEpochSecondsHeader(value: string | null): string | null {
	if (value == null || !value.trim()) {
		return null;
	}
	const seconds = Number(value);
	if (!Number.isFinite(seconds) || seconds <= 0) {
		return null;
	}
	return new Date(seconds * 1000).toISOString();
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}

function formatPercent(value: number): string {
	return Number.isInteger(value) ? `${value}%` : `${Number(value.toFixed(2))}%`;
}

function hasClaudeUsageRows(snapshot: { raw: string; screen: string }): boolean {
	const parsed = parseClaudeUsage(snapshot.screen, cleanControlOutput(snapshot.raw));
	return Boolean(parsed.currentSessionUsed || parsed.currentWeekUsed);
}

function hasClaudeUsageResult(snapshot: { raw: string; screen: string }): boolean {
	return hasClaudeUsageRows(snapshot) || extractClaudeUsageError(snapshot.screen) != null;
}

function extractClaudeUsageError(screen: string, cleanedOutput = ""): string | null {
	for (const source of [screen, cleanedOutput]) {
		for (const line of compactLines(source)) {
			const errorMatch = /^Error:\s*(.+)$/i.exec(line);
			if (errorMatch?.[1]) {
				return errorMatch[1].trim();
			}

			if (isClaudeAuthErrorLine(line)) {
				return line;
			}
		}
	}
	return null;
}

function isClaudeAuthErrorLine(line: string): boolean {
	return (
		/\b(?:auth(?:entication)?|credentials?|login|logged in|token)\b/i.test(line) &&
		/\b(?:error|expired|failed|invalid|missing|not|please|required|sign in)\b/i.test(line)
	);
}

export function buildClaudeUsageLimits(
	parsed: ParsedClaudeUsage,
	context: Pick<UsageExtractionContext, "targetId" | "now">,
): NormalizedUsageLimit[] {
	const sessionUsed = parsePercentUsed(parsed.currentSessionUsed);
	const weekUsed = parsePercentUsed(parsed.currentWeekUsed);
	const limits: NormalizedUsageLimit[] = [];

	if (parsed.currentSessionUsed.trim()) {
		limits.push(
			makeUsageLimit({
				targetId: context.targetId,
				scope: "current_session",
				window: "session",
				percentUsed: sessionUsed,
				percentRemaining: sessionUsed == null ? null : 100 - sessionUsed,
				resetText: parsed.currentSessionResets,
				raw: formatRaw(parsed.currentSessionUsed, parsed.currentSessionResets),
				now: context.now,
			}),
		);
	}

	if (parsed.currentWeekUsed.trim()) {
		limits.push(
			makeUsageLimit({
				targetId: context.targetId,
				scope: "current_week",
				window: "weekly",
				percentUsed: weekUsed,
				percentRemaining: weekUsed == null ? null : 100 - weekUsed,
				resetText: parsed.currentWeekResets,
				raw: formatRaw(parsed.currentWeekUsed, parsed.currentWeekResets),
				now: context.now,
			}),
		);
	}

	return limits;
}

export function parseClaudeUsage(screen: string, cleanedOutput = ""): ParsedClaudeUsage {
	const fromScreen = parseClaudeLines(compactLines(screen));
	if (fromScreen.currentSessionUsed || fromScreen.currentWeekUsed) {
		return fromScreen;
	}
	return parseClaudeLines(compactLines(cleanedOutput));
}

function parseClaudeLines(lines: string[]): ParsedClaudeUsage {
	const values: ParsedClaudeUsage = {
		currentSessionUsed: "",
		currentSessionResets: "",
		currentWeekUsed: "",
		currentWeekResets: "",
	};
	let section: "currentSession" | "currentWeek" | "" = "";

	for (const line of lines) {
		if (line === "Current session") {
			section = "currentSession";
			continue;
		}

		if (line.startsWith("Current week")) {
			section = shouldParseClaudeWeeklySection(line, values) ? "currentWeek" : "";
			continue;
		}

		if (!section) {
			continue;
		}

		const usedMatch = /(\d+(?:\.\d+)?% used)/i.exec(line);
		if (usedMatch != null) {
			if (section === "currentSession") {
				values.currentSessionUsed = usedMatch[1];
			} else {
				values.currentWeekUsed = usedMatch[1];
			}
			continue;
		}

		if (line.startsWith("Resets ")) {
			if (section === "currentSession") {
				values.currentSessionResets = line.slice("Resets ".length).trim();
			} else {
				values.currentWeekResets = line.slice("Resets ".length).trim();
			}
		}
	}

	return values;
}

function shouldParseClaudeWeeklySection(line: string, values: ParsedClaudeUsage): boolean {
	const sectionLabel = line.toLowerCase();
	if (/\([^)]*\bonly\)/.test(sectionLabel)) {
		return false;
	}
	return !values.currentWeekUsed || sectionLabel.includes("all models");
}

function formatRaw(used: string, resets: string): string {
	if (!used) {
		return "";
	}
	return resets ? `${used} (resets ${resets})` : used;
}

function validateClaudeModel(model: string): void {
	if (!/^[A-Za-z0-9._:-]+$/.test(model)) {
		throw new Error(`Unsupported Claude usage model value: ${model}`);
	}
}
