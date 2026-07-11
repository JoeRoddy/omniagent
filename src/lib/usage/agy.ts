import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
	cleanControlOutput,
	compactLines,
	makeUsageLimit,
	parsePercentRemaining,
} from "./format.js";
import {
	enterKey,
	escapeKey,
	type PtyStep,
	type PtyWaitFor,
	type PtyWaitSnapshot,
	runPtyScenario,
} from "./pty.js";
import {
	type UsageExtractionContext,
	UsageExtractionError,
	type UsageExtractionResult,
} from "./types.js";

const TRUST_DIALOG_PATTERN = /Do you trust the contents of this project\?/i;
const READY_PATTERN = /\?\s+for shortcuts/i;
const LOGIN_SELECTION_PATTERN = /Select login method:/i;
const USAGE_GROUP_HEADING_PATTERN = /^[A-Z][A-Z0-9 &/-]+$/;
const LIMIT_LABEL_PATTERN = /limit$/i;
const MODELS_LINE_PATTERN = /^Models within this group:\s*(.+)$/i;
const REFRESH_PATTERN = /Refreshes\s+in\s+(?:(\d+)h)?\s*(?:(\d+)m)?/i;
const NOT_SIGNED_IN_PATTERN = /\bnot signed in\b/i;
const SIGNING_IN_PATTERN = /\bsigning in\b/i;
const DISABLED_PATTERN = /^Disabled$/i;
const AGY_USAGE_FALLBACK_PATH = [".omniagent", "state", "usage", "antigravity-cli"];
const STARTUP_READY_TIMEOUT_MS = 25_000;
const USAGE_PANEL_STABLE_MS = 1_000;
const USAGE_PANEL_MIN_OBSERVE_MS = 2_000;

type AgyUsageCwd = {
	path: string;
	managed: boolean;
};

type AgyTrustOutcome = "not-requested" | "approved" | "denied" | "required";

export type ParsedAgyUsageGroup = {
	heading: string;
	models: string | null;
	limitLabel: string;
	percentRemaining: number | null;
	resetText: string | null;
	disabled: boolean;
	raw: string;
};

function isCurrentTrustDialog(snapshot: PtyWaitSnapshot): boolean {
	return TRUST_DIALOG_PATTERN.test(snapshot.screen);
}

function isNotCurrentTrustDialog(snapshot: PtyWaitSnapshot): boolean {
	return !isCurrentTrustDialog(snapshot);
}

function isReady(snapshot: PtyWaitSnapshot): boolean {
	return READY_PATTERN.test(snapshot.screen);
}

function isLoginSelection(snapshot: PtyWaitSnapshot): boolean {
	return LOGIN_SELECTION_PATTERN.test(snapshot.screen);
}

function isStartupTerminalState(snapshot: PtyWaitSnapshot): boolean {
	return isReady(snapshot) || isCurrentTrustDialog(snapshot) || isLoginSelection(snapshot);
}

function isPostTrustTerminalState(snapshot: PtyWaitSnapshot): boolean {
	return isReady(snapshot) || isLoginSelection(snapshot);
}

function isCurrentSignInFailure(snapshot: PtyWaitSnapshot): boolean {
	return NOT_SIGNED_IN_PATTERN.test(snapshot.screen) || isLoginSelection(snapshot);
}

function isInteractionBlocked(snapshot: PtyWaitSnapshot): boolean {
	return isCurrentTrustDialog(snapshot) || isCurrentSignInFailure(snapshot);
}

function isAuthenticationTransition(snapshot: PtyWaitSnapshot): boolean {
	return SIGNING_IN_PATTERN.test(snapshot.screen);
}

function isUsageWriteBlocked(snapshot: PtyWaitSnapshot): boolean {
	return isInteractionBlocked(snapshot) || isAuthenticationTransition(snapshot);
}

function createStableUsagePanelWait(
	stableMs = USAGE_PANEL_STABLE_MS,
	minObserveMs = USAGE_PANEL_MIN_OBSERVE_MS,
): PtyWaitFor {
	let previousSignature = "";
	let firstSeenAt: number | null = null;
	let stableSince = 0;

	return (snapshot) => {
		if (isInteractionBlocked(snapshot)) {
			return true;
		}

		const groups = parseAgyUsage(snapshot.screen, cleanControlOutput(snapshot.raw));
		if (groups.length === 0) {
			previousSignature = "";
			firstSeenAt = null;
			stableSince = 0;
			return false;
		}

		const signature = usageGroupSignature(groups);
		const now = Date.now();
		if (firstSeenAt == null) {
			firstSeenAt = now;
		}
		if (signature !== previousSignature) {
			previousSignature = signature;
			stableSince = now;
			return false;
		}

		return now - firstSeenAt >= minObserveMs && now - stableSince >= stableMs;
	};
}

function guardedUsageWrite(
	value: string,
	scenarioState: { canEnterUsage: boolean },
	waitMs?: number,
): PtyStep {
	return {
		waitMs,
		write: (snapshot) => {
			if (isUsageWriteBlocked(snapshot)) {
				scenarioState.canEnterUsage = false;
				return undefined;
			}
			return scenarioState.canEnterUsage ? value : undefined;
		},
	};
}

export async function extractAgyUsage(
	context: UsageExtractionContext,
): Promise<UsageExtractionResult> {
	const command = context.command ?? context.launch?.command ?? "agy";
	const launchCwd = await ensureAgyUsageCwd(context.homeDir, context.repoRoot);
	const scenarioState: {
		trustOutcome: AgyTrustOutcome;
		canEnterUsage: boolean;
		reachedReadyAfterTrust: boolean;
	} = {
		trustOutcome: "not-requested",
		canEnterUsage: false,
		reachedReadyAfterTrust: false,
	};

	const ptyResult = await runPtyScenario({
		command,
		args: context.launch?.args ?? [],
		cwd: launchCwd.path,
		cols: 120,
		rows: 40,
		timeoutMs: context.launch?.timeoutMs ?? 70_000,
		signal: context.signal,
		debug: context.debug,
		steps: [
			{
				waitFor: isStartupTerminalState,
				waitForTimeoutMs: STARTUP_READY_TIMEOUT_MS,
				optional: true,
				capture: "startup",
				captureWaitMs: 0,
			},
			{
				skipIf: isNotCurrentTrustDialog,
				skipIfSource: "screen",
				write: async () => {
					if (context.confirm == null) {
						scenarioState.trustOutcome = "required";
						return undefined;
					}
					const approved = await context.confirm({
						type: "trust-directory",
						targetId: context.targetId,
						displayName: context.displayName,
						path: launchCwd.path,
						managed: launchCwd.managed,
					});
					scenarioState.trustOutcome = approved ? "approved" : "denied";
					return undefined;
				},
			},
			{
				write: (snapshot) => {
					if (!isCurrentTrustDialog(snapshot)) {
						return undefined;
					}
					if (scenarioState.trustOutcome === "approved") {
						return enterKey();
					}
					if (scenarioState.trustOutcome === "denied") {
						return escapeKey();
					}
					return undefined;
				},
			},
			{
				skipIf: () => scenarioState.trustOutcome !== "approved",
				waitFor: isPostTrustTerminalState,
				waitForTimeoutMs: STARTUP_READY_TIMEOUT_MS,
				optional: true,
			},
			{
				write: (snapshot) => {
					const readyForUsage = isReady(snapshot) && !isInteractionBlocked(snapshot);
					if (scenarioState.trustOutcome === "approved" && readyForUsage) {
						scenarioState.reachedReadyAfterTrust = true;
					}
					scenarioState.canEnterUsage =
						scenarioState.trustOutcome !== "denied" &&
						scenarioState.trustOutcome !== "required" &&
						readyForUsage;
					return undefined;
				},
			},
			...[..."/usage"].map((character) => guardedUsageWrite(character, scenarioState, 25)),
			guardedUsageWrite(enterKey(), scenarioState, 250),
			{
				skipIf: () => !scenarioState.canEnterUsage,
				waitFor: createStableUsagePanelWait(),
				waitForTimeoutMs: 15_000,
				optional: true,
				capture: "usage",
				captureWaitMs: 0,
			},
			guardedUsageWrite(escapeKey(), scenarioState, 250),
		],
	});

	const buildError = (message: string, code?: string): Error => {
		const error = code == null ? new Error(message) : new UsageExtractionError(code, message);
		if (ptyResult.debug.length > 0) {
			Object.assign(error, { debug: ptyResult.debug });
		}
		return error;
	};

	const trustSubject = launchCwd.managed ? "managed usage directory" : "project directory";
	if (scenarioState.trustOutcome === "required") {
		throw buildError(
			`Antigravity needs permission to trust the ${trustSubject} at ${launchCwd.path}. Re-run usage in an interactive terminal to review this request.`,
			"trust_required",
		);
	}
	if (scenarioState.trustOutcome === "denied") {
		throw buildError(
			`Antigravity trust was declined for the ${trustSubject} at ${launchCwd.path}.`,
			"trust_denied",
		);
	}
	if (isCurrentSignInFailure(ptyResult)) {
		throw buildError(`Antigravity is not signed in. Run \`${command}\` and complete the login.`);
	}
	if (scenarioState.trustOutcome === "approved" && !scenarioState.reachedReadyAfterTrust) {
		throw buildError(
			`Antigravity did not accept trust for the ${trustSubject} at ${launchCwd.path}. Run \`${command}\` there once, accept the trust prompt, then re-run usage.`,
			"trust_acceptance_failed",
		);
	}
	if (isCurrentTrustDialog(ptyResult)) {
		throw buildError(
			`Antigravity still requires trust for the ${trustSubject} at ${launchCwd.path}.`,
			"trust_required",
		);
	}

	const snapshot = ptyResult.snapshots.usage ?? ptyResult;
	const cleanedOutput = cleanControlOutput(snapshot.raw);
	if (isCurrentSignInFailure(snapshot)) {
		throw buildError(`Antigravity is not signed in. Run \`${command}\` and complete the login.`);
	}
	const groups = parseAgyUsage(snapshot.screen, cleanedOutput);

	if (groups.length === 0) {
		throw buildError("Antigravity /usage output did not include Models & Quota limit groups.");
	}

	return {
		targetId: context.targetId,
		displayName: context.displayName,
		command,
		limits: groups.map((group) => {
			const percentRemaining =
				group.disabled || group.percentRemaining == null
					? null
					: clampPercent(group.percentRemaining);
			const limit = makeUsageLimit({
				targetId: context.targetId,
				scope: usageScope(group.heading),
				window: "weekly",
				label: titleCase(group.heading),
				percentUsed: percentRemaining == null ? null : 100 - percentRemaining,
				percentRemaining,
				remainingText: group.disabled ? "Disabled" : null,
				resetText: group.resetText,
				raw: group.raw,
				now: context.now,
			});
			return {
				...limit,
				resetAt: parseAgyRefreshResetAt(group.resetText, context.now) ?? limit.resetAt,
			};
		}),
		debug: ptyResult.debug.length > 0 ? ptyResult.debug : undefined,
	};
}

async function ensureAgyUsageCwd(homeDir: string, repoRoot: string): Promise<AgyUsageCwd> {
	const fallbackDir = path.join(homeDir, ...AGY_USAGE_FALLBACK_PATH);
	try {
		await mkdir(fallbackDir, { recursive: true });
		return { path: fallbackDir, managed: true };
	} catch {
		return { path: repoRoot, managed: false };
	}
}

export function parseAgyUsage(screen: string, cleanedOutput = ""): ParsedAgyUsageGroup[] {
	const fromRaw = parseAgyUsageLines(compactLines(cleanedOutput));
	const fromScreen = parseAgyUsageLines(compactLines(screen));
	const merged = new Map<string, ParsedAgyUsageGroup>();

	for (const group of [...fromRaw, ...fromScreen]) {
		merged.set(usageGroupKey(group), group);
	}

	return [...merged.values()];
}

function usageGroupKey(group: ParsedAgyUsageGroup): string {
	return `${group.heading.trim().toLowerCase()}\0${group.limitLabel.trim().toLowerCase()}`;
}

function usageGroupSignature(groups: ParsedAgyUsageGroup[]): string {
	return JSON.stringify(
		groups.map((group) => ({
			heading: group.heading,
			models: group.models,
			limitLabel: group.limitLabel,
			percentRemaining: group.percentRemaining,
			resetText: group.resetText,
			disabled: group.disabled,
		})),
	);
}

function parseAgyUsageLines(lines: string[]): ParsedAgyUsageGroup[] {
	const groups: ParsedAgyUsageGroup[] = [];
	let index = 0;

	while (index < lines.length) {
		const heading = lines[index] ?? "";
		if (!isUsageGroupHeading(heading)) {
			index += 1;
			continue;
		}

		const rawLines = [heading];
		let models: string | null = null;
		let limitLabel = "";
		let percentRemaining: number | null = null;
		let resetText: string | null = null;
		let disabled = false;
		index += 1;

		while (index < lines.length && !isUsageGroupHeading(lines[index] ?? "")) {
			const line = lines[index] ?? "";
			rawLines.push(line);
			const modelsMatch = MODELS_LINE_PATTERN.exec(line);
			if (modelsMatch?.[1]) {
				models = modelsMatch[1].trim();
			}
			if (LIMIT_LABEL_PATTERN.test(line)) {
				limitLabel = line.trim();
			}
			const linePercentRemaining = parseAgyRemainingPercent(line);
			if (linePercentRemaining != null && percentRemaining == null) {
				percentRemaining = linePercentRemaining;
			}
			const lineResetText = parseAgyRefreshText(line);
			if (lineResetText != null) {
				resetText = lineResetText;
			}
			if (DISABLED_PATTERN.test(line)) {
				disabled = true;
			}
			index += 1;
		}

		if (limitLabel && (percentRemaining != null || resetText != null || disabled)) {
			groups.push({
				heading,
				models,
				limitLabel,
				percentRemaining,
				resetText,
				disabled,
				raw: rawLines.join("\n"),
			});
		}
	}

	return groups;
}

function isUsageGroupHeading(line: string): boolean {
	if (!USAGE_GROUP_HEADING_PATTERN.test(line)) {
		return false;
	}
	return !/^(MODELS|WEEKLY|MONTHLY|DAILY|ACCOUNT)$/i.test(line);
}

function parseAgyRemainingPercent(line: string): number | null {
	return parsePercentRemaining(line) ?? parseStandalonePercent(line);
}

function parseStandalonePercent(line: string): number | null {
	const match = /(?:^|\])\s*(\d+(?:\.\d+)?)\s*%\s*$/i.exec(line);
	if (!match?.[1]) {
		return null;
	}
	return Number(match[1]);
}

function parseAgyRefreshText(line: string): string | null {
	const match = /(Refreshes\s+in\s+(?:(?:\d+)h)?\s*(?:(?:\d+)m)?)/i.exec(line);
	return match?.[1]?.trim() ?? null;
}

function parseAgyRefreshResetAt(resetText: string | null, now: Date): string | null {
	if (resetText == null) {
		return null;
	}
	const match = REFRESH_PATTERN.exec(resetText);
	if (match == null) {
		return null;
	}
	const hours = Number(match[1] ?? 0);
	const minutes = Number(match[2] ?? 0);
	if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours + minutes <= 0) {
		return null;
	}
	return new Date(now.getTime() + hours * 3_600_000 + minutes * 60_000).toISOString();
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}

function usageScope(heading: string): string {
	return heading
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function titleCase(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.map((word) => (word === "gpt" ? "GPT" : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
		.join(" ");
}
