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
	window?: string;
	json?: boolean;
	debug?: boolean;
};

type UsageRunResult = {
	envelope: NormalizedUsageEnvelope;
	exitCode: number;
	selectedTargets: ResolvedTarget[];
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

function normalizeOptionalWindow(value: string | undefined): string | null {
	if (value == null) {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? normalizeUsageWindow(trimmed) : "";
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
): Promise<{ status: "available" | "unavailable"; reason?: string; warnings: string[] }> {
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
		return { status: "available", warnings: [] };
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
	debug: boolean;
	now: Date;
}): UsageExtractionContext {
	const windows = uniqueNormalizedWindows(options.target.usage?.windows ?? []);
	return {
		targetId: options.target.id,
		displayName: options.target.displayName,
		command: getUsageCommand(options.target),
		window: options.selectedWindow ?? windows[0] ?? "",
		windows,
		now: options.now,
		repoRoot: options.repoRoot,
		agentsDir: options.agentsDir,
		homeDir: options.homeDir,
		launch: options.target.usage?.launch,
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
	debug: boolean;
	now: Date;
}): Promise<TargetExtractionOutcome> {
	try {
		const context = buildContext(options);
		const result = await options.target.usage?.extract(context);
		if (!result) {
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
		return {
			status: "error",
			target: options.target,
			error: buildError(options.target, "usage_extraction_failed", message),
		};
	}
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
	return value == null ? "-" : `${Math.round(value)}%`;
}

function usageBar(percentUsed: number | null): string {
	if (percentUsed == null) {
		return "[----------] -";
	}
	const clamped = Math.max(0, Math.min(100, percentUsed));
	const filled = Math.round(clamped / 10);
	return `[${"#".repeat(filled)}${"-".repeat(10 - filled)}] ${percentText(clamped)}`;
}

function resetText(limit: NormalizedUsageLimit): string {
	return limit.resetText ?? limit.resetAt ?? "-";
}

function pad(value: string, width: number): string {
	return `${value}${" ".repeat(Math.max(0, width - value.length))}`;
}

function formatTableRows(rows: string[][]): string {
	const widths = rows[0].map((_, index) => Math.max(...rows.map((row) => row[index]?.length ?? 0)));
	return rows
		.map((row) => row.map((cell, index) => pad(cell, widths[index])).join("  "))
		.join("\n");
}

function formatUsageTable(envelope: NormalizedUsageEnvelope): string {
	const rows = [["Agent", "Window", "Usage", "Left", "Reset"]];
	for (const target of envelope.targets) {
		for (const limit of target.limits) {
			rows.push([
				target.displayName,
				limit.window,
				usageBar(limit.percentUsed),
				percentText(limit.percentRemaining),
				resetText(limit),
			]);
		}
	}
	for (const error of envelope.errors) {
		rows.push([error.displayName, "error", `Error: ${error.message}`, "-", "-"]);
	}
	const rendered = [formatTableRows(rows)];
	if (envelope.notes.length > 0) {
		rendered.push("", ...envelope.notes.map((note) => `Note: ${note}`));
	}
	return rendered.join("\n");
}

async function runUsageCommand(argv: UsageArgs): Promise<UsageRunResult | null> {
	const positionalTargets = argv.targets ?? [];
	const jsonOutput = Boolean(argv.json || argv.debug);
	const debugOutput = Boolean(argv.debug);
	const selectedWindow = normalizeOptionalWindow(argv.window);
	if (selectedWindow === "") {
		printError({
			json: jsonOutput,
			code: "invalid_window",
			message: "--window must be a non-empty value.",
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
	const explicitTargetName = positionalTargets[0];
	let selectedTargets: ResolvedTarget[];

	if (explicitTargetName) {
		const resolvedName = targetResolver.resolveTargetName(explicitTargetName);
		if (!resolvedName) {
			printError({
				json: jsonOutput,
				code: "unknown_target",
				message: `Unknown target: ${explicitTargetName}. Supported usage targets: ${supportedUsageTargets}.`,
				exitCode: 2,
			});
			return null;
		}
		const target = resolved.byId.get(resolvedName.toLowerCase());
		if (!target) {
			printError({
				json: jsonOutput,
				code: "unknown_target",
				message: `Unknown target: ${explicitTargetName}. Supported usage targets: ${supportedUsageTargets}.`,
				exitCode: 2,
			});
			return null;
		}
		if (!target.usage) {
			printError({
				json: jsonOutput,
				code: "usage_unsupported",
				message:
					`${target.displayName} does not support usage extraction. ` +
					`Supported usage targets: ${supportedUsageTargets}.`,
				exitCode: 2,
				target,
			});
			return null;
		}
		const availability = await checkUsageCommandAvailability(target);
		if (availability.status !== "available") {
			const message = availability.reason ?? "CLI not found on PATH.";
			if (jsonOutput) {
				const now = new Date();
				const envelope = buildEnvelope({
					generatedAt: now.toISOString(),
					targets: [],
					errors: [buildError(target, "cli_unavailable", message)],
					notes: [],
					debug: debugOutput,
					debugArtifacts: [],
				});
				console.log(JSON.stringify(envelope, null, 2));
			} else {
				console.error(`Error: ${target.displayName} usage extraction requires its CLI. ${message}`);
			}
			process.exit(1);
			return null;
		}
		selectedTargets = [target];
	} else {
		const availabilityResults = await Promise.all(
			usageCapableTargets.map(async (target) => ({
				target,
				availability: await checkUsageCommandAvailability(target),
			})),
		);
		selectedTargets = availabilityResults
			.filter(({ availability }) => availability.status === "available")
			.map(({ target }) => target);
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
				debug: debugOutput,
				now,
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
			.usage("omniagent usage [target] [--window <window>] [--json] [--debug]")
			.positional("targets", {
				type: "string",
				array: true,
				describe: "Optional target id or alias.",
			})
			.option("window", {
				type: "string",
				describe: "Filter usage rows by window (hourly, weekly, 5h, or a custom window).",
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
