import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CommandModule } from "yargs";
import { DEFAULT_AGENTS_DIR, resolveAgentsDir, validateAgentsDir } from "../../lib/agents-dir.js";
import { buildExportEnvelope, renderChatLog } from "../../lib/history/chat-log.js";
import { type ExportCandidate, exportSession } from "../../lib/history/export.js";
import {
	formatTimestamp,
	sanitizeTerminalText,
	shortenHome,
	shouldUseColor,
} from "../../lib/history/format.js";
import type { SearchNote } from "../../lib/history/types.js";
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

type ExportArgs = {
	sessionId?: string | number;
	verbose?: boolean;
	json?: boolean;
	only?: string | string[];
	output?: string;
	agentsDir?: string;
};

/** How many sessions an ambiguity error lists before summarizing the rest. */
const MAX_LISTED_CANDIDATES = 10;

/** Same comma-or-repeat handling `search`, `sync`, and `usage` use for target lists. */
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
	notes?: SearchNote[];
}): void {
	if (options.json) {
		console.log(
			JSON.stringify(
				{
					schemaVersion: 1,
					session: null,
					events: [],
					errors: [{ targetId: "", displayName: "", code: options.code, message: options.message }],
					notes: options.notes ?? [],
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

/** Notes and warnings go to stderr in both modes so stdout stays a clean, redirectable chat log. */
function emitNotes(notes: SearchNote[], errors: SearchNote[]): void {
	const useColor = shouldUseColor();
	for (const note of notes) {
		const line = `Note: ${sanitizeTerminalText(note.message)}`;
		console.error(useColor ? `\x1b[2m${line}\x1b[0m` : line);
	}
	for (const error of errors) {
		console.error(`Error: ${sanitizeTerminalText(error.message)}`);
	}
}

function describeCandidates(candidates: ExportCandidate[], homeDir: string): string {
	const shown = candidates.slice(0, MAX_LISTED_CANDIDATES);
	const agentWidth = Math.max(...shown.map((candidate) => candidate.agentId.length));
	const idWidth = Math.max(...shown.map((candidate) => candidate.sessionId.length));
	const lines = shown.map((candidate) =>
		[
			`  ${candidate.agentId.padEnd(agentWidth)}`,
			candidate.sessionId.padEnd(idWidth),
			formatTimestamp(candidate.modifiedAt),
			candidate.cwd ? shortenHome(candidate.cwd, homeDir) : "",
		]
			.join("  ")
			.trimEnd(),
	);
	if (candidates.length > shown.length) {
		lines.push(`  … and ${candidates.length - shown.length} more`);
	}
	return lines.join("\n");
}

async function runExportCommand(argv: ExportArgs): Promise<void> {
	const jsonOutput = argv.json === true;
	const verbose = argv.verbose === true;

	// yargs hands back a number for a purely numeric positional; ids are strings.
	const sessionId = String(argv.sessionId ?? "").trim();
	if (sessionId.length === 0) {
		printError({
			json: jsonOutput,
			code: "missing_session_id",
			message:
				"Provide a session id. Find one with `omniagent search <query> --json` " +
				"(matches[].sessionId).",
			exitCode: 2,
		});
		return;
	}

	const onlyTargets = parseList(argv.only);

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
	const exportable = resolved.targets.filter((target) => target.history);
	const supportedLabel = `Exportable targets: ${buildSupportedTargetLabel(exportable)}.`;
	const resolver = createTargetNameResolver(resolved.targets);

	const unknown = onlyTargets.filter((name) => !resolver.resolveTargetName(name));
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
	const unsupported = onlyIds.filter((id) => !resolved.byId.get(id.toLowerCase())?.history);
	if (unsupported.length > 0) {
		printError({
			json: jsonOutput,
			code: "history_unsupported",
			message: `${unsupported.join(", ")} does not record exportable history. ${supportedLabel}`,
			exitCode: 2,
		});
		return;
	}

	const selectedIds = resolveEffectiveTargets({
		defaultTargets: null,
		overrideOnly: onlyIds.length > 0 ? onlyIds : null,
		overrideSkip: null,
		allTargets: exportable.map((target) => target.id),
	});
	const selected = selectedIds.flatMap((id) => {
		const target = resolved.byId.get(id.toLowerCase());
		return target?.history ? [target] : [];
	}) as ResolvedTarget[];
	if (selected.length === 0) {
		printError({
			json: jsonOutput,
			code: "no_export_targets",
			message: `No history-capable targets are enabled. ${supportedLabel}`,
			exitCode: 2,
		});
		return;
	}

	const controller = new AbortController();
	const onInterrupt = () => controller.abort();
	process.once("SIGINT", onInterrupt);

	let result: Awaited<ReturnType<typeof exportSession>>;
	try {
		result = await exportSession({
			targets: selected,
			sessionId,
			homeDir,
			cwd: startDir,
			signal: controller.signal,
		});
	} finally {
		process.removeListener("SIGINT", onInterrupt);
	}

	if (controller.signal.aborted) {
		console.error("Export cancelled.");
		process.exit(130);
		return;
	}

	if (!result.session) {
		emitNotes(result.notes, result.errors);
		if (result.candidates.length > 1) {
			const listing = describeCandidates(result.candidates, homeDir);
			printError({
				json: jsonOutput,
				code: "ambiguous_session_id",
				message:
					`"${sessionId}" matches ${result.candidates.length} sessions. ` +
					`Give a longer id, or pass --only <target>:\n${listing}`,
				exitCode: 2,
				notes: result.notes,
			});
			return;
		}
		const scope = selected.map((target) => target.id).join(", ");
		printError({
			json: jsonOutput,
			code: "session_not_found",
			message:
				`No session matching "${sessionId}" was found in ${scope} history. ` +
				"Find ids with `omniagent search <query> --json` (matches[].sessionId).",
			exitCode: 1,
			notes: result.notes,
		});
		return;
	}

	const rendered = jsonOutput
		? JSON.stringify(
				buildExportEnvelope({
					session: result.session,
					verbose,
					errors: result.errors,
					notes: result.notes,
					generatedAt: new Date().toISOString(),
				}),
				null,
				2,
			)
		: renderChatLog(result.session, { verbose, homeDir });

	emitNotes(result.notes, result.errors);

	if (argv.output) {
		const outputPath = path.resolve(startDir, argv.output);
		try {
			await writeFile(outputPath, rendered.endsWith("\n") ? rendered : `${rendered}\n`, "utf8");
		} catch (error) {
			printError({
				json: jsonOutput,
				code: "output_write_failed",
				message: `Could not write ${outputPath}: ${error instanceof Error ? error.message : String(error)}`,
				exitCode: 1,
			});
			return;
		}
		const useColor = shouldUseColor();
		const check = useColor ? "\x1b[32m✓\x1b[0m" : "✓";
		const count = result.session.events.length;
		console.error(
			`${check} Wrote ${shortenHome(outputPath, homeDir)} (${count} event${count === 1 ? "" : "s"})`,
		);
	} else {
		console.log(rendered);
	}

	if (result.errors.length > 0) {
		process.exit(1);
	}
}

export const exportCommand: CommandModule<Record<string, never>, ExportArgs> = {
	command: "export <session-id>",
	describe: "Export a past agent conversation as a chat log",
	builder: (yargs) =>
		yargs
			.usage(
				"omniagent export <session-id> [--verbose] [--json] [--only <targets>] " +
					"[--output <path>] [--agentsDir <path>]",
			)
			.positional("session-id", {
				type: "string",
				describe:
					"The session (thread) id to export, or a unique prefix of one. " +
					"`omniagent search --json` reports ids as matches[].sessionId.",
			})
			.option("verbose", {
				type: "boolean",
				default: false,
				describe:
					"Expand every tool call with its full input and output (and any readable thinking) " +
					"instead of collapsing each run into a count.",
			})
			.option("only", {
				type: "string",
				describe: "Comma-separated targets to look in (use to disambiguate an id)",
			})
			.option("output", {
				alias: "o",
				type: "string",
				describe: "Write the chat log to this file instead of stdout",
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
				default: false,
				describe: "Print a stable JSON envelope instead of Markdown.",
			})
			.epilog(
				"Reads the transcript directly from disk. No agent CLI is launched, nothing else is " +
					"written, and no network request is made.\n" +
					"By default each run of tool calls between two messages collapses to one line with " +
					"counts by tool; --verbose prints every call's input and output in full.\n" +
					"Subagent transcripts are not included; what the main conversation saw of them is in " +
					"the Task tool's input and result.\n" +
					"Transcripts may contain secrets you pasted; --verbose and --json print tool output " +
					"verbatim.",
			)
			.example(
				"omniagent export 5000f3fc-7e42-4dd8-b368-4587aa32b102",
				"Print a chat log with tool calls collapsed",
			)
			.example("omniagent export 5000f3fc --verbose", "Expand every tool call's input and output")
			.example("omniagent export 5000f3fc --output chat.md", "Write the chat log to a file")
			.example("omniagent export 5000f3fc --json", "Emit a machine-readable envelope")
			.example("omniagent export 5000f3fc --only codex", "Look in one agent's history only")
			.example(
				"omniagent search deploy --json | jq -r '.matches[0].sessionId'",
				"Find a session id to export",
			),
	handler: async (argv) => {
		await runExportCommand(argv);
	},
};
