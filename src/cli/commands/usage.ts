import { spawn } from "node:child_process";
import os from "node:os";
import { createInterface } from "node:readline/promises";
import type { CommandModule } from "yargs";
import { DEFAULT_AGENTS_DIR, resolveAgentsDir, validateAgentsDir } from "../../lib/agents-dir.js";
import { findRepoRoot } from "../../lib/repo-root.js";
import { buildSupportedTargetLabel } from "../../lib/supported-targets.js";
import { createTargetNameResolver } from "../../lib/sync-targets.js";
import {
	BUILTIN_TARGETS,
	checkCliOnPath,
	loadTargetConfig,
	type ResolvedTarget,
	resolveTargets,
	validateTargetConfig,
} from "../../lib/targets/index.js";
import { normalizeUsageWindow } from "../../lib/usage/format.js";
import {
	type NormalizedUsageDebugArtifact,
	type NormalizedUsageEnvelope,
	type NormalizedUsageError,
	type NormalizedUsageLimit,
	type NormalizedUsageTargetResult,
	type UsageConfirmationRequest,
	type UsageExtractionContext,
	UsageExtractionError,
} from "../../lib/usage/types.js";

type UsageArgs = {
	targets?: string[];
	only?: string | string[];
	sort?: string;
	window?: string;
	timeout?: string;
	agentsDir?: string;
	json?: boolean;
	debug?: boolean;
};

type UsageRunResult = {
	envelope: NormalizedUsageEnvelope;
	exitCode: number;
	selectedTargets: ResolvedTarget[];
};

type UsageCommandAvailability = {
	status: "available" | "unavailable";
	reason?: string;
	warnings: string[];
	command?: string;
	resolvedPath?: string;
};

type TargetExtractionOutcome =
	| {
			status: "success";
			target: ResolvedTarget;
			result: NormalizedUsageTargetResult;
			errors: NormalizedUsageError[];
			notes: string[];
			debug: NormalizedUsageDebugArtifact[];
	  }
	| {
			status: "error";
			target: ResolvedTarget;
			error: NormalizedUsageError;
			debug: NormalizedUsageDebugArtifact[];
	  };

const USAGE_BAR_WIDTH = 12;
const ANSI = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	orange: "\x1b[38;5;208m",
	red: "\x1b[31m",
	gray: "\x1b[90m",
} as const;

type AnsiStyle = keyof typeof ANSI;

type UsageDisplayRow =
	| {
			status: "ok";
			agent: string;
			limitLabel: string;
			reset: string;
			limit: NormalizedUsageLimit;
	  }
	| {
			status: "error";
			agent: string;
			limitLabel: string;
			message: string;
	  };

type UsageTableWidths = {
	agent: number;
	limit: number;
	usage: number;
	left: number;
	reset: number;
};

type UsageSortKey = "reset" | "left";

type UsageConfirmationPrompt = (
	request: UsageConfirmationRequest,
	signal: AbortSignal,
) => Promise<boolean>;

const DEFAULT_USAGE_TIMEOUT_MS = 30_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const DETAILED_RESET_THRESHOLD_MINUTES = 180;
const RELATIVE_RESET_WIDTH = 6;
const RESET_WEEKDAY_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	weekday: "short",
	hour: "numeric",
	minute: "2-digit",
});
const RESET_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

class UsageExtractionTimeoutError extends Error {
	constructor(readonly timeoutMs: number) {
		super(`Usage extraction timed out after ${formatDuration(timeoutMs)}.`);
	}
}

class UsageCommandInterruptedError extends Error {
	constructor() {
		super("Usage cancelled.");
		this.name = "UsageCommandInterruptedError";
	}
}

function normalizeOptionalWindow(value: string | undefined): string | null {
	if (value == null) {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? normalizeUsageWindow(trimmed) : "";
}

function normalizeOptionalSort(value: string | undefined): UsageSortKey | "" | null {
	if (value == null) {
		return null;
	}
	const normalized = value.trim().toLowerCase();
	if (!normalized) {
		return "";
	}
	return normalized === "reset" || normalized === "left" ? normalized : "";
}

function parseTimeoutMs(value: string | undefined): number | null | undefined {
	if (value == null) {
		return undefined;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/i.exec(trimmed);
	if (!match) {
		return null;
	}

	const amount = Number(match[1]);
	const unit = match[2]?.toLowerCase() ?? "s";
	const multiplier = unit === "ms" ? 1 : unit === "m" ? 60_000 : 1_000;
	const timeoutMs = amount * multiplier;
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		return null;
	}
	return Math.ceil(timeoutMs);
}

function resolveTargetTimeoutMs(target: ResolvedTarget, cliTimeoutMs: number | undefined): number {
	return cliTimeoutMs ?? target.usage?.launch?.timeoutMs ?? DEFAULT_USAGE_TIMEOUT_MS;
}

function parseList(value?: string | string[]): string[] {
	if (!value) {
		return [];
	}

	const rawValues = Array.isArray(value) ? value : [value];
	return rawValues
		.flatMap((entry) => entry.split(","))
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
}

function formatDuration(timeoutMs: number): string {
	if (timeoutMs % 60_000 === 0) {
		return `${timeoutMs / 60_000}m`;
	}
	if (timeoutMs % 1_000 === 0) {
		return `${timeoutMs / 1_000}s`;
	}
	return `${timeoutMs}ms`;
}

function uniqueNormalizedWindows(values: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const normalized = normalizeUsageWindow(value);
		if (!normalized || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		result.push(normalized);
	}
	return result;
}

class UsageConfirmationPrompter {
	private rl: ReturnType<typeof createInterface> | null = null;
	private queue: Promise<void> = Promise.resolve();
	private closed = false;
	private readonly interrupt: () => void;

	constructor(interrupt: () => void) {
		this.interrupt = interrupt;
	}

	readonly confirm: UsageConfirmationPrompt = (request, signal) => {
		const confirmation = this.queue.then(() => this.ask(request, signal));
		this.queue = confirmation.then(
			() => undefined,
			() => undefined,
		);
		return confirmation;
	};

	close(): void {
		this.closed = true;
		this.rl?.close();
		this.rl = null;
	}

	private async ask(request: UsageConfirmationRequest, signal: AbortSignal): Promise<boolean> {
		if (this.closed) {
			throw new Error("Usage confirmation is no longer available.");
		}
		if (signal.aborted) {
			throw signal.reason instanceof Error
				? signal.reason
				: new Error("Usage confirmation was cancelled.");
		}
		const scope = request.managed ? "managed usage directory" : "project directory";
		const question = `${request.displayName} needs to trust this ${scope}:\n${request.path}\n\nAllow this? [y/N] `;
		const rl = createInterface({ input: process.stdin, output: process.stderr });
		this.rl = rl;
		const handleInterrupt = () => this.interrupt();
		rl.once("SIGINT", handleInterrupt);
		try {
			while (true) {
				const answer = (await rl.question(question, { signal })).trim().toLowerCase();
				if (!answer || answer === "n" || answer === "no") {
					return false;
				}
				if (answer === "y" || answer === "yes") {
					return true;
				}
				console.error("Please enter yes or no.");
			}
		} catch (error) {
			if (signal.aborted && signal.reason instanceof Error) {
				throw signal.reason;
			}
			throw error;
		} finally {
			rl.removeListener("SIGINT", handleInterrupt);
			rl.close();
			if (this.rl === rl) {
				this.rl = null;
			}
		}
	}
}

function formatUsageTargetLabel(targets: ResolvedTarget[]): string {
	return buildSupportedTargetLabel(targets);
}

function formatSupportedUsageTargetsMessage(targets: ResolvedTarget[]): string {
	const supportedUsageTargets = formatUsageTargetLabel(targets);
	return supportedUsageTargets
		? `Supported usage targets: ${supportedUsageTargets}.`
		: "No active usage-capable targets are enabled by the current target configuration.";
}

function getUsageCommand(target: ResolvedTarget): string | undefined {
	return target.usage?.launch?.command;
}

function supportsUsageConfirmation(target: ResolvedTarget): boolean {
	if (target.id.trim().toLowerCase() === "agy") {
		return true;
	}
	const builtInAgyExtractor = BUILTIN_TARGETS.find((candidate) => candidate.id === "agy")?.usage
		?.extract;
	return builtInAgyExtractor != null && target.usage?.extract === builtInAgyExtractor;
}

async function checkUsageCommandAvailability(
	target: ResolvedTarget,
): Promise<UsageCommandAvailability> {
	const command = getUsageCommand(target)?.trim();
	if (!command) {
		return {
			status: "available",
			warnings: [],
		};
	}

	const check = await checkCliOnPath(command, {
		validateCandidate:
			target.id === "codex" && command === "codex" ? validateCodexCommand : undefined,
	});
	if (check.result === "available") {
		return {
			status: "available",
			warnings: [],
			command,
			resolvedPath: check.resolvedPath ?? command,
		};
	}
	if (check.result === "inconclusive") {
		return {
			status: "unavailable",
			reason: "Usage CLI availability could not be confirmed.",
			warnings: check.warning ? [check.warning] : [],
		};
	}
	return {
		status: "unavailable",
		reason: `Usage CLI not found on PATH: ${command}.`,
		warnings: [],
	};
}

function validateCodexCommand(candidate: string): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawn(candidate, ["--version"], {
			stdio: "ignore",
		});
		let settled = false;
		let timeout: NodeJS.Timeout;
		const finish = (valid: boolean) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			resolve(valid);
		};
		timeout = setTimeout(() => {
			child.kill();
			finish(false);
		}, 2_000);

		child.on("error", () => finish(false));
		child.on("exit", (code) => finish(code === 0));
	});
}

function buildContext(options: {
	target: ResolvedTarget;
	repoRoot: string;
	agentsDir: string;
	homeDir: string;
	selectedWindow: string | null;
	timeoutMs: number;
	debug: boolean;
	now: Date;
	command?: string;
	signal: AbortSignal;
	confirm?: UsageConfirmationPrompt;
}): UsageExtractionContext {
	const windows = uniqueNormalizedWindows(options.target.usage?.windows ?? []);
	const confirm = options.confirm;
	const launch = {
		...(options.target.usage?.launch ?? {}),
		timeoutMs: options.timeoutMs,
	};
	return {
		targetId: options.target.id,
		displayName: options.target.displayName,
		command: options.command ?? getUsageCommand(options.target),
		window: options.selectedWindow ?? windows[0] ?? "",
		windows,
		now: options.now,
		repoRoot: options.repoRoot,
		agentsDir: options.agentsDir,
		homeDir: options.homeDir,
		launch,
		signal: options.signal,
		confirm: confirm == null ? undefined : (request) => confirm(request, options.signal),
		debug: {
			enabled: options.debug,
			includeRawOutput: options.debug,
			includeScreenSnapshots: options.debug,
		},
	};
}

function filterTargetResult(
	target: ResolvedTarget,
	result: NormalizedUsageTargetResult,
	selectedWindow: string | null,
): { result: NormalizedUsageTargetResult; notes: string[]; debug: NormalizedUsageDebugArtifact[] } {
	const normalizedLimits = result.limits.map((limit) => ({
		...limit,
		window: normalizeUsageWindow(limit.window),
	}));
	const filteredLimits =
		selectedWindow == null
			? normalizedLimits
			: normalizedLimits.filter((limit) => limit.window === selectedWindow);
	const resultNotes = result.notes ?? [];
	const notes =
		selectedWindow != null && filteredLimits.length === 0
			? [
					...resultNotes,
					`${target.displayName} reported no usage rows for window "${selectedWindow}".`,
				]
			: resultNotes;

	return {
		result: {
			targetId: result.targetId,
			displayName: result.displayName,
			command: result.command,
			limits: filteredLimits,
		},
		notes,
		debug: result.debug ?? [],
	};
}

function buildError(target: ResolvedTarget, code: string, message: string): NormalizedUsageError {
	return {
		targetId: target.id,
		displayName: target.displayName,
		code,
		message,
	};
}

async function extractUsageForTarget(options: {
	target: ResolvedTarget;
	repoRoot: string;
	agentsDir: string;
	homeDir: string;
	selectedWindow: string | null;
	timeoutMs: number;
	debug: boolean;
	now: Date;
	command?: string;
	confirm?: UsageConfirmationPrompt;
	commandSignal?: AbortSignal;
}): Promise<TargetExtractionOutcome> {
	try {
		const extractor = options.target.usage?.extract;
		if (!extractor) {
			return {
				status: "error",
				target: options.target,
				error: buildError(
					options.target,
					"usage_extractor_missing",
					`${options.target.displayName} does not have a usage extractor.`,
				),
				debug: [],
			};
		}
		const result = await withUsageTimeout(
			(signal) => {
				const context = buildContext({ ...options, signal });
				return extractor(context);
			},
			options.timeoutMs,
			options.commandSignal,
		);
		const filtered = filterTargetResult(options.target, result, options.selectedWindow);
		return {
			status: "success",
			target: options.target,
			result: filtered.result,
			errors: result.errors ?? [],
			notes: filtered.notes,
			debug: filtered.debug,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const code = isUsageTimeoutError(error)
			? "usage_extraction_timeout"
			: getUsageExtractionErrorCode(error);
		return {
			status: "error",
			target: options.target,
			error: buildError(options.target, code, message),
			debug: options.debug ? getErrorDebugArtifacts(error) : [],
		};
	}
}

function getUsageExtractionErrorCode(error: unknown): string {
	if (error instanceof UsageExtractionError) {
		return error.code;
	}
	if (error && typeof error === "object") {
		const code = (error as { code?: unknown }).code;
		if (typeof code === "string") {
			const normalized = code.trim();
			if (/^[a-z][a-z0-9_]*$/.test(normalized)) {
				return normalized;
			}
		}
	}
	return "usage_extraction_failed";
}

function isUsageTimeoutError(error: unknown): boolean {
	if (error instanceof UsageExtractionTimeoutError) {
		return true;
	}
	return Boolean(error && typeof error === "object" && (error as { timedOut?: unknown }).timedOut);
}

function getErrorDebugArtifacts(error: unknown): NormalizedUsageDebugArtifact[] {
	if (!error || typeof error !== "object") {
		return [];
	}
	const debug = (error as { debug?: unknown }).debug;
	if (!Array.isArray(debug)) {
		return [];
	}
	return debug.filter(isDebugArtifact);
}

function isDebugArtifact(value: unknown): value is NormalizedUsageDebugArtifact {
	if (!value || typeof value !== "object") {
		return false;
	}
	const artifact = value as { type?: unknown; label?: unknown };
	return (
		(artifact.type === "raw-output" || artifact.type === "screen-snapshot") &&
		typeof artifact.label === "string"
	);
}

function withUsageTimeout<T>(
	run: (signal: AbortSignal) => Promise<T>,
	timeoutMs: number,
	commandSignal?: AbortSignal,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const controller = new AbortController();
		let settled = false;
		let timeoutFired = false;
		let timeout: NodeJS.Timeout | null = null;
		let removeCommandAbortListener: (() => void) | null = null;
		const cleanup = () => {
			if (timeout != null) {
				clearTimeout(timeout);
			}
			removeCommandAbortListener?.();
		};
		const settleResolve = (value: T) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			resolve(value);
		};
		const settleReject = (error: unknown) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			reject(error);
		};
		timeout = setTimeout(() => {
			timeoutFired = true;
			const error = new UsageExtractionTimeoutError(timeoutMs);
			controller.abort(error);
			setImmediate(() => {
				settleReject(error);
			});
		}, timeoutMs);
		if (commandSignal) {
			const abortFromCommand = () => {
				const reason =
					commandSignal.reason instanceof Error
						? commandSignal.reason
						: new UsageCommandInterruptedError();
				controller.abort(reason);
				settleReject(reason);
			};
			if (commandSignal.aborted) {
				abortFromCommand();
				return;
			}
			commandSignal.addEventListener("abort", abortFromCommand, { once: true });
			removeCommandAbortListener = () =>
				commandSignal.removeEventListener("abort", abortFromCommand);
		}

		let promise: Promise<T>;
		try {
			promise = run(controller.signal);
		} catch (error) {
			settleReject(error);
			return;
		}

		promise.then(
			(value) => {
				if (timeoutFired) {
					return;
				}
				settleResolve(value);
			},
			(error: unknown) => {
				if (timeoutFired && !isUsageTimeoutError(error)) {
					return;
				}
				settleReject(error);
			},
		);
	});
}

function buildEnvelope(options: {
	generatedAt: string;
	targets: NormalizedUsageTargetResult[];
	errors: NormalizedUsageError[];
	notes: string[];
	debug: boolean;
	debugArtifacts: NormalizedUsageDebugArtifact[];
}): NormalizedUsageEnvelope {
	const envelope: NormalizedUsageEnvelope = {
		schemaVersion: 1,
		generatedAt: options.generatedAt,
		targets: options.targets,
		errors: options.errors,
		notes: options.notes,
	};
	if (options.debug && options.debugArtifacts.length > 0) {
		envelope.debug = options.debugArtifacts;
	}
	return envelope;
}

function buildCommandError(code: string, message: string): NormalizedUsageError {
	return {
		targetId: "usage",
		displayName: "Usage command",
		code,
		message,
	};
}

function printError(options: {
	json: boolean;
	code: string;
	message: string;
	exitCode: number;
	target?: ResolvedTarget;
}): void {
	if (options.json) {
		const error = options.target
			? buildError(options.target, options.code, options.message)
			: buildCommandError(options.code, options.message);
		console.log(
			JSON.stringify(
				buildEnvelope({
					generatedAt: new Date().toISOString(),
					targets: [],
					errors: [error],
					notes: [],
					debug: false,
					debugArtifacts: [],
				}),
				null,
				2,
			),
		);
	} else {
		console.error(`Error: ${options.message}`);
	}
	process.exit(options.exitCode);
}

function percentText(value: number | null): string {
	return value == null ? "unknown" : `${Math.round(value)}%`;
}

function usageBar(percentUsed: number | null): string {
	if (percentUsed == null) {
		return `[${"?".repeat(USAGE_BAR_WIDTH)}]`;
	}
	const clamped = Math.max(0, Math.min(100, percentUsed));
	const filled = clamped === 0 ? 0 : Math.max(1, Math.round((clamped / 100) * USAGE_BAR_WIDTH));
	return `[${"#".repeat(filled)}${"-".repeat(USAGE_BAR_WIDTH - filled)}]`;
}

function formatResetValue(limit: NormalizedUsageLimit, now: Date): string {
	const resetAt = parseDate(limit.resetAt);
	if (resetAt != null) {
		return formatLocalResetAt(resetAt, now);
	}

	const value = limit.resetText ?? "-";
	return value === "-" ? value : value.replace(/^resets\s+/i, "");
}

function parseDate(value: string | null | undefined): Date | null {
	if (!value) {
		return null;
	}
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function formatLocalResetAt(resetAt: Date, now: Date): string {
	const relative = formatResetDuration(resetAt.getTime() - now.getTime()).padEnd(
		RELATIVE_RESET_WIDTH,
	);
	return `${relative} (${formatResetExact(resetAt, now)})`;
}

function formatResetDuration(milliseconds: number): string {
	if (milliseconds <= 0) {
		return "now";
	}
	const totalMinutes = Math.max(1, Math.ceil(milliseconds / MS_PER_MINUTE));
	if (totalMinutes < 60) {
		return `${totalMinutes}m`;
	}
	if (totalMinutes < DETAILED_RESET_THRESHOLD_MINUTES) {
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		return minutes === 0 ? `${hours}h` : `${hours}h${minutes}m`;
	}
	if (milliseconds >= MS_PER_DAY) {
		return `${Math.ceil(milliseconds / MS_PER_DAY)}d`;
	}
	return `${Math.round(milliseconds / MS_PER_HOUR)}h`;
}

function formatResetExact(resetAt: Date, now: Date): string {
	const dayDifference = localDayIndex(resetAt) - localDayIndex(now);
	if (dayDifference >= 0 && dayDifference <= 7) {
		return RESET_WEEKDAY_TIME_FORMATTER.format(resetAt);
	}
	return RESET_DATE_TIME_FORMATTER.format(resetAt);
}

function localDayIndex(date: Date): number {
	return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY;
}

function formatLimitLabel(limit: NormalizedUsageLimit): string {
	return limit.label ?? limit.modelLabel ?? limit.modelId ?? formatWindowLabel(limit.window);
}

function formatLimitLabels(limits: NormalizedUsageLimit[]): string[] {
	const baseLabels = limits.map(formatLimitLabel);
	const duplicateLabels = new Set(
		baseLabels.filter((label, index) => baseLabels.indexOf(label) !== index),
	);
	return limits.map((limit, index) => {
		const baseLabel = baseLabels[index] ?? formatLimitLabel(limit);
		if (!duplicateLabels.has(baseLabel) || !limit.scope) {
			return baseLabel;
		}
		if (limit.scope === "main") {
			return baseLabel;
		}
		return `${formatScopeLabel(limit.scope)} ${baseLabel}`;
	});
}

function formatScopeLabel(scope: string): string {
	return scope
		.replace(/[_-]+/g, " ")
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
		.join(" ");
}

function formatWindowLabel(window: string): string {
	if (window === "hourly") {
		return "5h";
	}
	if (window === "weekly") {
		return "Weekly";
	}
	return window;
}

function formatUsageAgentName(targetId: string, displayName: string): string {
	return targetId === "codex" && displayName === "OpenAI Codex" ? "Codex CLI" : displayName;
}

function formatUsageTable(envelope: NormalizedUsageEnvelope, sortKey: UsageSortKey | null): string {
	const useColor = shouldUseColor();
	const generatedAt = parseDate(envelope.generatedAt) ?? new Date();
	const rows: UsageDisplayRow[] = [];
	for (const target of envelope.targets) {
		const limitLabels = formatLimitLabels(target.limits);
		const agentName = formatUsageAgentName(target.targetId, target.displayName);
		target.limits.forEach((limit, index) => {
			rows.push({
				status: "ok",
				agent: sortKey == null && index > 0 ? "" : agentName,
				limitLabel: limitLabels[index] ?? formatLimitLabel(limit),
				reset: formatResetValue(limit, generatedAt),
				limit,
			});
		});
	}
	for (const error of envelope.errors) {
		rows.push({
			status: "error",
			agent: formatUsageAgentName(error.targetId, error.displayName),
			limitLabel: "error",
			message: error.message,
		});
	}
	const rendered = [renderUsageTable(sortUsageRows(rows, sortKey), useColor)];
	if (envelope.notes.length > 0) {
		rendered.push("", ...envelope.notes.map((note) => color(`Note: ${note}`, "dim", useColor)));
	}
	return rendered.join("\n");
}

function sortUsageRows(rows: UsageDisplayRow[], sortKey: UsageSortKey | null): UsageDisplayRow[] {
	if (sortKey == null) {
		return rows;
	}

	return rows
		.map((row, index) => ({ row, index }))
		.sort((left, right) => {
			const leftValue = usageSortValue(left.row, sortKey);
			const rightValue = usageSortValue(right.row, sortKey);
			if (leftValue == null && rightValue == null) {
				return left.index - right.index;
			}
			if (leftValue == null) {
				return 1;
			}
			if (rightValue == null) {
				return -1;
			}
			if (leftValue !== rightValue) {
				return leftValue - rightValue;
			}
			return left.index - right.index;
		})
		.map(({ row }) => row);
}

function usageSortValue(row: UsageDisplayRow, sortKey: UsageSortKey): number | null {
	if (row.status === "error") {
		return null;
	}
	if (sortKey === "left") {
		return row.limit.percentRemaining;
	}
	const resetAt = parseDate(row.limit.resetAt);
	return resetAt?.getTime() ?? null;
}

function renderUsageTable(rows: UsageDisplayRow[], useColor: boolean): string {
	const widths: UsageTableWidths = {
		agent: maxWidth(
			"Agent",
			rows.map((row) => row.agent),
		),
		limit: maxWidth(
			"Limit",
			rows.map((row) => row.limitLabel),
		),
		usage: maxWidth("Usage", rows.map(usageCellText)),
		left: maxWidth("Left", rows.map(leftCellText)),
		reset: maxWidth("Reset", rows.map(resetCellText)),
	};
	const headerLine = [
		pad("Agent", widths.agent),
		pad("Limit", widths.limit),
		pad("Left", widths.left),
		pad("Usage", widths.usage),
		pad("Reset", widths.reset),
	]
		.join("  ")
		.trimEnd();
	const separatorLine = [
		"-".repeat(widths.agent),
		"-".repeat(widths.limit),
		"-".repeat(widths.left),
		"-".repeat(widths.usage),
		"-".repeat(widths.reset),
	]
		.join("  ")
		.trimEnd();

	return [
		color(headerLine, "bold", useColor),
		color(separatorLine, "dim", useColor),
		...rows.map((row) => renderUsageRow(row, widths, useColor)),
	].join("\n");
}

function renderUsageRow(row: UsageDisplayRow, widths: UsageTableWidths, useColor: boolean): string {
	return [
		pad(row.agent, widths.agent),
		pad(row.limitLabel, widths.limit),
		renderLeftCell(row, widths.left, useColor),
		renderUsageCell(row, widths.usage, useColor),
		renderResetCell(row, widths.reset, useColor),
	]
		.join("  ")
		.trimEnd();
}

function usageCellText(row: UsageDisplayRow): string {
	if (row.status === "error") {
		return "failed";
	}
	return `${usageBar(row.limit.percentUsed)} ${percentText(row.limit.percentUsed).padStart(4)} used`;
}

function leftCellText(row: UsageDisplayRow): string {
	if (row.status === "error") {
		return "-";
	}
	if (row.limit.percentRemaining == null && row.limit.remainingText) {
		return row.limit.remainingText;
	}
	return percentText(row.limit.percentRemaining);
}

function resetCellText(row: UsageDisplayRow): string {
	if (row.status === "error") {
		return `Error: ${row.message}`;
	}
	return row.reset;
}

function renderUsageCell(row: UsageDisplayRow, width: number, useColor: boolean): string {
	const text = usageCellText(row);
	const padding = " ".repeat(Math.max(0, width - text.length));
	if (row.status === "error") {
		return `${color(text, "red", useColor)}${padding}`;
	}

	const severity = usageSeverity(row.limit.percentUsed);
	const used = percentText(row.limit.percentUsed).padStart(4);
	return `${color(usageBar(row.limit.percentUsed), severity, useColor)} ${color(
		used,
		severity,
		useColor,
	)} used${padding}`;
}

function renderLeftCell(row: UsageDisplayRow, width: number, useColor: boolean): string {
	const text = leftCellText(row);
	const padding = " ".repeat(Math.max(0, width - text.length));
	if (row.status === "error") {
		return `${color(text, "gray", useColor)}${padding}`;
	}
	return `${color(text, remainingSeverity(row.limit.percentRemaining), useColor)}${padding}`;
}

function renderResetCell(row: UsageDisplayRow, width: number, useColor: boolean): string {
	const text = resetCellText(row);
	const padding = " ".repeat(Math.max(0, width - text.length));
	const style = row.status === "error" ? "red" : "gray";
	return `${color(text, style, useColor)}${padding}`;
}

function usageSeverity(percentUsed: number | null): AnsiStyle {
	if (percentUsed == null) {
		return "gray";
	}
	if (percentUsed >= 95) {
		return "red";
	}
	if (percentUsed >= 80) {
		return "orange";
	}
	if (percentUsed >= 60) {
		return "yellow";
	}
	return "green";
}

function remainingSeverity(percentRemaining: number | null): AnsiStyle {
	if (percentRemaining == null) {
		return "gray";
	}
	if (percentRemaining <= 5) {
		return "red";
	}
	if (percentRemaining <= 20) {
		return "orange";
	}
	if (percentRemaining <= 40) {
		return "yellow";
	}
	return "green";
}

function maxWidth(header: string, values: string[]): number {
	return Math.max(header.length, ...values.map((value) => value.length));
}

function pad(value: string, width: number): string {
	return value.padEnd(width);
}

function color(value: string, style: AnsiStyle, useColor: boolean): string {
	if (!useColor) {
		return value;
	}
	return `${ANSI[style]}${value}${ANSI.reset}`;
}

function shouldUseColor(): boolean {
	if (process.env.FORCE_COLOR != null && process.env.FORCE_COLOR !== "0") {
		return true;
	}
	if (process.env.NO_COLOR != null) {
		return false;
	}
	return Boolean(process.stdout.isTTY);
}

async function runUsageCommand(argv: UsageArgs): Promise<UsageRunResult | null> {
	const positionalTargets = argv.targets ?? [];
	const onlyTargets = parseList(argv.only);
	const jsonOutput = Boolean(argv.json || argv.debug);
	const debugOutput = Boolean(argv.debug);
	const selectedWindow = normalizeOptionalWindow(argv.window);
	const sortKey = normalizeOptionalSort(argv.sort);
	const cliTimeoutMs = parseTimeoutMs(argv.timeout);
	if (selectedWindow === "") {
		printError({
			json: jsonOutput,
			code: "invalid_window",
			message: "--window must be a non-empty value.",
			exitCode: 2,
		});
		return null;
	}
	if (sortKey === "") {
		printError({
			json: jsonOutput,
			code: "invalid_sort",
			message: "--sort must be one of: reset, left.",
			exitCode: 2,
		});
		return null;
	}
	if (sortKey != null && jsonOutput) {
		printError({
			json: jsonOutput,
			code: "sort_json_unsupported",
			message: "--sort is only supported for the human table output.",
			exitCode: 2,
		});
		return null;
	}
	if (cliTimeoutMs === null) {
		printError({
			json: jsonOutput,
			code: "invalid_timeout",
			message:
				"--timeout must be a positive duration. Use seconds by default, or units like 500ms, 5s, or 1m.",
			exitCode: 2,
		});
		return null;
	}
	if (argv.only != null && onlyTargets.length === 0) {
		printError({
			json: jsonOutput,
			code: "invalid_only",
			message: "--only must include at least one target.",
			exitCode: 2,
		});
		return null;
	}
	if (positionalTargets.length > 1) {
		printError({
			json: jsonOutput,
			code: "too_many_targets",
			message: "omniagent usage accepts at most one target.",
			exitCode: 2,
		});
		return null;
	}
	if (positionalTargets.length > 0 && onlyTargets.length > 0) {
		printError({
			json: jsonOutput,
			code: "conflicting_target_selection",
			message: "Use either a positional target or --only, not both.",
			exitCode: 2,
		});
		return null;
	}

	const startDir = process.cwd();
	const repoRoot = (await findRepoRoot(startDir)) ?? startDir;
	const agentsDirResolution = resolveAgentsDir(repoRoot, argv.agentsDir);
	if (agentsDirResolution.source === "override") {
		const validation = await validateAgentsDir(repoRoot, argv.agentsDir, { requireWrite: false });
		if (validation.validationStatus !== "valid") {
			printError({
				json: jsonOutput,
				code: "invalid_agents_dir",
				message: validation.errorMessage,
				exitCode: 1,
			});
			return null;
		}
	}
	const agentsDir = agentsDirResolution.resolvedPath;
	const homeDir = os.homedir();
	const { config } = await loadTargetConfig({ repoRoot, agentsDir });
	const validation = validateTargetConfig({ config, builtIns: BUILTIN_TARGETS });
	if (!validation.valid) {
		printError({
			json: jsonOutput,
			code: "invalid_target_config",
			message: `Invalid target configuration:\n- ${validation.errors.join("\n- ")}`,
			exitCode: 1,
		});
		return null;
	}

	const resolved = resolveTargets({ config: validation.config, builtIns: BUILTIN_TARGETS });
	const targetResolver = createTargetNameResolver(resolved.targets);
	const usageCapableTargets = resolved.targets.filter((target) => target.usage);
	const supportedUsageTargetsMessage = formatSupportedUsageTargetsMessage(usageCapableTargets);
	const usingOnlySelection = onlyTargets.length > 0;
	const explicitTargetNames = positionalTargets[0] ? [positionalTargets[0]] : onlyTargets;
	let selectedTargets: ResolvedTarget[];
	const resolvedUsageCommands = new Map<string, string>();

	if (explicitTargetNames.length > 0) {
		const selectedIds: string[] = [];
		const unknownTargetNames: string[] = [];
		for (const targetName of explicitTargetNames) {
			const resolvedName = targetResolver.resolveTargetName(targetName);
			if (!resolvedName) {
				unknownTargetNames.push(targetName);
				continue;
			}
			if (!selectedIds.includes(resolvedName)) {
				selectedIds.push(resolvedName);
			}
		}
		if (unknownTargetNames.length > 0) {
			const unknownLabel = unknownTargetNames.join(", ");
			const message = usingOnlySelection
				? `Unknown target name(s): ${unknownLabel}. ${supportedUsageTargetsMessage}`
				: `Unknown target: ${unknownLabel}. ${supportedUsageTargetsMessage}`;
			printError({
				json: jsonOutput,
				code: "unknown_target",
				message,
				exitCode: 2,
			});
			return null;
		}
		const requestedTargets = selectedIds.flatMap((targetId) => {
			const target = resolved.byId.get(targetId.toLowerCase());
			return target ? [target] : [];
		});
		const unsupportedTargets = requestedTargets.filter((target) => !target.usage);
		if (unsupportedTargets.length > 0) {
			const unsupportedLabel = unsupportedTargets.map((target) => target.displayName).join(", ");
			printError({
				json: jsonOutput,
				code: "usage_unsupported",
				message: `${unsupportedLabel} does not support usage extraction. ${supportedUsageTargetsMessage}`,
				exitCode: 2,
				target: unsupportedTargets.length === 1 ? unsupportedTargets[0] : undefined,
			});
			return null;
		}

		const requestedUsageIds = new Set(selectedIds);
		selectedTargets = usageCapableTargets.filter((target) => requestedUsageIds.has(target.id));
		const availabilityResults = await Promise.all(
			selectedTargets.map(async (target) => ({
				target,
				availability: await checkUsageCommandAvailability(target),
			})),
		);
		const unavailableResults = availabilityResults.filter(
			({ availability }) => availability.status !== "available",
		);
		if (unavailableResults.length > 0) {
			if (jsonOutput) {
				const now = new Date();
				const envelope = buildEnvelope({
					generatedAt: now.toISOString(),
					targets: [],
					errors: unavailableResults.map(({ target, availability }) =>
						buildError(target, "cli_unavailable", availability.reason ?? "CLI not found on PATH."),
					),
					notes: [],
					debug: debugOutput,
					debugArtifacts: [],
				});
				console.log(JSON.stringify(envelope, null, 2));
			} else if (unavailableResults.length === 1) {
				const unavailableResult = unavailableResults[0];
				if (unavailableResult) {
					const { target, availability } = unavailableResult;
					const message = availability.reason ?? "CLI not found on PATH.";
					console.error(
						`Error: ${target.displayName} usage extraction requires its CLI. ${message}`,
					);
				}
			} else {
				console.error(
					[
						"Error: Some requested usage CLIs are unavailable:",
						...unavailableResults.map(({ target, availability }) => {
							const message = availability.reason ?? "CLI not found on PATH.";
							return `- ${target.displayName}: ${message}`;
						}),
					].join("\n"),
				);
			}
			process.exit(1);
			return null;
		}

		for (const { target, availability } of availabilityResults) {
			const resolvedCommand = availability.resolvedPath ?? availability.command;
			if (resolvedCommand) {
				resolvedUsageCommands.set(target.id, resolvedCommand);
			}
		}
	} else {
		const availabilityResults = await Promise.all(
			usageCapableTargets.map(async (target) => ({
				target,
				availability: await checkUsageCommandAvailability(target),
			})),
		);
		selectedTargets = [];
		for (const { target, availability } of availabilityResults) {
			if (availability.status !== "available") {
				continue;
			}
			selectedTargets.push(target);
			const resolvedCommand = availability.resolvedPath ?? availability.command;
			if (resolvedCommand) {
				resolvedUsageCommands.set(target.id, resolvedCommand);
			}
		}
		if (selectedTargets.length === 0) {
			const supportedUsageTargets = formatUsageTargetLabel(usageCapableTargets);
			const message = supportedUsageTargets
				? "No installed active usage-capable agents were found. Install one of: " +
					`${supportedUsageTargets}.`
				: "No active usage-capable targets are enabled by the current target configuration.";
			if (jsonOutput) {
				const now = new Date();
				const envelope = buildEnvelope({
					generatedAt: now.toISOString(),
					targets: [],
					errors: [],
					notes: [message],
					debug: debugOutput,
					debugArtifacts: [],
				});
				console.log(JSON.stringify(envelope, null, 2));
			} else {
				console.log(message);
			}
			return {
				envelope: buildEnvelope({
					generatedAt: new Date().toISOString(),
					targets: [],
					errors: [],
					notes: [message],
					debug: debugOutput,
					debugArtifacts: [],
				}),
				exitCode: 0,
				selectedTargets,
			};
		}
	}

	const now = new Date();
	const commandController = new AbortController();
	const confirmationPrompter =
		!jsonOutput && Boolean(process.stdin.isTTY) && Boolean(process.stderr.isTTY)
			? new UsageConfirmationPrompter(() => {
					if (!commandController.signal.aborted) {
						commandController.abort(new UsageCommandInterruptedError());
					}
				})
			: null;
	let outcomes: TargetExtractionOutcome[];
	try {
		let confirmationTargetChain: Promise<void> = Promise.resolve();
		const outcomePromises = selectedTargets.map((target) => {
			const extract = () =>
				extractUsageForTarget({
					target,
					repoRoot,
					agentsDir,
					homeDir,
					selectedWindow,
					timeoutMs: resolveTargetTimeoutMs(target, cliTimeoutMs),
					debug: debugOutput,
					now,
					command: resolvedUsageCommands.get(target.id),
					confirm: supportsUsageConfirmation(target) ? confirmationPrompter?.confirm : undefined,
					commandSignal: commandController.signal,
				});
			if (confirmationPrompter == null || !supportsUsageConfirmation(target)) {
				return extract();
			}
			const outcome = confirmationTargetChain.then(extract);
			confirmationTargetChain = outcome.then(
				() => undefined,
				() => undefined,
			);
			return outcome;
		});
		outcomes = await Promise.all(outcomePromises);
	} finally {
		confirmationPrompter?.close();
	}
	if (commandController.signal.reason instanceof UsageCommandInterruptedError) {
		console.error(commandController.signal.reason.message);
		process.exit(130);
		return null;
	}
	const targets: NormalizedUsageTargetResult[] = [];
	const errors: NormalizedUsageError[] = [];
	const notes: string[] = [];
	const debugArtifacts: NormalizedUsageDebugArtifact[] = [];
	for (const outcome of outcomes) {
		if (outcome.status === "success") {
			targets.push(outcome.result);
			errors.push(...outcome.errors);
			notes.push(...outcome.notes);
			debugArtifacts.push(
				...outcome.debug.map((artifact) => ({
					...artifact,
					targetId: outcome.target.id,
					displayName: outcome.target.displayName,
				})),
			);
		} else {
			errors.push(outcome.error);
			debugArtifacts.push(
				...outcome.debug.map((artifact) => ({
					...artifact,
					targetId: outcome.target.id,
					displayName: outcome.target.displayName,
				})),
			);
		}
	}
	const envelope = buildEnvelope({
		generatedAt: now.toISOString(),
		targets,
		errors,
		notes,
		debug: debugOutput,
		debugArtifacts,
	});
	const exitCode = errors.length > 0 ? 1 : 0;
	if (jsonOutput) {
		console.log(JSON.stringify(envelope, null, 2));
	} else {
		console.log(formatUsageTable(envelope, sortKey));
	}
	if (exitCode !== 0) {
		process.exit(exitCode);
	}
	return { envelope, exitCode, selectedTargets };
}

export const usageCommand: CommandModule<unknown, UsageArgs> = {
	command: "usage [targets..]",
	describe: "Report usage limits for installed agent CLIs",
	builder: (yargsInstance) =>
		yargsInstance
			.usage(
				"omniagent usage [target] [--only <targets>] [--sort <key>] [--window <window>] [--timeout <seconds>] [--agentsDir <path>] [--json] [--debug]",
			)
			.positional("targets", {
				type: "string",
				array: true,
				describe: "Optional target id or alias.",
			})
			.option("window", {
				type: "string",
				describe: "Filter usage rows by window (hourly, weekly, 5h, or a custom window).",
			})
			.option("only", {
				type: "string",
				describe: "Comma-separated target ids or aliases to report usage for.",
			})
			.option("sort", {
				type: "string",
				describe: "Globally sort table rows by reset or left.",
			})
			.option("timeout", {
				type: "string",
				describe:
					"Per-agent extraction timeout. Bare numbers are seconds; units include ms, s, and m.",
			})
			.option("agentsDir", {
				type: "string",
				describe:
					"Override the agents directory (relative paths resolve from the project root, or the current directory outside a repo)",
				defaultDescription: DEFAULT_AGENTS_DIR,
				coerce: (value) => {
					if (typeof value !== "string") {
						return value;
					}
					const trimmed = value.trim();
					return trimmed.length > 0 ? trimmed : undefined;
				},
			})
			.option("json", {
				type: "boolean",
				describe: "Print a stable JSON envelope.",
			})
			.option("debug", {
				type: "boolean",
				describe: "Print JSON and include extractor debug artifacts when available.",
			})
			.epilog(
				"Usage extraction may launch agent TUIs and may incur cost if an agent reads repo " +
					"context on startup. Interactive runs may ask before forwarding directory trust; " +
					"JSON, debug, and non-interactive runs never prompt.",
			),
	handler: async (argv) => {
		await runUsageCommand(argv);
	},
};
