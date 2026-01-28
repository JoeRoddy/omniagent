import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { echoCommand } from "./commands/echo.js";
import { greetCommand } from "./commands/greet.js";
import { helloCommand } from "./commands/hello.js";
import { syncCommand } from "./commands/sync.js";
import { runShim } from "./shim/index.js";

const VERSION = "0.1.0";
const KNOWN_COMMANDS = new Set(["hello", "greet", "echo", "sync"]);
const SHIM_CAPABILITIES = [
	"Capabilities by agent:",
	"  codex: approval, sandbox, output, model, web",
	"  claude: approval, output, model",
	"  gemini: approval, sandbox, output, model, web",
	"  copilot: approval, model",
	"Unsupported shared flags for a selected agent emit a warning and are ignored.",
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

export function runCli(argv = process.argv, options: RunCliOptions = {}) {
	const args = hideBin(argv);
	let handledFailure = false;

	return yargs(args)
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
					.option("agent", {
						type: "string",
						describe: "Select the agent (built-in id or configured alias).",
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
