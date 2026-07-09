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
	type PtyWaitSnapshot,
	runPtyScenario,
	typeTextSteps,
} from "./pty.js";
import type { UsageExtractionContext, UsageExtractionResult } from "./types.js";

const TRUST_DIALOG_PATTERN = /Do you trust the contents of this project\?/i;
const READY_PATTERN = /\?\s+for shortcuts/i;
const USAGE_GROUP_HEADING_PATTERN = /^[A-Z][A-Z0-9 &/-]+$/;
const LIMIT_LABEL_PATTERN = /limit$/i;
const MODELS_LINE_PATTERN = /^Models within this group:\s*(.+)$/i;
const REFRESH_PATTERN = /Refreshes\s+in\s+(?:(\d+)h)?\s*(?:(\d+)m)?/i;
const NOT_SIGNED_IN_PATTERN = /\bnot signed in\b/i;
const DISABLED_PATTERN = /^Disabled$/i;
const AGY_USAGE_FALLBACK_PATH = [".omniagent", "state", "usage", "antigravity-cli"];

type AgyUsageCwd = {
	path: string;
	managed: boolean;
};

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

function isCurrentTrustDialog(snapshot: PtyWaitSnapshot): boolean {
	return TRUST_DIALOG_PATTERN.test(snapshot.screen);
}

function isNotCurrentTrustDialog(snapshot: PtyWaitSnapshot): boolean {
	return !isCurrentTrustDialog(snapshot);
}

function isReady(snapshot: PtyWaitSnapshot): boolean {
	return READY_PATTERN.test(snapshot.screen);
}

function isReadyOrTrustDialog(snapshot: PtyWaitSnapshot): boolean {
	return READY_PATTERN.test(snapshot.screen) || isTrustDialog(snapshot);
}

function hasUsagePanel(snapshot: PtyWaitSnapshot): boolean {
	const cleanedOutput = cleanControlOutput(snapshot.raw);
	return parseAgyUsage(snapshot.screen, cleanedOutput).length > 0;
}

function hasUsagePanelOrKnownFailure(snapshot: PtyWaitSnapshot): boolean {
	const cleanedOutput = cleanControlOutput(snapshot.raw);
	return (
		hasUsagePanel(snapshot) ||
		NOT_SIGNED_IN_PATTERN.test(snapshot.screen) ||
		NOT_SIGNED_IN_PATTERN.test(cleanedOutput)
	);
}

function withTrustSkip(step: PtyStep): PtyStep {
	// The trust dialog swallows keystrokes; never type into it so the
	// post-scenario check can surface an actionable error instead.
	return { ...step, skipIf: isCurrentTrustDialog, skipIfSource: "screen" };
}

export async function extractAgyUsage(
	context: UsageExtractionContext,
): Promise<UsageExtractionResult> {
	const command = context.command ?? context.launch?.command ?? "agy";
	const launchCwd = await ensureAgyUsageCwd(context.homeDir, context.repoRoot);

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
			{ waitFor: isReadyOrTrustDialog, waitForTimeoutMs: 25_000 },
			...buildManagedTrustSteps(launchCwd.managed),
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

	if (isCurrentTrustDialog(ptyResult)) {
		if (!launchCwd.managed) {
			throw buildError(
				`Antigravity has not trusted this project yet. Run \`${command}\` in ${launchCwd.path} once, accept the trust prompt, then re-run usage.`,
			);
		}
		throw buildError(
			`Antigravity did not accept the managed usage launch directory trust prompt automatically. Run \`${command}\` in ${launchCwd.path} once, accept the trust prompt, then re-run usage.`,
		);
	}

	const snapshot = ptyResult.snapshots.usage ?? ptyResult;
	const cleanedOutput = cleanControlOutput(snapshot.raw);
	const groups = parseAgyUsage(snapshot.screen, cleanedOutput);

	if (groups.length === 0) {
		if (NOT_SIGNED_IN_PATTERN.test(snapshot.screen) || NOT_SIGNED_IN_PATTERN.test(cleanedOutput)) {
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

function buildManagedTrustSteps(shouldAutoAccept: boolean): PtyStep[] {
	if (!shouldAutoAccept) {
		return [];
	}
	return [
		{
			skipIf: isNotCurrentTrustDialog,
			skipIfSource: "screen",
			waitMs: 250,
			write: enterKey(),
		},
		{ waitFor: isReady, waitForTimeoutMs: 25_000 },
	];
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
