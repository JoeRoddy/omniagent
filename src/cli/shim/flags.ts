import { InvalidUsageError } from "./errors.js";
import {
	APPROVAL_POLICIES,
	type ApprovalPolicy,
	OUTPUT_FORMATS,
	type OutputFormat,
	type ParsedShimFlags,
	SANDBOX_MODES,
	type SandboxMode,
} from "./types.js";

type ArgSplit = {
	preArgs: string[];
	passthroughArgs: string[];
	hasDelimiter: boolean;
};

function splitArgs(argv: string[]): ArgSplit {
	const delimiterIndex = argv.indexOf("--");
	if (delimiterIndex === -1) {
		return { preArgs: argv, passthroughArgs: [], hasDelimiter: false };
	}
	return {
		preArgs: argv.slice(0, delimiterIndex),
		passthroughArgs: argv.slice(delimiterIndex + 1),
		hasDelimiter: true,
	};
}

function normalizeValue(value: string, label: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		throw new InvalidUsageError(`Invalid value for ${label}.`);
	}
	return trimmed;
}

function normalizeEnum<T extends readonly string[]>(
	value: string,
	allowed: T,
	label: string,
): T[number] {
	const normalized = normalizeValue(value, label).toLowerCase();
	if (!allowed.includes(normalized)) {
		throw new InvalidUsageError(
			`Invalid value for ${label}. Allowed values: ${allowed.join(", ")}.`,
		);
	}
	return normalized as T[number];
}

function readFlagValue(args: string[], index: number, label: string): [string, number] {
	const value = args[index + 1];
	if (!value || value.startsWith("-")) {
		throw new InvalidUsageError(`Missing value for ${label}.`);
	}
	return [value, index + 1];
}

function parseBooleanValue(label: string, value: string): boolean {
	const normalized = normalizeValue(value, label).toLowerCase();
	if (["on", "true", "1"].includes(normalized)) {
		return true;
	}
	if (["off", "false", "0"].includes(normalized)) {
		return false;
	}
	throw new InvalidUsageError(
		`Invalid value for ${label}. Allowed values: on, off, true, false, 1, 0.`,
	);
}

export function parseShimFlags(argv: string[]): ParsedShimFlags {
	const { preArgs, passthroughArgs, hasDelimiter } = splitArgs(argv);

	let prompt: string | null = null;
	let promptExplicit = false;
	let approval: ApprovalPolicy = "prompt";
	let approvalExplicit = false;
	let sandbox: SandboxMode = "workspace-write";
	let sandboxExplicit = false;
	let output: OutputFormat = "text";
	let outputExplicit = false;
	let model: string | null = null;
	let modelExplicit = false;
	let web = false;
	let webExplicit = false;
	let agent: string | null = null;
	let agentExplicit = false;
	let traceTranslate = false;
	let help = false;
	let version = false;
	const outputSelections: OutputFormat[] = [];

	for (let index = 0; index < preArgs.length; index += 1) {
		const arg = preArgs[index];

		if (arg === "-h" || arg === "--help") {
			help = true;
			continue;
		}
		if (arg === "--version") {
			version = true;
			continue;
		}
		if (arg === "-p" || arg === "--prompt") {
			const [value, nextIndex] = readFlagValue(preArgs, index, "--prompt");
			prompt = normalizeValue(value, "--prompt");
			promptExplicit = true;
			index = nextIndex;
			continue;
		}
		if (arg.startsWith("-p") && arg !== "-p") {
			prompt = normalizeValue(arg.slice(2), "--prompt");
			promptExplicit = true;
			continue;
		}
		if (arg.startsWith("--prompt=")) {
			prompt = normalizeValue(arg.slice("--prompt=".length), "--prompt");
			promptExplicit = true;
			continue;
		}
		if (arg === "-m" || arg === "--model") {
			const [value, nextIndex] = readFlagValue(preArgs, index, "--model");
			model = normalizeValue(value, "--model");
			modelExplicit = true;
			index = nextIndex;
			continue;
		}
		if (arg.startsWith("-m") && arg !== "-m") {
			model = normalizeValue(arg.slice(2), "--model");
			modelExplicit = true;
			continue;
		}
		if (arg.startsWith("--model=")) {
			model = normalizeValue(arg.slice("--model=".length), "--model");
			modelExplicit = true;
			continue;
		}
		if (arg === "--approval") {
			const [value, nextIndex] = readFlagValue(preArgs, index, "--approval");
			approval = normalizeEnum(value, APPROVAL_POLICIES, "--approval");
			approvalExplicit = true;
			index = nextIndex;
			continue;
		}
		if (arg.startsWith("--approval=")) {
			approval = normalizeEnum(arg.slice("--approval=".length), APPROVAL_POLICIES, "--approval");
			approvalExplicit = true;
			continue;
		}
		if (arg === "--auto-edit") {
			approval = "auto-edit";
			approvalExplicit = true;
			continue;
		}
		if (arg === "--yolo") {
			approval = "yolo";
			approvalExplicit = true;
			continue;
		}
		if (arg === "--sandbox") {
			const [value, nextIndex] = readFlagValue(preArgs, index, "--sandbox");
			sandbox = normalizeEnum(value, SANDBOX_MODES, "--sandbox");
			sandboxExplicit = true;
			index = nextIndex;
			continue;
		}
		if (arg.startsWith("--sandbox=")) {
			sandbox = normalizeEnum(arg.slice("--sandbox=".length), SANDBOX_MODES, "--sandbox");
			sandboxExplicit = true;
			continue;
		}
		if (arg === "--output") {
			const [value, nextIndex] = readFlagValue(preArgs, index, "--output");
			outputSelections.push(normalizeEnum(value, OUTPUT_FORMATS, "--output"));
			outputExplicit = true;
			index = nextIndex;
			continue;
		}
		if (arg.startsWith("--output=")) {
			outputSelections.push(
				normalizeEnum(arg.slice("--output=".length), OUTPUT_FORMATS, "--output"),
			);
			outputExplicit = true;
			continue;
		}
		if (arg === "--json") {
			outputSelections.push("json");
			outputExplicit = true;
			continue;
		}
		if (arg === "--stream-json") {
			outputSelections.push("stream-json");
			outputExplicit = true;
			continue;
		}
		if (arg === "--web") {
			const next = preArgs[index + 1];
			if (next && !next.startsWith("-")) {
				web = parseBooleanValue("--web", next);
				webExplicit = true;
				index += 1;
			} else {
				web = true;
				webExplicit = true;
			}
			continue;
		}
		if (arg.startsWith("--web=")) {
			web = parseBooleanValue("--web", arg.slice("--web=".length));
			webExplicit = true;
			continue;
		}
		if (arg === "--agent") {
			const [value, nextIndex] = readFlagValue(preArgs, index, "--agent");
			const normalized = normalizeValue(value, "--agent").toLowerCase();
			agent = normalized;
			agentExplicit = true;
			index = nextIndex;
			continue;
		}
		if (arg.startsWith("--agent=")) {
			const normalized = normalizeValue(arg.slice("--agent=".length), "--agent").toLowerCase();
			agent = normalized;
			agentExplicit = true;
			continue;
		}
		if (arg === "--trace-translate") {
			traceTranslate = true;
			continue;
		}
		if (arg.startsWith("--trace-translate=")) {
			traceTranslate = parseBooleanValue(
				"--trace-translate",
				arg.slice("--trace-translate=".length),
			);
			continue;
		}

		if (arg.startsWith("-")) {
			throw new InvalidUsageError(`Unknown option: ${arg}`);
		}
	}

	if (outputSelections.length > 0) {
		output = outputSelections[outputSelections.length - 1];
	}

	if (approval === "yolo" && !sandboxExplicit) {
		sandbox = "off";
	}

	return {
		prompt,
		promptExplicit,
		approval,
		approvalExplicit,
		sandbox,
		sandboxExplicit,
		output,
		outputExplicit,
		model,
		modelExplicit,
		web,
		webExplicit,
		agent,
		agentExplicit,
		traceTranslate,
		help,
		version,
		hasDelimiter,
		passthroughArgs,
	};
}
