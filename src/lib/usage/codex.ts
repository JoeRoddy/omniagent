import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	cleanControlOutput,
	makeUsageLimit,
	parsePercentRemaining,
	parseResetText,
} from "./format.js";
import {
	enterKey,
	type PtyScenarioResult,
	type PtySnapshot,
	runPtyScenario,
	typeTextSteps,
} from "./pty.js";
import type {
	NormalizedUsageLimit,
	UsageExtractionContext,
	UsageExtractionResult,
} from "./types.js";

const CODEX_WINDOWS = [
	["main", "5h", "main5hLimit"],
	["main", "weekly", "mainWeeklyLimit"],
	["spark", "5h", "spark5hLimit"],
	["spark", "weekly", "sparkWeeklyLimit"],
] as const;
const CLEAR_LINE = "\x15";
const CODEX_AUTH_PATH = [".codex", "auth.json"];
const CODEX_INSTALLATION_ID_PATH = [".codex", "installation_id"];
const CODEX_USAGE_API_URL = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_USAGE_API_TIMEOUT_MS = 10_000;

export type ParsedCodexStatus = {
	model: string;
	directory: string;
	permissions: string;
	agentsMd: string;
	account: string;
	collaborationMode: string;
	session: string;
	main5hLimit: string;
	mainWeeklyLimit: string;
	spark5hLimit: string;
	sparkWeeklyLimit: string;
};

export async function extractCodexUsage(
	context: UsageExtractionContext,
): Promise<UsageExtractionResult> {
	try {
		return await extractCodexUsageFromApi(context);
	} catch (error) {
		if (context.signal.aborted) {
			throw error;
		}
		return extractCodexUsageFromTui(context);
	}
}

async function extractCodexUsageFromTui(
	context: UsageExtractionContext,
): Promise<UsageExtractionResult> {
	const command = context.command ?? context.launch?.command ?? "codex";
	const probeCodexHome = await createIsolatedCodexProbeHome(context.homeDir);
	let ptyResult: PtyScenarioResult;
	try {
		ptyResult = await runPtyScenario({
			command,
			args: context.launch?.args ?? ["--no-alt-screen"],
			cwd: context.homeDir,
			env: {
				CODEX_HOME: probeCodexHome,
			},
			cols: 100,
			rows: 40,
			timeoutMs: context.launch?.timeoutMs ?? 60_000,
			signal: context.signal,
			debug: context.debug,
			steps: [
				{ waitFor: isCodexPromptReadyOrStartupPrompt, waitForTimeoutMs: 10_000 },
				// Keep the configured model when Codex opens with a model-deprecation dialog.
				{ write: dismissCodexModelMigrationPrompt, skipIf: isCodexPromptReady },
				{ waitFor: isCodexPromptReadyOrTrustPrompt, waitForTimeoutMs: 10_000, optional: true },
				{ write: enterKey(), skipIf: isCodexPromptReady },
				// Trust onboarding can also precede the model-deprecation dialog.
				{
					waitFor: isCodexPromptReadyOrMigrationPrompt,
					waitForTimeoutMs: 10_000,
					optional: true,
				},
				{ write: dismissCodexModelMigrationPrompt, skipIf: isCodexPromptReady },
				{ waitFor: isCodexPromptReady, waitForTimeoutMs: 10_000 },
				...typeTextSteps("/status", 20),
				{ write: enterKey() },
				{
					waitFor: hasCodexStatusResponse,
					waitForTimeoutMs: 15_000,
					capture: "status",
					captureWaitMs: 500,
				},
				{ waitMs: 5_000, skipIf: hasCodexStatusLimits },
				{ write: `${CLEAR_LINE}/status${enterKey()}`, skipIf: hasCodexStatusLimits },
				{
					waitFor: hasCodexStatusLimits,
					waitForTimeoutMs: 15_000,
					skipIf: hasCodexStatusLimits,
					optional: true,
					capture: "statusRetry",
					captureWaitMs: 500,
				},
				{ write: `${CLEAR_LINE}/exit${enterKey()}` },
				{ waitMs: 500 },
			],
		});
	} finally {
		await rm(probeCodexHome, { recursive: true, force: true });
	}

	const parsed = selectCodexStatus(ptyResult);
	const result = buildCodexUsageResult(parsed, {
		targetId: context.targetId,
		displayName: context.displayName,
		now: context.now,
		command,
	});

	return {
		...result,
		debug: ptyResult.debug.length > 0 ? ptyResult.debug : undefined,
	};
}

async function createIsolatedCodexProbeHome(homeDir: string): Promise<string> {
	const probeCodexHome = await mkdtemp(path.join(os.tmpdir(), "omniagent-codex-probe-"));
	try {
		await Promise.all([
			copyCodexProbeFile(path.join(homeDir, ...CODEX_AUTH_PATH), probeCodexHome, "auth.json"),
			copyCodexProbeFile(
				path.join(homeDir, ...CODEX_INSTALLATION_ID_PATH),
				probeCodexHome,
				"installation_id",
			),
		]);
		return probeCodexHome;
	} catch (error) {
		await rm(probeCodexHome, { recursive: true, force: true });
		throw error;
	}
}

async function copyCodexProbeFile(
	sourcePath: string,
	probeCodexHome: string,
	filename: string,
): Promise<void> {
	let contents: Buffer;
	try {
		contents = await readFile(sourcePath);
	} catch {
		return;
	}
	await writeFile(path.join(probeCodexHome, filename), contents, { mode: 0o600 });
}

async function extractCodexUsageFromApi(
	context: UsageExtractionContext,
): Promise<UsageExtractionResult> {
	const command = context.command ?? context.launch?.command ?? "codex";
	const auth = await readCodexBackendAuth(context.homeDir);
	if (auth == null) {
		throw new Error("Codex ChatGPT backend auth was not available.");
	}

	const installationId = await readCodexInstallationId(context.homeDir);
	const response = await fetchCodexUsage(auth, installationId, context.signal);
	if (response.status >= 400) {
		throw new Error(`Codex usage API returned HTTP ${response.status}.`);
	}

	const body = await response.json();
	return buildCodexApiUsageResult(body, {
		targetId: context.targetId,
		displayName: context.displayName,
		now: context.now,
		command,
	});
}

type CodexApiUsageContext = Pick<UsageExtractionContext, "targetId" | "displayName" | "now"> & {
	command?: string;
};

type CodexBackendAuth = {
	accessToken: string;
	accountId: string;
};

type CodexUsageApiResponse = Pick<Response, "json" | "status">;

type CodexUsagePayload = {
	rate_limit?: CodexApiRateLimit;
	additional_rate_limits?: CodexApiAdditionalRateLimit[];
};

type CodexApiAdditionalRateLimit = {
	limit_name?: unknown;
	metered_feature?: unknown;
	rate_limit?: CodexApiRateLimit;
};

type CodexApiRateLimit = {
	primary_window?: CodexApiRateLimitWindow;
	secondary_window?: CodexApiRateLimitWindow;
};

type CodexApiRateLimitWindow = {
	used_percent?: unknown;
	limit_window_seconds?: unknown;
	reset_at?: unknown;
};

export function buildCodexApiUsageResult(
	payload: unknown,
	context: CodexApiUsageContext,
): UsageExtractionResult {
	const usage = isRecord(payload) ? (payload as CodexUsagePayload) : {};
	const limits = [
		...buildCodexApiRateLimitUsageLimits({
			targetId: context.targetId,
			scope: "main",
			rateLimit: usage.rate_limit,
			now: context.now,
		}),
		...buildCodexApiAdditionalUsageLimits(usage.additional_rate_limits, context),
	];

	// Codex currently reports only a weekly main window; accept whichever windows it returns.
	const hasMainLimit = limits.some((limit) => limit.scope === "main");
	if (!hasMainLimit) {
		throw new Error("Codex usage API response did not include any main rate-limit windows.");
	}

	return {
		targetId: context.targetId,
		displayName: context.displayName,
		command: context.command,
		limits,
	};
}

export function extractCodexBackendAuth(blob: string): CodexBackendAuth | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(blob);
	} catch {
		return null;
	}
	if (!isRecord(parsed) || !isRecord(parsed.tokens)) {
		return null;
	}

	const accessToken = parsed.tokens.access_token;
	const accountId = parsed.tokens.account_id;
	if (typeof accessToken !== "string" || typeof accountId !== "string") {
		return null;
	}
	if (!accessToken.trim() || !accountId.trim()) {
		return null;
	}
	return {
		accessToken,
		accountId,
	};
}

async function readCodexBackendAuth(homeDir: string): Promise<CodexBackendAuth | null> {
	try {
		const raw = await readFile(path.join(homeDir, ...CODEX_AUTH_PATH), "utf8");
		return extractCodexBackendAuth(raw);
	} catch {
		return null;
	}
}

async function readCodexInstallationId(homeDir: string): Promise<string | null> {
	try {
		const installationId = await readFile(
			path.join(homeDir, ...CODEX_INSTALLATION_ID_PATH),
			"utf8",
		);
		const trimmed = installationId.trim();
		return trimmed.length > 0 ? trimmed : null;
	} catch {
		return null;
	}
}

async function fetchCodexUsage(
	auth: CodexBackendAuth,
	installationId: string | null,
	parentSignal: AbortSignal,
): Promise<CodexUsageApiResponse> {
	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort(new Error("Codex usage API request timed out."));
	}, CODEX_USAGE_API_TIMEOUT_MS);
	const abortFromParent = () => {
		controller.abort(parentSignal.reason);
	};
	parentSignal.addEventListener("abort", abortFromParent, { once: true });

	try {
		const headers: Record<string, string> = {
			accept: "application/json",
			authorization: `Bearer ${auth.accessToken}`,
			"chatgpt-account-id": auth.accountId,
			"user-agent": "codex-cli",
		};
		if (installationId != null) {
			headers["x-codex-installation-id"] = installationId;
		}

		return await fetch(CODEX_USAGE_API_URL, {
			method: "GET",
			headers,
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeout);
		parentSignal.removeEventListener("abort", abortFromParent);
	}
}

function buildCodexApiAdditionalUsageLimits(
	additionalRateLimits: CodexApiAdditionalRateLimit[] | undefined,
	context: Pick<UsageExtractionContext, "targetId" | "now">,
): NormalizedUsageLimit[] {
	if (!Array.isArray(additionalRateLimits)) {
		return [];
	}

	return additionalRateLimits.flatMap((entry) => {
		if (!isRecord(entry)) {
			return [];
		}

		const limitName = typeof entry.limit_name === "string" ? entry.limit_name : "";
		const meteredFeature = typeof entry.metered_feature === "string" ? entry.metered_feature : "";
		const scope = codexAdditionalLimitScope(limitName, meteredFeature);
		return buildCodexApiRateLimitUsageLimits({
			targetId: context.targetId,
			scope,
			rateLimit: entry.rate_limit,
			now: context.now,
			labelPrefix: scope === "spark" ? undefined : limitName || meteredFeature || scope,
		});
	});
}

function buildCodexApiRateLimitUsageLimits(options: {
	targetId: string;
	scope: string;
	rateLimit: CodexApiRateLimit | undefined;
	now: Date;
	labelPrefix?: string;
}): NormalizedUsageLimit[] {
	if (!isRecord(options.rateLimit)) {
		return [];
	}

	const windows = [options.rateLimit.primary_window, options.rateLimit.secondary_window];
	return windows.flatMap((window) => {
		const limit = makeCodexApiUsageLimit({
			targetId: options.targetId,
			scope: options.scope,
			window,
			now: options.now,
			labelPrefix: options.labelPrefix,
		});
		return limit == null ? [] : [limit];
	});
}

function makeCodexApiUsageLimit(options: {
	targetId: string;
	scope: string;
	window: CodexApiRateLimitWindow | undefined;
	now: Date;
	labelPrefix?: string;
}): NormalizedUsageLimit | null {
	if (!isRecord(options.window)) {
		return null;
	}

	const percentUsed = parseApiNumber(options.window.used_percent);
	if (percentUsed == null) {
		return null;
	}

	const window = codexApiWindowName(options.window);
	if (window == null) {
		return null;
	}
	const resetAt = parseApiEpochSeconds(options.window.reset_at);
	const percentUsedClamped = clampPercent(percentUsed);
	const percentRemaining = 100 - percentUsedClamped;
	const resetText = resetAt == null ? null : `resets ${resetAt}`;
	const label =
		options.labelPrefix == null ? undefined : `${options.labelPrefix} ${formatWindowLabel(window)}`;
	const raw = `${formatPercent(percentRemaining)} left${resetText == null ? "" : ` (${resetText})`}`;
	const limit = makeUsageLimit({
		targetId: options.targetId,
		scope: options.scope,
		window,
		label,
		percentUsed: percentUsedClamped,
		percentRemaining,
		resetText,
		raw,
		now: options.now,
	});
	return {
		...limit,
		resetAt,
	};
}

function codexAdditionalLimitScope(limitName: string, meteredFeature: string): string {
	if (/\bspark\b/i.test(limitName) || /\bbengalfox\b/i.test(meteredFeature)) {
		return "spark";
	}
	const source = limitName || meteredFeature || "additional";
	const normalized = source
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return normalized || "additional";
}

function codexApiWindowName(window: CodexApiRateLimitWindow): "5h" | "weekly" | null {
	const seconds = parseApiNumber(window.limit_window_seconds);
	if (seconds === 18_000) {
		return "5h";
	}
	if (seconds === 604_800) {
		return "weekly";
	}
	return null;
}

function formatWindowLabel(window: string): string {
	return window === "weekly" ? "Weekly" : window === "5h" ? "5h" : window;
}

function parseApiNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value !== "string" || !value.trim()) {
		return null;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function parseApiEpochSeconds(value: unknown): string | null {
	const seconds = parseApiNumber(value);
	if (seconds == null || seconds <= 0) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function selectCodexStatus(result: PtyScenarioResult): ParsedCodexStatus {
	const snapshots: Array<PtySnapshot | PtyScenarioResult | undefined> = [
		result.snapshots.statusRetry,
		result,
		result.snapshots.status,
	];

	for (const snapshot of snapshots) {
		if (snapshot == null) {
			continue;
		}
		for (const content of [`${snapshot.screen}\n${snapshot.raw}`, snapshot.screen, snapshot.raw]) {
			const parsed = parseCodexStatus(cleanControlOutput(content));
			if (parsed.main5hLimit || parsed.mainWeeklyLimit) {
				return parsed;
			}
		}
	}

	const fallback = result.snapshots.statusRetry ?? result.snapshots.status ?? result;
	return parseCodexStatus(cleanControlOutput(`${fallback.screen}\n${fallback.raw}`));
}

function isCodexPromptReady(snapshot: { raw: string; screen: string }): boolean {
	const cleanedOutput = cleanControlOutput(`${snapshot.screen}\n${snapshot.raw}`);
	return /(?:\u203a|>)\s/.test(cleanedOutput) && /\bContext\b/i.test(cleanedOutput);
}

function isCodexPromptReadyOrTrustPrompt(snapshot: { raw: string; screen: string }): boolean {
	return isCodexPromptReady(snapshot) || isCodexTrustPrompt(snapshot);
}

function isCodexPromptReadyOrStartupPrompt(snapshot: { raw: string; screen: string }): boolean {
	return isCodexPromptReadyOrTrustPrompt(snapshot) || isCodexModelMigrationPrompt(snapshot);
}

function isCodexTrustPrompt(snapshot: { raw: string; screen: string }): boolean {
	const cleanedOutput = cleanControlOutput(`${snapshot.screen}\n${snapshot.raw}`);
	return /do you trust the contents of this directory/i.test(cleanedOutput);
}

function isCodexModelMigrationPrompt(snapshot: { raw: string; screen: string }): boolean {
	return codexKeepModelSelection(snapshot) != null;
}

function isCodexPromptReadyOrMigrationPrompt(snapshot: { raw: string; screen: string }): boolean {
	return isCodexPromptReady(snapshot) || isCodexModelMigrationPrompt(snapshot);
}

// The migration dialog must be detected on the live screen only: raw output still contains the
// dialog after it is dismissed, and re-sending the selection would type into the composer.
function codexKeepModelSelection(snapshot: { screen: string }): string | null {
	const cleanedScreen = cleanControlOutput(snapshot.screen);
	const match = /(\d+)\.\s*Use existing model/i.exec(cleanedScreen);
	return match?.[1] ?? null;
}

function dismissCodexModelMigrationPrompt(snapshot: {
	raw: string;
	screen: string;
}): string | undefined {
	const selection = codexKeepModelSelection(snapshot);
	return selection ?? undefined;
}

function hasCodexStatusLimits(snapshot: { raw: string; screen: string }): boolean {
	const cleanedOutput = cleanControlOutput(`${snapshot.screen}\n${snapshot.raw}`);
	const parsed = parseCodexStatus(cleanedOutput);
	// Codex currently reports only a weekly main limit; absent rows are fine, but any row that has
	// started rendering must include a parseable percentage before the probe exits.
	return hasOnlyParseableCodexMainLimits(parsed);
}

function hasCodexStatusResponse(snapshot: { raw: string; screen: string }): boolean {
	const cleanedOutput = cleanControlOutput(`${snapshot.screen}\n${snapshot.raw}`);
	const parsed = parseCodexStatus(cleanedOutput);
	return (
		Boolean(parsed.main5hLimit || parsed.mainWeeklyLimit) ||
		/refresh requested/i.test(cleanedOutput)
	);
}

export function buildCodexUsageResult(
	parsed: ParsedCodexStatus,
	context: Pick<UsageExtractionContext, "targetId" | "displayName" | "now"> & {
		command?: string;
	},
): UsageExtractionResult {
	assertAnyRequiredCodexLimit(parsed);
	return {
		targetId: context.targetId,
		displayName: context.displayName,
		command: context.command,
		limits: buildCodexUsageLimits(parsed, context),
	};
}

export function buildCodexUsageLimits(
	parsed: ParsedCodexStatus,
	context: Pick<UsageExtractionContext, "targetId" | "now">,
): NormalizedUsageLimit[] {
	return CODEX_WINDOWS.flatMap(([scope, window, key]) => {
		const raw = parsed[key]?.trim() ?? "";
		if (!raw) {
			return [];
		}

		const percentRemaining = parsePercentRemaining(raw);
		if (percentRemaining == null) {
			return [];
		}
		return [
			makeUsageLimit({
				targetId: context.targetId,
				scope,
				window,
				percentUsed: 100 - percentRemaining,
				percentRemaining,
				resetText: parseResetText(raw),
				raw,
				now: context.now,
			}),
		];
	});
}

export function parseCodexStatus(cleanedOutput: string): ParsedCodexStatus {
	const values: Partial<ParsedCodexStatus> = {};
	let inStatus = false;
	let section: "main" | "spark" = "main";
	let key: keyof ParsedCodexStatus | "" = "";

	for (const rawLine of cleanedOutput.split(/\n/)) {
		const normalizedLine = normalizeCodexLine(rawLine);

		if (!inStatus) {
			if (normalizedLine === "Model:" || normalizedLine.startsWith("Model: ")) {
				inStatus = true;
				key = "model";
				setValue(values, key, normalizedLine.slice("Model:".length).trim());
			}
			continue;
		}

		if (normalizedLine.includes("/exit exit Codex")) {
			break;
		}
		if (normalizedLine.startsWith("› ")) {
			key = "";
			continue;
		}

		let line = normalizedLine;
		if (!line || line === "[" || line === "]") {
			continue;
		}
		line = line.replace(/^\]\s*/, "").trim();
		if (!line) {
			continue;
		}

		const labelMatch = /^([-A-Za-z0-9_. ]+):\s*(.*)$/.exec(line);
		if (labelMatch != null) {
			const label = labelMatch[1].trim();
			const inlineValue = labelMatch[2].trim();

			if (isCodexSparkLimitLabel(label)) {
				// Inline rows like "GPT-5.3-Codex-Spark Weekly limit: 100% left" carry their own
				// value; bare labels like "GPT-5.3-Codex-Spark limit:" open a Spark section instead.
				const sparkKey = sparkLimitKey(label);
				if (sparkKey) {
					key = sparkKey;
					if (inlineValue) {
						setValue(values, key, inlineValue);
					}
				} else {
					section = "spark";
					key = "";
				}
				continue;
			}

			key = labelToCodexKey(label, section);
			if (key && inlineValue) {
				setValue(values, key, inlineValue);
			}
			continue;
		}

		if (key && isCodexContinuationLine(line, values[key])) {
			appendValue(values, key, line);
		}
	}

	return {
		model: values.model ?? "",
		directory: values.directory ?? "",
		permissions: values.permissions ?? "",
		agentsMd: values.agentsMd ?? "",
		account: values.account ?? "",
		collaborationMode: values.collaborationMode ?? "",
		session: values.session ?? "",
		main5hLimit: values.main5hLimit ?? "",
		mainWeeklyLimit: values.mainWeeklyLimit ?? "",
		spark5hLimit: values.spark5hLimit ?? "",
		sparkWeeklyLimit: values.sparkWeeklyLimit ?? "",
	};
}

function assertAnyRequiredCodexLimit(parsed: ParsedCodexStatus): void {
	if (hasParseableCodexMainLimit(parsed)) {
		return;
	}
	throw new Error("Codex usage output did not include any parseable main rate-limit rows.");
}

function hasParseableCodexMainLimit(parsed: ParsedCodexStatus): boolean {
	return (
		parsePercentRemaining(parsed.main5hLimit) != null ||
		parsePercentRemaining(parsed.mainWeeklyLimit) != null
	);
}

function hasOnlyParseableCodexMainLimits(parsed: ParsedCodexStatus): boolean {
	const mainLimits = [parsed.main5hLimit, parsed.mainWeeklyLimit]
		.map((limit) => limit.trim())
		.filter(Boolean);
	return mainLimits.length > 0 && mainLimits.every((limit) => parsePercentRemaining(limit) != null);
}

function isCodexSparkLimitLabel(label: string): boolean {
	return /\bspark\b/i.test(label) && /\blimit\b/i.test(label);
}

function sparkLimitKey(label: string): keyof ParsedCodexStatus | "" {
	if (/\b5h limit$/i.test(label)) {
		return "spark5hLimit";
	}
	if (/\bweekly limit$/i.test(label)) {
		return "sparkWeeklyLimit";
	}
	return "";
}

function labelToCodexKey(label: string, section: "main" | "spark"): keyof ParsedCodexStatus | "" {
	if (label === "Model") return "model";
	if (label === "Directory") return "directory";
	if (label === "Permissions") return "permissions";
	if (label === "Agents.md") return "agentsMd";
	if (label === "Account") return "account";
	if (label === "Collaboration mode") return "collaborationMode";
	if (label === "Session") return "session";
	if (label === "5h limit") return section === "spark" ? "spark5hLimit" : "main5hLimit";
	if (label === "Weekly limit") {
		return section === "spark" ? "sparkWeeklyLimit" : "mainWeeklyLimit";
	}
	return "";
}

function setValue(
	values: Partial<ParsedCodexStatus>,
	key: keyof ParsedCodexStatus,
	value: string,
): void {
	const sanitized = sanitizeCodexValue(value);
	if (!sanitized) {
		return;
	}
	values[key] = sanitized;
}

function appendValue(
	values: Partial<ParsedCodexStatus>,
	key: keyof ParsedCodexStatus,
	value: string,
): void {
	const sanitized = sanitizeCodexValue(value);
	if (!sanitized) {
		return;
	}
	values[key] =
		values[key] == null || values[key] === "" ? sanitized : `${values[key]} ${sanitized}`;
}

function isCodexContinuationLine(line: string, currentValue: string | undefined): boolean {
	if (!line) {
		return false;
	}

	const hasPercent = /\d+(?:\.\d+)?\s*%/.test(line);
	const currentHasPercent = /\d+(?:\.\d+)?\s*%/.test(currentValue ?? "");
	if (hasPercent) {
		return !currentHasPercent;
	}

	return /\breset/i.test(line);
}

function normalizeCodexLine(line: string): string {
	return line
		.replace(/[│╭╮╰╯─]/g, " ")
		.replace(/[ \t]+/g, " ")
		.trim();
}

function sanitizeCodexValue(value: string): string {
	const sanitized = value.replace(/›.*$/g, "").trim();
	const limitMatch = /^(.+?\d+(?:\.\d+)?\s*%\s*(?:left|remaining|used)(?:\s*\([^)]*\))?)/i.exec(
		sanitized,
	);
	return limitMatch?.[1].trim() ?? sanitized;
}
