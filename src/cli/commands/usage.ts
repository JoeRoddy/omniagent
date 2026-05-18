import os from "node:os";
import type { CommandModule } from "yargs";
import { resolveAgentsDir } from "../../lib/agents-dir.js";
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
import type {
	NormalizedUsageDebugArtifact,
	NormalizedUsageEnvelope,
	NormalizedUsageError,
	NormalizedUsageLimit,
	NormalizedUsageTargetResult,
	UsageExtractionContext,
} from "../../lib/usage/types.js";

type UsageArgs = {
	targets?: string[];
	only?: string | string[];
	window?: string;
	timeout?: string;
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

function normalizeOptionalWindow(value: string | undefined): string | null {
	if (value == null) {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? normalizeUsageWindow(trimmed) : "";
}

function parseTimeoutMs(value: string | undefined): number | null {
	if (value == null) {
		return DEFAULT_USAGE_TIMEOUT_MS;
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

function formatUsageTargetLabel(targets: ResolvedTarget[]): string {
	if (targets.length === 0) {
		const builtInUsageTargets = BUILTIN_TARGETS.filter((target) => target.usage).map((target) => ({
			id: target.id,
			displayName: target.displayName ?? target.id,
			aliases: target.aliases ?? [],
			outputs: {},
			isBuiltIn: true,
			isCustomized: false,
		}));
		return buildSupportedTargetLabel(builtInUsageTargets);
	}
	return buildSupportedTargetLabel(targets);
}

function getUsageCommand(target: ResolvedTarget): string | undefined {
	return target.usage?.launch?.command ?? target.cli?.modes.interactive.command;
}

async function checkUsageCommandAvailability(
	target: ResolvedTarget,
): Promise<UsageCommandAvailability> {
	const command = getUsageCommand(target)?.trim();
	if (!command) {
		return {
			status: "unavailable",
			reason: "Target does not declare a usage launch command or CLI command.",
			warnings: [],
		};
	}

	const check = await checkCliOnPath(command);
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
}): UsageExtractionContext {
	const windows = uniqueNormalizedWindows(options.target.usage?.windows ?? []);
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
	const notes =
		selectedWindow != null && filteredLimits.length === 0
			? [`${target.displayName} reported no usage rows for window "${selectedWindow}".`]
			: [];

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
}): Promise<TargetExtractionOutcome> {
	try {
		const context = buildContext(options);
		const extraction = options.target.usage?.extract(context);
		if (!extraction) {
			return {
				status: "error",
				target: options.target,
				error: buildError(
					options.target,
					"usage_extractor_missing",
					`${options.target.displayName} does not have a usage extractor.`,
				),
			};
		}
		const result = await withUsageTimeout(extraction, options.timeoutMs);
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
		const code =
			error instanceof UsageExtractionTimeoutError
				? "usage_extraction_timeout"
				: "usage_extraction_failed";
		return {
			status: "error",
			target: options.target,
			error: buildError(options.target, code, message),
		};
	}
}

function withUsageTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new UsageExtractionTimeoutError(timeoutMs));
		}, timeoutMs);

		promise.then(
			(value) => {
				clearTimeout(timeout);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timeout);
				reject(error);
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

function formatUsageTable(envelope: NormalizedUsageEnvelope): string {
	const useColor = shouldUseColor();
	const generatedAt = parseDate(envelope.generatedAt) ?? new Date();
	const rows: UsageDisplayRow[] = [];
	for (const target of envelope.targets) {
		const limitLabels = formatLimitLabels(target.limits);
		target.limits.forEach((limit, index) => {
			rows.push({
				status: "ok",
				agent: index === 0 ? target.displayName : "",
				limitLabel: limitLabels[index] ?? formatLimitLabel(limit),
				reset: formatResetValue(limit, generatedAt),
				limit,
			});
		});
	}
	for (const error of envelope.errors) {
		rows.push({
			status: "error",
			agent: error.displayName,
			limitLabel: "error",
			message: error.message,
		});
	}
	const rendered = [renderUsageTable(rows, useColor)];
	if (envelope.notes.length > 0) {
		rendered.push("", ...envelope.notes.map((note) => color(`Note: ${note}`, "dim", useColor)));
	}
	return rendered.join("\n");
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
	const timeoutMs = parseTimeoutMs(argv.timeout);
	if (selectedWindow === "") {
		printError({
			json: jsonOutput,
			code: "invalid_window",
			message: "--window must be a non-empty value.",
			exitCode: 2,
		});
		return null;
	}
	if (timeoutMs == null) {
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
	const repoRoot = await findRepoRoot(startDir);
	if (!repoRoot) {
		printError({
			json: jsonOutput,
			code: "repo_not_found",
			message: `Repository root not found starting from ${startDir}. Looked for .git or package.json.`,
			exitCode: 1,
		});
		return null;
	}
	const agentsDir = resolveAgentsDir(repoRoot).resolvedPath;
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
	const supportedUsageTargets = formatUsageTargetLabel(usageCapableTargets);
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
				? `Unknown target name(s): ${unknownLabel}. Supported usage targets: ${supportedUsageTargets}.`
				: `Unknown target: ${unknownLabel}. Supported usage targets: ${supportedUsageTargets}.`;
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
				message:
					`${unsupportedLabel} does not support usage extraction. ` +
					`Supported usage targets: ${supportedUsageTargets}.`,
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
			resolvedUsageCommands.set(
				target.id,
				availability.resolvedPath ?? getUsageCommand(target) ?? "",
			);
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
			resolvedUsageCommands.set(
				target.id,
				availability.resolvedPath ?? getUsageCommand(target) ?? "",
			);
		}
		if (selectedTargets.length === 0) {
			const message =
				"No installed active usage-capable agents were found. Install one of: " +
				`${supportedUsageTargets}.`;
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
	const outcomes = await Promise.all(
		selectedTargets.map((target) =>
			extractUsageForTarget({
				target,
				repoRoot,
				agentsDir,
				homeDir,
				selectedWindow,
				timeoutMs,
				debug: debugOutput,
				now,
				command: resolvedUsageCommands.get(target.id),
			}),
		),
	);
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
		console.log(formatUsageTable(envelope));
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
				"omniagent usage [target] [--only <targets>] [--window <window>] [--timeout <seconds>] [--json] [--debug]",
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
			.option("timeout", {
				type: "string",
				describe:
					"Per-agent extraction timeout. Bare numbers are seconds; units include ms, s, and m.",
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
					"context on startup. omniagent uses cheap/minimal launch settings where possible.",
			),
	handler: async (argv) => {
		await runUsageCommand(argv);
	},
};
