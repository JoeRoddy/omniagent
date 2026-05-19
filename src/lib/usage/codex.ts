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
	NormalizedUsageError,
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
	const command = context.command ?? context.launch?.command ?? "codex";
	const ptyResult = await runPtyScenario({
		command,
		args: context.launch?.args ?? ["--no-alt-screen"],
		cwd: context.repoRoot,
		cols: 100,
		rows: 40,
		timeoutMs: context.launch?.timeoutMs ?? 60_000,
		debug: context.debug,
		steps: [
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

function hasCodexStatusLimits(snapshot: { raw: string; screen: string }): boolean {
	const cleanedOutput = cleanControlOutput(`${snapshot.screen}\n${snapshot.raw}`);
	const parsed = parseCodexStatus(cleanedOutput);
	return Boolean(parsed.main5hLimit && parsed.mainWeeklyLimit);
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
	const errors = buildCodexUsageErrors(parsed, context);
	return {
		targetId: context.targetId,
		displayName: context.displayName,
		command: context.command,
		limits: buildCodexUsageLimits(parsed, context),
		errors: errors.length > 0 ? errors : undefined,
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
		return [
			makeUsageLimit({
				targetId: context.targetId,
				scope,
				window,
				percentUsed: percentRemaining == null ? null : 100 - percentRemaining,
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
				section = "spark";
				key = "";
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
	if (parsed.main5hLimit || parsed.mainWeeklyLimit) {
		return;
	}
	throw new Error("Codex usage output did not include the required 5h and weekly limit rows.");
}

function buildCodexUsageErrors(
	parsed: ParsedCodexStatus,
	context: Pick<UsageExtractionContext, "targetId" | "displayName">,
): NormalizedUsageError[] {
	const missing: string[] = [];
	if (!parsed.main5hLimit) {
		missing.push("5h");
	}
	if (!parsed.mainWeeklyLimit) {
		missing.push("weekly");
	}
	if (missing.length === 0) {
		return [];
	}
	return [
		{
			targetId: context.targetId,
			displayName: context.displayName,
			code: "partial_parse",
			message: `Codex usage output did not include the ${missing.join(" and ")} limit row.`,
		},
	];
}

function isCodexSparkLimitLabel(label: string): boolean {
	return /\bspark\b/i.test(label) && /\blimit\b/i.test(label);
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
