import { cleanControlOutput, compactLines, makeUsageLimit } from "./format.js";
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
const REMAINING_CREDITS_PATTERN = /Remaining AI Credits:\s*(.+?)\s*$/i;
const CREDITS_NOT_ENABLED_PATTERN = /AI Credits not enabled/i;
const ACCOUNT_PLAN_PATTERN = /^\S+@\S+\.\S+\s+\((.+?)\)\s*$/;
const STANDALONE_PLAN_PATTERN = /^\((.*(?:quota|plan|tier).*)\)$/i;
const SIGN_IN_PATTERN = /\b(?:not signed in|Signing in)\b/i;

export type ParsedAgyCredits = {
	remaining: string | null;
	notEnabled: boolean;
	plan: string | null;
	rawLine: string;
};

function isTrustDialog(snapshot: PtyWaitSnapshot): boolean {
	return TRUST_DIALOG_PATTERN.test(snapshot.raw) || TRUST_DIALOG_PATTERN.test(snapshot.screen);
}

function isReadyOrTrustDialog(snapshot: PtyWaitSnapshot): boolean {
	return READY_PATTERN.test(snapshot.screen) || isTrustDialog(snapshot);
}

function hasCreditsPanel(snapshot: PtyWaitSnapshot): boolean {
	return (
		REMAINING_CREDITS_PATTERN.test(snapshot.screen) ||
		REMAINING_CREDITS_PATTERN.test(cleanControlOutput(snapshot.raw))
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

	const ptyResult = await runPtyScenario({
		command,
		args: context.launch?.args ?? [],
		cwd: context.repoRoot,
		cols: 120,
		rows: 40,
		timeoutMs: context.launch?.timeoutMs ?? 70_000,
		signal: context.signal,
		debug: context.debug,
		steps: [
			{ waitFor: isReadyOrTrustDialog, waitForTimeoutMs: 25_000 },
			...typeTextSteps("/credits", 25).map(withTrustSkip),
			withTrustSkip({ waitMs: 250, write: enterKey() }),
			withTrustSkip({
				waitFor: hasCreditsPanel,
				waitForTimeoutMs: 15_000,
				optional: true,
				capture: "credits",
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
			`Antigravity has not trusted this project yet. Run \`${command}\` in ${context.repoRoot} once, accept the trust prompt, then re-run usage.`,
		);
	}

	const snapshot = ptyResult.snapshots.credits ?? ptyResult;
	const cleanedOutput = cleanControlOutput(snapshot.raw);
	const parsed = parseAgyCredits(snapshot.screen, cleanedOutput);

	if (parsed.notEnabled) {
		throw buildError(
			"Antigravity AI Credits are not enabled for this account. Enable them via /settings in agy.",
		);
	}
	if (parsed.remaining == null) {
		if (SIGN_IN_PATTERN.test(snapshot.screen) || SIGN_IN_PATTERN.test(cleanedOutput)) {
			throw buildError(`Antigravity is not signed in. Run \`${command}\` and complete the login.`);
		}
		throw buildError("Antigravity /credits output did not include a Remaining AI Credits value.");
	}

	return {
		targetId: context.targetId,
		displayName: context.displayName,
		command,
		limits: [
			// Credits are an absolute balance rather than a percentage window.
			makeUsageLimit({
				targetId: context.targetId,
				scope: "ai_credits",
				window: "credits",
				label: parsed.plan ? `AI Credits (${parsed.plan})` : "AI Credits",
				percentUsed: null,
				percentRemaining: null,
				remainingText: parsed.remaining,
				resetText: null,
				raw: parsed.rawLine,
				now: context.now,
			}),
		],
		debug: ptyResult.debug.length > 0 ? ptyResult.debug : undefined,
	};
}

export function parseAgyCredits(screen: string, cleanedOutput = ""): ParsedAgyCredits {
	const fromScreen = parseAgyCreditsLines(compactLines(screen));
	if (fromScreen.remaining != null || fromScreen.notEnabled) {
		return fromScreen;
	}
	const fromRaw = parseAgyCreditsLines(compactLines(cleanedOutput));
	if (fromRaw.remaining != null || fromRaw.notEnabled) {
		return fromRaw;
	}
	return fromScreen.plan != null ? fromScreen : fromRaw;
}

function parseAgyCreditsLines(lines: string[]): ParsedAgyCredits {
	const parsed: ParsedAgyCredits = {
		remaining: null,
		notEnabled: false,
		plan: null,
		rawLine: "",
	};

	for (const line of lines) {
		const remainingMatch = REMAINING_CREDITS_PATTERN.exec(line);
		if (remainingMatch?.[1]) {
			const value = remainingMatch[1].trim();
			if (CREDITS_NOT_ENABLED_PATTERN.test(value)) {
				parsed.notEnabled = true;
				parsed.rawLine = line.trim();
				continue;
			}
			parsed.remaining = value;
			parsed.rawLine = line.trim();
			continue;
		}

		if (parsed.plan == null) {
			const planMatch = ACCOUNT_PLAN_PATTERN.exec(line) ?? STANDALONE_PLAN_PATTERN.exec(line);
			if (planMatch?.[1]) {
				parsed.plan = planMatch[1].trim();
			}
		}
	}

	return parsed;
}
