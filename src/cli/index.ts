import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { devCommand } from "./commands/dev.js";
import { echoCommand } from "./commands/echo.js";
import { exportCommand } from "./commands/export.js";
import { greetCommand } from "./commands/greet.js";
import { helloCommand } from "./commands/hello.js";
import { profilesCommand } from "./commands/profiles.js";
import { searchCommand } from "./commands/search.js";
import { syncCommand } from "./commands/sync.js";
import { usageCommand } from "./commands/usage.js";
import { runShim } from "./shim/index.js";

function resolveVersion(): string {
	const packageJsonPaths = [
		fileURLToPath(new URL("../package.json", import.meta.url)),
		fileURLToPath(new URL("../../package.json", import.meta.url)),
	];

	for (const packageJsonPath of packageJsonPaths) {
		if (!existsSync(packageJsonPath)) {
			continue;
		}
		try {
			const contents = readFileSync(packageJsonPath, "utf8");
			const parsed = JSON.parse(contents) as { version?: unknown };
			if (typeof parsed.version === "string" && parsed.version.trim().length > 0) {
				return parsed.version;
			}
		} catch {
			// Fall through and try the next candidate.
		}
	}

	return "0.0.0";
}

const VERSION = resolveVersion();
const KNOWN_COMMANDS = new Set([
	"hello",
	"greet",
	"echo",
	"sync",
	"dev",
	"profiles",
	"usage",
	"search",
	"export",
]);
const SHIM_CAPABILITIES = [
	"Capabilities by agent:",
	"  codex: approval, sandbox, output, model, web, effort, output-schema",
	"  claude: approval, output, model, effort, output-schema",
	"  agy: approval, sandbox, model, effort, output-schema (fallback) (alias: gemini)",
	"  copilot: approval, model, effort, output-schema (fallback)",
	"Unsupported shared flags for a selected agent emit a warning and are ignored.",
	"--output-schema is one-shot only; agents without native support use a prompt-based",
	"fallback with client-side validation and retries (--output-schema-retries, default 2).",
].join("\n");

function formatError(message: string, args: string[]) {
	if (message.startsWith("Unknown command:")) {
		return `Error: ${message}`;
	}

	if (message.startsWith("Unknown argument:")) {
		const raw = message.replace("Unknown argument:", "").trim();
		const option = raw.startsWith("-") ? raw : `--${raw}`;
		return `Error: Unknown option: ${option}`;
	}

	if (message.startsWith("Missing required argument:")) {
		const missing = message.replace("Missing required argument:", "").trim();
		return `Error: Missing required argument: ${missing}`;
	}

	if (message.startsWith("Not enough non-option arguments")) {
		const command = args.find((arg) => !arg.startsWith("-"));
		if (command === "greet") {
			return "Error: Missing required argument: name";
		}
		if (command === "export") {
			return "Error: Missing required argument: session-id";
		}

		return "Error: Missing required argument";
	}

	return `Error: ${message}`;
}

type RunCliOptions = {
	shim?: Parameters<typeof runShim>[1];
};

function isCommandInvocation(args: string[]): boolean {
	const command = args[0];
	if (!command || command.startsWith("-")) {
		return false;
	}
	return KNOWN_COMMANDS.has(command);
}

// Short flags that take a value, so an attached form like `-acodex` can be recognized below.
const VALUE_TAKING_SHORT_FLAGS = new Set(["p", "m", "a", "e"]);

// yargs-parser has no attached-value syntax for short options: it splits `-acodex` into a group of
// single-character flags, and .strict() then rejects them — even though parseShimFlags accepts the
// attached form and is the authoritative parser for shim invocations. Rewrite those tokens to the
// `-a=codex` form the gate does understand; the shim still receives the original argv. Anything after
// `--` is passthrough and belongs to the agent, so it is copied verbatim.
//
// The value has to stay in one token. Splitting it into `-a` plus the value lets yargs read a value
// that begins with a dash as another option, so `-p--help` would print help instead of treating
// "--help" as the prompt, and `-m-foo` would be rejected as a flag group.
function expandAttachedShortFlags(args: string[]): string[] {
	const expanded: string[] = [];
	for (const [index, arg] of args.entries()) {
		if (arg === "--") {
			expanded.push(...args.slice(index));
			return expanded;
		}
		const match = /^-([A-Za-z])(.+)$/.exec(arg);
		if (match && VALUE_TAKING_SHORT_FLAGS.has(match[1]) && !match[2].startsWith("=")) {
			expanded.push(`-${match[1]}=${match[2]}`);
			continue;
		}
		expanded.push(arg);
	}
	return expanded;
}

export function runCli(argv = process.argv, options: RunCliOptions = {}) {
	const args = hideBin(argv);
	let handledFailure = false;

	return yargs(expandAttachedShortFlags(args))
		.scriptName("omniagent")
		.version(VERSION)
		.help()
		.strict()
		.strictCommands()
		.parserConfiguration({ "populate--": true })
		.exitProcess(false)
		.fail((msg, err) => {
			if (handledFailure) {
				return;
			}

			handledFailure = true;
			const message = msg || err?.message || "Unknown error";
			console.error(formatError(message, args));
			const exitCode = isCommandInvocation(args) ? 1 : 2;
			process.exit(exitCode);
		})
		.command(helloCommand)
		.command(greetCommand)
		.command(echoCommand)
		.command(syncCommand)
		.command(devCommand)
		.command(profilesCommand)
		.command(usageCommand)
		.command(searchCommand)
		.command(exportCommand)
		.command(
			"$0",
			"omniagent CLI",
			(yargsInstance) =>
				yargsInstance
					.usage("omniagent [flags] --agent <target-id> [-- <agent flags>]")
					.example("omniagent --agent codex", "Start an interactive session (default mode).")
					.example('omniagent -p "Summarize the repo" --agent codex', "Run a one-shot prompt.")
					.example("omniagent --agent codex -- --some-flag", "Pass through agent-specific flags.")
					.option("prompt", {
						alias: "p",
						type: "string",
						describe: "Run a one-shot prompt (non-interactive).",
					})
					.option("approval", {
						type: "string",
						describe: "Approval policy (prompt, auto-edit, yolo).",
					})
					.option("auto-edit", {
						type: "boolean",
						describe: "Alias for --approval auto-edit.",
					})
					.option("yolo", {
						type: "boolean",
						describe: "Alias for --approval yolo.",
					})
					.option("sandbox", {
						type: "string",
						describe: "Sandbox mode (workspace-write, off).",
					})
					.option("output", {
						type: "string",
						describe: "Output format (text, json, stream-json).",
					})
					.option("json", {
						type: "boolean",
						describe: "Alias for --output json.",
					})
					.option("stream-json", {
						type: "boolean",
						describe: "Alias for --output stream-json.",
					})
					.option("model", {
						alias: "m",
						type: "string",
						describe: "Model name to use when supported by the agent.",
					})
					.option("web", {
						type: "string",
						describe: "Enable or disable web access (on/off/true/false/1/0).",
					})
					.option("effort", {
						alias: "e",
						type: "string",
						describe:
							"Reasoning effort level (low, medium, high, xhigh, max); unset keeps the agent default.",
					})
					.option("agent", {
						alias: "a",
						type: "string",
						describe: "Select the agent (built-in id or configured alias).",
					})
					.option("output-schema", {
						type: "string",
						describe:
							"JSON schema file path or inline JSON; emit the final response as schema-conforming JSON (one-shot only).",
					})
					.option("output-schema-retries", {
						type: "number",
						describe:
							"Max retries when a prompt-based --output-schema fallback response fails validation (0-10, default 2).",
					})
					.option("trace-translate", {
						type: "boolean",
						describe: "Emit a JSON line to stderr with the translated agent command/args.",
					})
					.epilog(SHIM_CAPABILITIES),
			async () => {
				const exitCode = await runShim(args, options.shim);
				if (exitCode !== 0) {
					process.exit(exitCode);
				}
			},
		)
		.parseAsync();
}

const entry = process.argv[1];
if (!entry) {
	runCli();
} else {
	const entryUrl = pathToFileURL(realpathSync(entry)).href;
	if (entryUrl === import.meta.url) {
		runCli();
	}
}
