import { cleanControlOutput, compactLines, makeUsageLimit, parsePercentUsed } from "./format.js";
import { enterKey, escapeKey, runPtyScenario } from "./pty.js";
import type {
	NormalizedUsageLimit,
	UsageExtractionContext,
	UsageExtractionResult,
} from "./types.js";

export type ParsedClaudeUsage = {
	currentSessionUsed: string;
	currentSessionResets: string;
	currentWeekUsed: string;
	currentWeekResets: string;
};

export async function extractClaudeUsage(
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
		debug: context.debug,
		steps: [
			{ waitMs: 4_000 },
			{ write: enterKey() },
			{ waitMs: 8_000 },
			{ write: `/usage${enterKey()}` },
			{ waitMs: 12_000, capture: "usage" },
			{ write: escapeKey() },
			{ waitMs: 1_000 },
			{ write: `/exit${enterKey()}` },
		],
	});

	const usageSnapshot = ptyResult.snapshots.usage ?? ptyResult;
	const cleanedOutput = cleanControlOutput(usageSnapshot.raw);
	const parsed = parseClaudeUsage(usageSnapshot.screen, cleanedOutput);

	return {
		targetId: context.targetId,
		displayName: context.displayName,
		command,
		limits: buildClaudeUsageLimits(parsed, context),
		debug: ptyResult.debug.length > 0 ? ptyResult.debug : undefined,
	};
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
			section = "currentWeek";
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
