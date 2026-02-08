import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { RunWarning, ScriptExecution, ScriptResultKind } from "./sync-results.js";

const SCRIPT_OPEN_TAG = "<oa-script>";
const SCRIPT_CLOSE_TAG = "</oa-script>";
const SCRIPT_HEARTBEAT_INTERVAL_MS = 30_000;
const PREVIEW_LIMIT = 200;

const RUNNER_SOURCE = String.raw`
import { writeFileSync } from "node:fs";

const encoded = process.env.OMNIAGENT_SCRIPT_B64 ?? "";
const sourceLabel = process.env.OMNIAGENT_SCRIPT_SOURCE ?? "template";
const script = Buffer.from(encoded, "base64").toString("utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function encodeResult(value) {
	if (value === undefined) {
		return { kind: "undefined" };
	}
	if (value === null) {
		return { kind: "null" };
	}
	const valueType = typeof value;
	if (valueType === "string") {
		return { kind: "string", value };
	}
	if (valueType === "number") {
		return { kind: "number", value };
	}
	if (valueType === "boolean") {
		return { kind: "boolean", value };
	}
	if (valueType === "bigint") {
		return { kind: "bigint", value: value.toString() };
	}
	if (valueType === "symbol") {
		return { kind: "symbol", value: String(value) };
	}
	if (valueType === "function") {
		return { kind: "function", value: String(value) };
	}
	try {
		return { kind: "json", value: JSON.stringify(value) };
	} catch {
		return { kind: "coerced", value: String(value) };
	}
}

async function main() {
	try {
		const wrapped = script + "\n//# sourceURL=" + sourceLabel;
		const fn = new AsyncFunction(wrapped);
		const result = await fn();
		writeFileSync(3, JSON.stringify({ ok: true, payload: encodeResult(result) }), "utf8");
	} catch (error) {
		const message =
			error instanceof Error
				? (error.stack ?? error.message)
				: String(error);
		writeFileSync(3, JSON.stringify({ ok: false, error: message }), "utf8");
		process.exitCode = 1;
	}
}

await main();
`;

type RunnerPayload =
	| { kind: "undefined" }
	| { kind: "null" }
	| { kind: "string"; value: string }
	| { kind: "number"; value: number }
	| { kind: "boolean"; value: boolean }
	| { kind: "bigint"; value: string }
	| { kind: "symbol"; value: string }
	| { kind: "function"; value: string }
	| { kind: "json"; value: string }
	| { kind: "coerced"; value: string };

type RunnerSuccess = { ok: true; payload: RunnerPayload };
type RunnerFailure = { ok: false; error: string };
type RunnerResponse = RunnerSuccess | RunnerFailure;

export type DynamicScriptBlock = {
	blockId: string;
	templatePath: string;
	index: number;
	scriptBody: string;
	startOffset: number;
	endOffset: number;
};

export type ParsedTemplateScripts = {
	blocks: DynamicScriptBlock[];
};

type TemplateEvaluation = {
	renderedContent: string;
	blockIds: string[];
};

export type TemplateScriptRuntime = {
	runId: string;
	verbose: boolean;
	heartbeatIntervalMs: number;
	cwd: string;
	cache: Map<string, Promise<TemplateEvaluation>>;
	usageCounts: Map<string, number>;
	scriptExecutions: Map<string, ScriptExecution>;
	warnings: RunWarning[];
	failedTemplatePath: string | null;
	failedBlockId: string | null;
	onWarning?: (warning: RunWarning) => void;
	onVerbose?: (message: string) => void;
};

export type TemplateScriptRuntimeOptions = {
	runId?: string;
	verbose?: boolean;
	heartbeatIntervalMs?: number;
	cwd?: string;
	onWarning?: (warning: RunWarning) => void;
	onVerbose?: (message: string) => void;
};

export type EvaluateTemplateScriptsRequest = {
	templatePath: string;
	content: string;
	runtime: TemplateScriptRuntime;
};

export class TemplateScriptExecutionError extends Error {
	readonly templatePath: string;
	readonly blockId: string | null;

	constructor(message: string, options: { templatePath: string; blockId?: string | null }) {
		super(message);
		this.name = "TemplateScriptExecutionError";
		this.templatePath = options.templatePath;
		this.blockId = options.blockId ?? null;
	}
}

function formatParseError(templatePath: string, message: string): TemplateScriptExecutionError {
	return new TemplateScriptExecutionError(
		`Invalid <oa-script> markup in ${templatePath}: ${message}`,
		{ templatePath },
	);
}

function createStillRunningWarning(options: { templatePath: string; blockId: string }): RunWarning {
	return {
		code: "still_running",
		message: `Template script is still running for ${options.templatePath} (${options.blockId}).`,
		templatePath: options.templatePath,
		blockId: options.blockId,
	};
}

function appendWarning(runtime: TemplateScriptRuntime, warning: RunWarning): void {
	runtime.warnings.push(warning);
	runtime.onWarning?.(warning);
}

function emitVerbose(runtime: TemplateScriptRuntime, message: string): void {
	if (!runtime.verbose) {
		return;
	}
	runtime.onVerbose?.(message);
}

function normalizeScriptResult(payload: RunnerPayload): {
	renderedText: string;
	resultKind: ScriptResultKind;
} {
	if (payload.kind === "undefined" || payload.kind === "null") {
		return { renderedText: "", resultKind: "empty" };
	}
	if (payload.kind === "string") {
		return { renderedText: payload.value, resultKind: "string" };
	}
	if (payload.kind === "json") {
		return { renderedText: payload.value, resultKind: "json" };
	}
	if (payload.kind === "coerced") {
		return { renderedText: payload.value, resultKind: "coerced" };
	}
	return {
		renderedText: String((payload as { value?: unknown }).value ?? ""),
		resultKind: "coerced",
	};
}

function markReusedExecutions(runtime: TemplateScriptRuntime, blockIds: string[]): void {
	for (const blockId of blockIds) {
		const existing = runtime.scriptExecutions.get(blockId);
		if (!existing) {
			continue;
		}
		runtime.scriptExecutions.set(blockId, {
			...existing,
			reusedAcrossTargets: true,
		});
	}
}

function parseTemplateScripts(templatePath: string, content: string): ParsedTemplateScripts {
	const blocks: DynamicScriptBlock[] = [];
	let cursor = 0;
	let index = 0;

	while (cursor < content.length) {
		const nextOpen = content.indexOf(SCRIPT_OPEN_TAG, cursor);
		const nextClose = content.indexOf(SCRIPT_CLOSE_TAG, cursor);

		if (nextClose !== -1 && (nextOpen === -1 || nextClose < nextOpen)) {
			throw formatParseError(templatePath, "closing </oa-script> appears before an opening tag");
		}
		if (nextOpen === -1) {
			break;
		}

		const scriptStart = nextOpen + SCRIPT_OPEN_TAG.length;
		const closeIndex = content.indexOf(SCRIPT_CLOSE_TAG, scriptStart);
		if (closeIndex === -1) {
			throw formatParseError(templatePath, "missing closing </oa-script> tag");
		}

		const scriptBody = content.slice(scriptStart, closeIndex);
		if (scriptBody.includes(SCRIPT_OPEN_TAG)) {
			throw formatParseError(templatePath, "nested <oa-script> blocks are not supported");
		}

		blocks.push({
			blockId: `${templatePath}#${index}`,
			templatePath,
			index,
			scriptBody,
			startOffset: nextOpen,
			endOffset: closeIndex + SCRIPT_CLOSE_TAG.length,
		});
		index += 1;
		cursor = closeIndex + SCRIPT_CLOSE_TAG.length;
	}

	return { blocks };
}

async function executeScriptBlock(options: {
	block: DynamicScriptBlock;
	runtime: TemplateScriptRuntime;
}): Promise<{ renderedText: string; resultKind: ScriptResultKind; durationMs: number }> {
	const { block, runtime } = options;
	const startTime = Date.now();
	const blockLabel = `${block.templatePath}#${block.index}`;
	emitVerbose(runtime, `Evaluating template script ${blockLabel}.`);

	const child = spawn(process.execPath, ["--input-type=module", "--eval", RUNNER_SOURCE], {
		cwd: runtime.cwd,
		env: {
			...process.env,
			OMNIAGENT_SCRIPT_B64: Buffer.from(block.scriptBody, "utf8").toString("base64"),
			OMNIAGENT_SCRIPT_SOURCE: blockLabel,
		},
		stdio: ["ignore", "pipe", "pipe", "pipe"],
	});

	let stderr = "";
	let responseRaw = "";
	const stderrPipe = child.stderr;
	if (stderrPipe) {
		stderrPipe.setEncoding("utf8");
		stderrPipe.on("data", (chunk: string) => {
			stderr += chunk;
		});
	}

	const resultPipe = child.stdio[3] as NodeJS.ReadableStream | null;
	if (resultPipe) {
		resultPipe.setEncoding("utf8");
		resultPipe.on("data", (chunk: string) => {
			responseRaw += chunk;
		});
	}

	let warningTimer: NodeJS.Timeout | null = null;
	if (runtime.heartbeatIntervalMs > 0) {
		warningTimer = setInterval(() => {
			appendWarning(
				runtime,
				createStillRunningWarning({
					templatePath: block.templatePath,
					blockId: block.blockId,
				}),
			);
		}, runtime.heartbeatIntervalMs);
		warningTimer.unref();
	}

	const exitCode = await new Promise<number>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code) => resolve(code ?? 1));
	});
	if (warningTimer) {
		clearInterval(warningTimer);
	}

	const durationMs = Date.now() - startTime;
	const parsed = responseRaw.trim();
	let response: RunnerResponse | null = null;
	if (parsed.length > 0) {
		try {
			response = JSON.parse(parsed) as RunnerResponse;
		} catch {
			response = null;
		}
	}

	if (exitCode !== 0) {
		const message =
			response && !response.ok
				? response.error
				: stderr.trim() || `Script process exited with code ${exitCode}.`;
		throw new TemplateScriptExecutionError(
			`Template script failed in ${block.templatePath} (${block.blockId}): ${message}`,
			{ templatePath: block.templatePath, blockId: block.blockId },
		);
	}

	if (!response || !response.ok) {
		throw new TemplateScriptExecutionError(
			`Template script failed in ${block.templatePath} (${block.blockId}): invalid runner response`,
			{ templatePath: block.templatePath, blockId: block.blockId },
		);
	}

	const normalized = normalizeScriptResult(response.payload);
	emitVerbose(runtime, `Finished template script ${blockLabel} in ${durationMs}ms.`);
	return { ...normalized, durationMs };
}

async function evaluateTemplateScriptsUncached(request: EvaluateTemplateScriptsRequest) {
	const { content, templatePath, runtime } = request;
	const parsed = parseTemplateScripts(templatePath, content);
	if (parsed.blocks.length === 0) {
		return {
			renderedContent: content,
			blockIds: [],
		} satisfies TemplateEvaluation;
	}

	let output = "";
	let cursor = 0;
	const blockIds: string[] = [];
	for (const block of parsed.blocks) {
		output += content.slice(cursor, block.startOffset);
		cursor = block.endOffset;
		blockIds.push(block.blockId);

		runtime.scriptExecutions.set(block.blockId, {
			blockId: block.blockId,
			templatePath,
			status: "running",
			reusedAcrossTargets: false,
		});

		try {
			const executed = await executeScriptBlock({ block, runtime });
			output += executed.renderedText;
			runtime.scriptExecutions.set(block.blockId, {
				blockId: block.blockId,
				templatePath,
				status: "succeeded",
				resultKind: executed.resultKind,
				renderedPreview: executed.renderedText.slice(0, PREVIEW_LIMIT),
				durationMs: executed.durationMs,
				reusedAcrossTargets: false,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			runtime.scriptExecutions.set(block.blockId, {
				blockId: block.blockId,
				templatePath,
				status: "failed",
				errorMessage: message,
				reusedAcrossTargets: false,
			});
			if (!runtime.failedTemplatePath) {
				runtime.failedTemplatePath = templatePath;
				runtime.failedBlockId = block.blockId;
			}
			if (error instanceof TemplateScriptExecutionError) {
				throw error;
			}
			throw new TemplateScriptExecutionError(message, {
				templatePath,
				blockId: block.blockId,
			});
		}
	}
	output += content.slice(cursor);

	return {
		renderedContent: output,
		blockIds,
	} satisfies TemplateEvaluation;
}

export function createTemplateScriptRuntime(
	options: TemplateScriptRuntimeOptions = {},
): TemplateScriptRuntime {
	return {
		runId: options.runId ?? randomUUID(),
		verbose: options.verbose ?? false,
		heartbeatIntervalMs: options.heartbeatIntervalMs ?? SCRIPT_HEARTBEAT_INTERVAL_MS,
		cwd: options.cwd ?? process.cwd(),
		cache: new Map(),
		usageCounts: new Map(),
		scriptExecutions: new Map(),
		warnings: [],
		failedTemplatePath: null,
		failedBlockId: null,
		onWarning: options.onWarning,
		onVerbose: options.onVerbose,
	};
}

export async function evaluateTemplateScripts(
	request: EvaluateTemplateScriptsRequest,
): Promise<string> {
	const usageCount = (request.runtime.usageCounts.get(request.templatePath) ?? 0) + 1;
	request.runtime.usageCounts.set(request.templatePath, usageCount);

	const existing = request.runtime.cache.get(request.templatePath);
	if (existing) {
		const cached = await existing;
		if (usageCount > 1 && cached.blockIds.length > 0) {
			markReusedExecutions(request.runtime, cached.blockIds);
		}
		return cached.renderedContent;
	}

	const evaluationPromise = evaluateTemplateScriptsUncached(request);
	request.runtime.cache.set(request.templatePath, evaluationPromise);

	try {
		const evaluated = await evaluationPromise;
		if (usageCount > 1 && evaluated.blockIds.length > 0) {
			markReusedExecutions(request.runtime, evaluated.blockIds);
		}
		return evaluated.renderedContent;
	} catch (error) {
		request.runtime.cache.delete(request.templatePath);
		throw error;
	}
}

export async function preflightTemplateScripts(options: {
	runtime: TemplateScriptRuntime;
	sources: Array<{ templatePath: string; content: string }>;
}): Promise<void> {
	for (const source of options.sources) {
		await evaluateTemplateScripts({
			templatePath: source.templatePath,
			content: source.content,
			runtime: options.runtime,
		});
	}
}

export function listTemplateScriptExecutions(runtime: TemplateScriptRuntime): ScriptExecution[] {
	return [...runtime.scriptExecutions.values()].sort((left, right) =>
		left.blockId.localeCompare(right.blockId),
	);
}
