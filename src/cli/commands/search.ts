import os from "node:os";
import path from "node:path";
import type { CommandModule } from "yargs";
import { DEFAULT_AGENTS_DIR, resolveAgentsDir, validateAgentsDir } from "../../lib/agents-dir.js";
import { ClipboardError, copyToClipboard } from "../../lib/history/clipboard.js";
import {
	expandHome,
	InvalidFilterError,
	isPathLikeProject,
	parseWhen,
} from "../../lib/history/filters.js";
import {
	buildSearchEnvelope,
	collapseText,
	formatSearchSummary,
	formatTimestamp,
	sanitizeTerminalText,
	shouldUseColor,
} from "../../lib/history/format.js";
import { runPicker } from "../../lib/history/picker.js";
import { compileQuery, InvalidQueryError } from "../../lib/history/query.js";
import { searchHistory } from "../../lib/history/search.js";
import {
	HISTORY_ROLES,
	type HistoryRole,
	isHistoryRole,
	type SearchMatch,
	type SearchNote,
	type SearchScope,
} from "../../lib/history/types.js";
import { findRepoRoot } from "../../lib/repo-root.js";
import { buildSupportedTargetLabel } from "../../lib/supported-targets.js";
import { createTargetNameResolver, resolveEffectiveTargets } from "../../lib/sync-targets.js";
import {
	BUILTIN_TARGETS,
	loadTargetConfig,
	type ResolvedTarget,
	resolveTargets,
	validateTargetConfig,
} from "../../lib/targets/index.js";

type SearchArgs = {
	query?: Array<string | number>;
	role?: string;
	project?: string;
	only?: string | string[];
	skip?: string | string[];
	since?: string;
	until?: string;
	allHistory?: boolean;
	limit?: number;
	caseSensitive?: boolean;
	regex?: boolean;
	agentsDir?: string;
	json?: boolean;
	interactive?: boolean;
	copy?: number | boolean | string;
	print?: number | boolean | string;
	full?: boolean;
	"--"?: Array<string | number>;
};

const DEFAULT_LIMIT = 20;

/** Same comma-or-repeat handling `sync` and `usage` use for target lists. */
function parseList(value?: string | string[]): string[] {
	if (!value) {
		return [];
	}
	const raw = Array.isArray(value) ? value : [value];
	return raw
		.flatMap((entry) => entry.split(","))
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
}

function printError(options: {
	json: boolean;
	code: string;
	message: string;
	exitCode: number;
}): void {
	if (options.json) {
		console.log(
			JSON.stringify(
				{
					schemaVersion: 1,
					matches: [],
					errors: [{ targetId: "", displayName: "", code: options.code, message: options.message }],
					notes: [],
				},
				null,
				2,
			),
		);
	} else {
		console.error(`Error: ${sanitizeTerminalText(options.message)}`);
	}
	process.exit(options.exitCode);
}

/**
 * Notes always go to stderr, in both modes — a deliberate divergence from `sync`'s
 * `logWithChannel`. stdout is the pipeable result list, and a warning in the middle of it
 * would break `| head`, `| fzf`, or `| pbcopy`.
 */
function emitNotes(notes: SearchNote[]): void {
	const useColor = shouldUseColor();
	for (const note of notes) {
		const line =
			note.code === "automatic_since"
				? sanitizeTerminalText(note.message)
				: `Note: ${sanitizeTerminalText(note.message)}`;
		console.error(useColor ? `\x1b[2m${line}\x1b[0m` : line);
	}
}

/**
 * Resolves a 1-based result number for --copy / --print. A bare flag means "the newest match".
 * yargs yields NaN when the flag swallowed a query word (`--copy merge conflict`), so that case
 * fails loudly with a message that names the fix instead of silently acting on the wrong result.
 */
function resolveIndex(
	value: number | boolean | string | undefined,
	count: number,
	json: boolean,
	flag: string,
): number | null {
	if (count === 0) {
		printError({ json, code: "no_matches", message: "No matches to select from.", exitCode: 2 });
		return null;
	}
	// A bare flag means "the newest match".
	if (value === undefined || value === true) {
		return 1;
	}
	if (typeof value !== "number" || !Number.isInteger(value)) {
		printError({
			json,
			code: `invalid_${flag}_index`,
			message: `--${flag} expects a result number. Put the query before the flag, for example: omniagent search merge conflict --${flag} 2.`,
			exitCode: 2,
		});
		return null;
	}
	if (value < 1 || value > count) {
		printError({
			json,
			code: "index_out_of_range",
			message: `--${flag} ${value} is out of range; ${count} match${count === 1 ? "" : "es"} available.`,
			exitCode: 2,
		});
		return null;
	}
	return value;
}

function writeText(match: SearchMatch): void {
	process.stdout.write(match.text.endsWith("\n") ? match.text : `${match.text}\n`);
}

function describeMatch(match: SearchMatch): string {
	return [match.agentId, match.project, formatTimestamp(match.timestamp)]
		.filter((part): part is string => Boolean(part))
		.map(collapseText)
		.join(" · ");
}

/**
 * Copies to the clipboard, and on failure prints the value to stdout instead — losing the text
 * because a helper binary is missing would defeat the point of the command.
 */
async function copyValue(value: string, label: string, match: SearchMatch): Promise<boolean> {
	try {
		await copyToClipboard(value);
	} catch (error) {
		console.error(`Error: ${error instanceof ClipboardError ? error.message : String(error)}`);
		console.error("Printing it instead:");
		process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
		return false;
	}
	const useColor = shouldUseColor();
	const check = useColor ? "\x1b[32m✓\x1b[0m" : "✓";
	console.error(`${check} Copied ${label} (${value.length} chars) to clipboard`);
	console.error(useColor ? `\x1b[2m  ${describeMatch(match)}\x1b[0m` : `  ${describeMatch(match)}`);
	return true;
}

async function runSearchCommand(argv: SearchArgs): Promise<void> {
	const jsonOutput = argv.json === true;

	// yargs sends anything after `--` to argv["--"], which is how a leading-dash query is typed.
	const pieces = [...(argv.query ?? []), ...(argv["--"] ?? [])].map((value) => String(value));
	if (pieces.length === 0) {
		printError({
			json: jsonOutput,
			code: "missing_query",
			message: 'Provide a search query. Example: omniagent search "merge conflict".',
			exitCode: 2,
		});
		return;
	}

	// Validated by hand rather than with yargs `choices:`, whose failures route through the root
	// .fail() handler and would exit 1 without a JSON envelope.
	const roleInput = (argv.role ?? "user").trim().toLowerCase();
	let roles: HistoryRole[];
	if (roleInput === "all") {
		roles = [...HISTORY_ROLES];
	} else if (isHistoryRole(roleInput)) {
		roles = [roleInput];
	} else {
		printError({
			json: jsonOutput,
			code: "invalid_role",
			message: `--role must be one of: ${HISTORY_ROLES.join(", ")}, all.`,
			exitCode: 2,
		});
		return;
	}

	const limit = argv.limit ?? DEFAULT_LIMIT;
	if (!Number.isInteger(limit) || limit < 0) {
		printError({
			json: jsonOutput,
			code: "invalid_limit",
			message: "--limit must be a non-negative integer. Use 0 for the 10,000-result cap.",
			exitCode: 2,
		});
		return;
	}
	if (argv.allHistory && (argv.since !== undefined || argv.until !== undefined)) {
		printError({
			json: jsonOutput,
			code: "conflicting_history_scope",
			message: "Use either --all-history or --since/--until, not both.",
			exitCode: 2,
		});
		return;
	}

	let since: Date | null = null;
	let until: Date | null = null;
	try {
		if (argv.since) {
			since = parseWhen(argv.since, { flag: "--since" });
		}
		if (argv.until) {
			until = parseWhen(argv.until, { flag: "--until", endOfDay: true });
		}
	} catch (error) {
		if (error instanceof InvalidFilterError) {
			printError({ json: jsonOutput, code: error.code, message: error.message, exitCode: 2 });
			return;
		}
		throw error;
	}
	if (since && until && since.getTime() > until.getTime()) {
		printError({
			json: jsonOutput,
			code: "invalid_range",
			message: "--since must be before --until.",
			exitCode: 2,
		});
		return;
	}

	const onlyTargets = parseList(argv.only);
	const skipTargets = parseList(argv.skip);
	if (onlyTargets.length > 0 && skipTargets.length > 0) {
		printError({
			json: jsonOutput,
			code: "conflicting_target_selection",
			message: "Use either --only or --skip, not both.",
			exitCode: 2,
		});
		return;
	}

	let query: ReturnType<typeof compileQuery>;
	try {
		query = compileQuery(pieces, { regex: argv.regex === true, caseSensitive: argv.caseSensitive });
	} catch (error) {
		if (error instanceof InvalidQueryError) {
			printError({ json: jsonOutput, code: error.code, message: error.message, exitCode: 2 });
			return;
		}
		throw error;
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
			return;
		}
	}
	const agentsDir = agentsDirResolution.resolvedPath;
	const homeDir = os.homedir();

	const { config } = await loadTargetConfig({ repoRoot, agentsDir });
	const configValidation = validateTargetConfig({ config, builtIns: BUILTIN_TARGETS });
	if (!configValidation.valid) {
		printError({
			json: jsonOutput,
			code: "invalid_target_config",
			message: `Invalid target configuration:\n- ${configValidation.errors.join("\n- ")}`,
			exitCode: 1,
		});
		return;
	}

	const resolved = resolveTargets({ config: configValidation.config, builtIns: BUILTIN_TARGETS });
	const searchable = resolved.targets.filter((target) => target.history);
	const supportedLabel = `Searchable targets: ${buildSupportedTargetLabel(searchable)}.`;
	const resolver = createTargetNameResolver(resolved.targets);

	const explicitNames = onlyTargets.length > 0 ? onlyTargets : skipTargets;
	const unknown = explicitNames.filter((name) => !resolver.resolveTargetName(name));
	if (unknown.length > 0) {
		printError({
			json: jsonOutput,
			code: "unknown_target",
			message: `Unknown target name(s): ${unknown.join(", ")}. ${supportedLabel}`,
			exitCode: 2,
		});
		return;
	}

	const onlyIds = onlyTargets.map((name) => resolver.resolveTargetName(name) as string);
	const skipIds = skipTargets.map((name) => resolver.resolveTargetName(name) as string);
	const unsupported = onlyIds.filter((id) => !resolved.byId.get(id.toLowerCase())?.history);
	if (unsupported.length > 0) {
		printError({
			json: jsonOutput,
			code: "history_unsupported",
			message: `${unsupported.join(", ")} does not record searchable history. ${supportedLabel}`,
			exitCode: 2,
		});
		return;
	}

	const selectedIds = resolveEffectiveTargets({
		defaultTargets: null,
		overrideOnly: onlyIds.length > 0 ? onlyIds : null,
		overrideSkip: skipIds.length > 0 ? skipIds : null,
		allTargets: searchable.map((target) => target.id),
	});
	const selected = selectedIds.flatMap((id) => {
		const target = resolved.byId.get(id.toLowerCase());
		return target?.history ? [target] : [];
	}) as ResolvedTarget[];
	if (selected.length === 0) {
		printError({
			json: jsonOutput,
			code: "no_search_targets",
			message: `No history-capable targets are enabled. ${supportedLabel}`,
			exitCode: 2,
		});
		return;
	}

	const scope: SearchScope = { projectPath: null, projectMatch: null, since, until };
	if (argv.project) {
		if (isPathLikeProject(argv.project)) {
			// A location: resolve it, then scope to the repository containing it, so
			// `--project .` from anywhere inside a repo means "this project".
			const absolute = path.resolve(startDir, expandHome(argv.project, homeDir));
			scope.projectPath = (await findRepoRoot(absolute)) ?? absolute;
		} else {
			scope.projectMatch = argv.project;
		}
	}

	const controller = new AbortController();
	const onInterrupt = () => controller.abort();
	process.once("SIGINT", onInterrupt);

	let result: Awaited<ReturnType<typeof searchHistory>>;
	try {
		result = await searchHistory({
			targets: selected,
			query,
			scope,
			roles: new Set(roles),
			limit,
			homeDir,
			cwd: startDir,
			signal: controller.signal,
			automaticSince: argv.allHistory !== true && since === null && until === null,
		});
	} finally {
		process.removeListener("SIGINT", onInterrupt);
	}

	if (controller.signal.aborted) {
		console.error("Search cancelled.");
		process.exit(130);
		return;
	}

	const notes = [...result.notes];
	if (result.stats.skippedFiles > 0) {
		// Aggregated deliberately: a live session leaves a torn trailing record on every run, so
		// per-file warnings would fire constantly and train people to ignore stderr.
		notes.push({
			targetId: "",
			displayName: "",
			code: "unreadable_files",
			message: `Skipped ${result.stats.skippedFiles} unreadable history file(s).`,
		});
	}

	const envelope = buildSearchEnvelope({
		hits: result.hits,
		stats: result.stats,
		errors: result.errors,
		notes,
		query,
		roles,
		targets: selected.map((target) => target.id),
		projectPath: result.effectiveScope.projectPath,
		projectMatch: result.effectiveScope.projectMatch,
		since: result.effectiveScope.since,
		until: result.effectiveScope.until,
		cwd: startDir,
		homeDir,
		generatedAt: new Date().toISOString(),
	});

	emitNotes(notes);

	// An explicitly requested agent that produced nothing is a failure; the same silence across
	// all agents is just an empty result.
	const explicitlyEmpty =
		onlyIds.length > 0 &&
		result.notes.some(
			(note) => note.code === "history_unavailable" && onlyIds.includes(note.targetId),
		);
	const failed = result.errors.length > 0 || explicitlyEmpty;
	const matches = envelope.matches;

	// --print emits only the message text, so an agent or a pipe gets something clean to consume.
	if (argv.print !== undefined) {
		const index = resolveIndex(argv.print, matches.length, jsonOutput, "print");
		if (index === null) {
			return;
		}
		writeText(matches[index - 1] as SearchMatch);
		if (failed) {
			process.exit(1);
		}
		return;
	}

	const wantsCopy = argv.copy !== undefined;
	// Interactive is the default, but only where it can actually work and where nothing else has
	// already declared a non-interactive intent.
	const interactive =
		argv.interactive !== false &&
		!jsonOutput &&
		!wantsCopy &&
		matches.length > 0 &&
		Boolean(process.stdin.isTTY) &&
		Boolean(process.stdout.isTTY);

	if (interactive) {
		const outcome = await runPicker(
			matches,
			{ input: process.stdin, output: process.stdout, useColor: shouldUseColor() },
			{ query: envelope.query.raw },
		);
		if (outcome.type === "copy-text") {
			const ok = await copyValue(outcome.match.text, "message", outcome.match);
			if (!ok) {
				process.exit(1);
			}
		} else if (outcome.type === "copy-resume") {
			const command = outcome.match.resumeCommand;
			if (command) {
				const ok = await copyValue(command, "resume command", outcome.match);
				if (!ok) {
					process.exit(1);
				}
			} else {
				console.error("Note: that session has no resume command.");
			}
		}
		if (failed) {
			process.exit(1);
		}
		return;
	}

	if (wantsCopy) {
		if (matches.length === 0) {
			console.log(formatSearchSummary(envelope, jsonOutput, { full: argv.full === true }));
			if (failed) {
				process.exit(1);
			}
			return;
		}
		const index = resolveIndex(argv.copy, matches.length, jsonOutput, "copy");
		if (index === null) {
			return;
		}
		const match = matches[index - 1] as SearchMatch;
		const ok = await copyValue(match.text, "message", match);
		if (!ok || failed) {
			process.exit(1);
		}
		return;
	}

	console.log(formatSearchSummary(envelope, jsonOutput, { full: argv.full === true }));

	if (failed) {
		process.exit(1);
	}
}

export const searchCommand: CommandModule<Record<string, never>, SearchArgs> = {
	command: "search [query..]",
	describe: "Search past agent conversations across projects",
	builder: (yargs) =>
		yargs
			.usage(
				"omniagent search <query..> [--role <role>] [--project <path|substring>] " +
					"[--only <targets>] [--skip <targets>] [--since <when>] [--until <when>] " +
					"[--all-history] " +
					"[--limit <n>] [--case-sensitive] [--regex] [--full] [--copy [n]] [--print [n]] " +
					"[--no-interactive] [--agentsDir <path>] [--json]",
			)
			.positional("query", {
				type: "string",
				array: true,
				describe: "Search terms. All terms must match; quote a phrase to match it exactly.",
			})
			.option("role", {
				type: "string",
				default: "user",
				describe: "Which messages to search (user, assistant, agent, all)",
			})
			.option("project", {
				type: "string",
				describe:
					"Scope to a project. A path (., ./x, ~/x, /x) scopes to the repository containing " +
					"it; anything else matches the project path as a substring.",
			})
			.option("only", {
				type: "string",
				describe: "Comma-separated targets to search",
			})
			.option("skip", {
				type: "string",
				describe: "Comma-separated targets to exclude from the search",
			})
			.option("since", {
				type: "string",
				describe:
					"Only match messages at or after this time (YYYY-MM-DD, ISO timestamp, or 7d/24h/30m)",
			})
			.option("until", {
				type: "string",
				describe:
					"Only match messages at or before this time (YYYY-MM-DD, ISO timestamp, or 7d/24h/30m)",
			})
			.option("all-history", {
				type: "boolean",
				default: false,
				describe: "Disable the automatic history cutoff (may be slow)",
			})
			.option("limit", {
				type: "number",
				default: DEFAULT_LIMIT,
				describe: "Maximum matches to print, newest first (0 uses the 10,000-result cap)",
			})
			.option("case-sensitive", {
				type: "boolean",
				default: false,
				describe: "Match case exactly instead of case-insensitively",
			})
			.option("regex", {
				type: "boolean",
				default: false,
				describe: "Treat the query as a regular expression (requires a single quoted pattern)",
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
			.option("interactive", {
				type: "boolean",
				default: true,
				describe:
					"Open the result picker. On by default; use --no-interactive for plain output. " +
					"Automatically disabled outside a TTY and with --json, --copy, or --print.",
			})
			.option("copy", {
				describe:
					"Copy a result to the clipboard without opening the picker. Defaults to the newest match; pass a result number to choose another.",
			})
			.option("print", {
				describe:
					"Write only a result's full message text to stdout. Defaults to the newest match.",
			})
			.option("full", {
				type: "boolean",
				default: false,
				describe: "Print each match's complete text instead of a one-line excerpt",
			})
			.option("json", {
				type: "boolean",
				default: false,
				describe: "Print a stable JSON envelope.",
			})
			.epilog(
				"Reads agent transcripts directly from disk. No agent CLI is launched, nothing is " +
					"written, and no network request is made.\n" +
					"Large unbounded histories may use an automatic --since cutoff; --all-history disables it.\n" +
					"Multiple terms are ANDed; quote a phrase to match it exactly.\n" +
					"Transcripts may contain secrets you pasted; --json prints full message text.",
			)
			.example("omniagent search merge conflict", "Open the picker and copy a past prompt")
			.example("omniagent search merge conflict --copy", "Copy the newest match, no picker")
			.example("omniagent search merge conflict --copy 3", "Copy the third result")
			.example("omniagent search merge conflict --print 2", "Write one result's text to stdout")
			.example("omniagent search merge conflict --full", "Show complete text for every match")
			.example('omniagent search "merge conflict"', "Match the exact phrase")
			.example("omniagent search --project . migration", "Search only this repository")
			.example("omniagent search --project bt-monorepo rls", "Filter by project path substring")
			.example("omniagent search --role assistant flaky test", "Search agent replies, not prompts")
			.example("omniagent search --role agent exploration", "Search subagent transcripts")
			.example("omniagent search --only codex --since 7d deploy", "One agent, last week only")
			.example("omniagent search deploy --all-history", "Search every transcript (may be slow)")
			.example('omniagent search --regex "TODO\\(\\w+\\)"', "Match with a regular expression")
			.example("omniagent search --limit 50 --json refactor", "Emit machine-readable results"),
	handler: async (argv) => {
		await runSearchCommand(argv);
	},
};
