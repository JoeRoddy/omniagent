import { access, readFile } from "node:fs/promises";
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
	type PtyWaitSnapshot,
	runPtyScenario,
	typeTextSteps,
} from "./pty.js";
import type { UsageExtractionContext, UsageExtractionResult } from "./types.js";

const TRUST_DIALOG_PATTERN = /Do you trust the contents of this project\?/i;
const READY_PATTERN = /\?\s+for shortcuts/i;
const MODELS_QUOTA_PATTERN = /Models & Quota/i;
const USAGE_GROUP_HEADING_PATTERN = /^[A-Z][A-Z0-9 &/-]+$/;
const LIMIT_LABEL_PATTERN = /limit$/i;
const MODELS_LINE_PATTERN = /^Models within this group:\s*(.+)$/i;
const REFRESH_PATTERN = /Refreshes\s+in\s+(?:(\d+)h)?\s*(?:(\d+)m)?/i;
const SIGN_IN_PATTERN = /\b(?:not signed in|Signing in)\b/i;
const DISABLED_PATTERN = /^Disabled$/i;
const AGY_SETTINGS_PATH = [".gemini", "antigravity-cli", "settings.json"];

export type ParsedAgyUsageGroup = {
	heading: string;
	models: string | null;
	limitLabel: string;
	percentRemaining: number | null;
	resetText: string | null;
	disabled: boolean;
	raw: string;
};

function isTrustDialog(snapshot: PtyWaitSnapshot): boolean {
	return TRUST_DIALOG_PATTERN.test(snapshot.raw) || TRUST_DIALOG_PATTERN.test(snapshot.screen);
}

function isReadyOrTrustDialog(snapshot: PtyWaitSnapshot): boolean {
	return READY_PATTERN.test(snapshot.screen) || isTrustDialog(snapshot);
}

function hasUsagePanel(snapshot: PtyWaitSnapshot): boolean {
	const cleanedOutput = cleanControlOutput(snapshot.raw);
	return (
		(MODELS_QUOTA_PATTERN.test(snapshot.screen) || MODELS_QUOTA_PATTERN.test(cleanedOutput)) &&
		(/% remaining|\bDisabled\b/i.test(snapshot.screen) ||
			/% remaining|\bDisabled\b/i.test(cleanedOutput))
	);
}

function hasUsagePanelOrKnownFailure(snapshot: PtyWaitSnapshot): boolean {
	const cleanedOutput = cleanControlOutput(snapshot.raw);
	return (
		hasUsagePanel(snapshot) ||
		SIGN_IN_PATTERN.test(snapshot.screen) ||
		SIGN_IN_PATTERN.test(cleanedOutput)
	);
}

function withTrustSkip(step: PtyStep): PtyStep {
	// The trust dialog swallows keystrokes; never type into it so the
	// post-scenario check can surface an actionable error instead.
	return { ...step, skipIf: isTrustDialog, skipIfSource: "raw" };
}

export async function extractAgyUsage(
	context: UsageExtractionContext,
): Promise<UsageExtractionResult> {
	const command = context.command ?? context.launch?.command ?? "agy";
	const launchCwd = await resolveAgyUsageCwd(context.homeDir);

	const ptyResult = await runPtyScenario({
		command,
		args: context.launch?.args ?? [],
		cwd: launchCwd,
		cols: 120,
		rows: 40,
		timeoutMs: context.launch?.timeoutMs ?? 70_000,
		signal: context.signal,
		debug: context.debug,
		steps: [
			{ waitFor: isReadyOrTrustDialog, waitForTimeoutMs: 25_000 },
			...typeTextSteps("/usage", 25).map(withTrustSkip),
			withTrustSkip({ waitMs: 250, write: enterKey() }),
			withTrustSkip({
				waitFor: hasUsagePanelOrKnownFailure,
				waitForTimeoutMs: 15_000,
				optional: true,
				capture: "usage",
				captureWaitMs: 500,
			}),
			{ write: escapeKey(), waitMs: 250 },
		],
	});

	const buildError = (message: string): Error => {
		const error = new Error(message);
		if (ptyResult.debug.length > 0) {
			Object.assign(error, { debug: ptyResult.debug });
		}
		return error;
	};

	if (isTrustDialog(ptyResult)) {
		throw buildError(
			`Antigravity has not trusted the usage launch directory yet. Run \`${command}\` in ${launchCwd} once, accept the trust prompt, then re-run usage.`,
		);
	}

	const snapshot = ptyResult.snapshots.usage ?? ptyResult;
	const cleanedOutput = cleanControlOutput(snapshot.raw);
	const groups = parseAgyUsage(snapshot.screen, cleanedOutput);

	if (groups.length === 0) {
		if (SIGN_IN_PATTERN.test(snapshot.screen) || SIGN_IN_PATTERN.test(cleanedOutput)) {
			throw buildError(`Antigravity is not signed in. Run \`${command}\` and complete the login.`);
		}
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

async function resolveAgyUsageCwd(homeDir: string): Promise<string> {
	for (const workspace of await readAgyTrustedWorkspaces(homeDir)) {
		try {
			await access(workspace);
			return workspace;
		} catch {
			// Ignore stale trusted workspace entries.
		}
	}
	return homeDir;
}

async function readAgyTrustedWorkspaces(homeDir: string): Promise<string[]> {
	let raw: string;
	try {
		raw = await readFile(path.join(homeDir, ...AGY_SETTINGS_PATH), "utf8");
	} catch {
		return [];
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}

	if (!parsed || typeof parsed !== "object") {
		return [];
	}
	const trustedWorkspaces = (parsed as { trustedWorkspaces?: unknown }).trustedWorkspaces;
	if (!Array.isArray(trustedWorkspaces)) {
		return [];
	}

	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of trustedWorkspaces) {
		if (typeof value !== "string") {
			continue;
		}
		const normalized = normalizeAgyTrustedWorkspace(value, homeDir);
		if (normalized == null || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		result.push(normalized);
	}
	return result;
}

function normalizeAgyTrustedWorkspace(value: string, homeDir: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	if (trimmed === "~") {
		return homeDir;
	}
	if (trimmed.startsWith("~/")) {
		return path.resolve(homeDir, trimmed.slice(2));
	}
	return path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(homeDir, trimmed);
}

export function parseAgyUsage(screen: string, cleanedOutput = ""): ParsedAgyUsageGroup[] {
	const fromScreen = parseAgyUsageLines(compactLines(screen));
	if (fromScreen.length > 0) {
		return fromScreen;
	}
	return parseAgyUsageLines(compactLines(cleanedOutput));
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
