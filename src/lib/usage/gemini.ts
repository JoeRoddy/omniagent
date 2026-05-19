import { cleanControlOutput, compactLines, makeUsageLimit } from "./format.js";
import { enterKey, escapeKey, runPtyScenario, typeTextSteps } from "./pty.js";
import type { UsageExtractionContext, UsageExtractionResult } from "./types.js";

const TIER_MODEL_IDS = new Map([
	["Flash", "flash"],
	["Flash Lite", "flash-lite"],
	["Pro", "pro"],
]);

export type ParsedGeminiUsageRow = {
	name: string;
	percentUsed: number;
	resetText: string;
	raw: string;
};

export type ParsedGeminiModelDialog = {
	selectedModel: string;
	availableModels: string[];
	usage: ParsedGeminiUsageRow[];
};

export async function extractGeminiUsage(
	context: UsageExtractionContext,
): Promise<UsageExtractionResult> {
	const command = context.command ?? context.launch?.command ?? "gemini";
	const ptyResult = await runPtyScenario({
		command,
		args: context.launch?.args ?? ["--skip-trust"],
		cwd: context.repoRoot,
		cols: 110,
		rows: 42,
		timeoutMs: context.launch?.timeoutMs ?? 70_000,
		signal: context.signal,
		debug: context.debug,
		steps: [
			{ waitFor: isGeminiPromptReady, waitForTimeoutMs: 12_000 },
			...typeTextSteps("/model", 20),
			{ waitMs: 150, write: enterKey() },
			{
				waitFor: hasGeminiModelUsage,
				waitForTimeoutMs: 15_000,
				capture: "model",
				captureWaitMs: 500,
			},
			{ write: escapeKey() },
			{ waitMs: 500 },
			...typeTextSteps("/quit", 20),
			{ waitMs: 150, write: enterKey() },
			{ waitMs: 500 },
		],
	});

	const modelSnapshot = ptyResult.snapshots.model ?? ptyResult;
	const cleanedOutput = cleanControlOutput(modelSnapshot.raw);
	const parsed = parseGeminiModelDialog(modelSnapshot.screen, cleanedOutput);
	if (parsed.usage.length === 0) {
		throw new Error("Gemini usage output did not include model usage rows.");
	}

	return {
		targetId: context.targetId,
		displayName: context.displayName,
		command,
		limits: parsed.usage.map((row) => {
			const modelId = resolveModelId(row.name, parsed.availableModels);
			return makeUsageLimit({
				targetId: context.targetId,
				scope: modelScope(modelId),
				window: "model",
				label: row.name,
				modelId,
				modelLabel: row.name,
				percentUsed: row.percentUsed,
				percentRemaining: 100 - row.percentUsed,
				resetText: row.resetText,
				raw: row.raw,
				now: context.now,
			});
		}),
		debug: ptyResult.debug.length > 0 ? ptyResult.debug : undefined,
	};
}

function isGeminiPromptReady(snapshot: { raw: string; screen: string }): boolean {
	const screen = snapshot.screen || cleanControlOutput(snapshot.raw);
	return /Type your message|quota/i.test(screen);
}

function hasGeminiModelUsage(snapshot: { raw: string; screen: string }): boolean {
	const parsed = parseGeminiModelDialog(snapshot.screen, cleanControlOutput(snapshot.raw));
	return parsed.usage.length > 0;
}

export function parseGeminiModelDialog(
	screen: string,
	cleanedOutput = "",
): ParsedGeminiModelDialog {
	const fromScreen = parseGeminiLines(compactLines(screen));
	if (fromScreen.usage.length > 0) {
		return fromScreen;
	}
	return parseGeminiLines(compactLines(cleanedOutput));
}

function parseGeminiLines(lines: string[]): ParsedGeminiModelDialog {
	const availableModels: string[] = [];
	const usage: ParsedGeminiUsageRow[] = [];
	let selectedModel = "";
	let inUsage = false;

	for (const line of lines) {
		const content = stripGeminiFrame(line);
		if (!content) {
			continue;
		}

		const model = parseAvailableModel(content);
		if (model != null) {
			availableModels.push(model.id);
			if (model.selected) {
				selectedModel = model.id;
			}
			continue;
		}

		if (content === "Model usage") {
			inUsage = true;
			continue;
		}

		if (!inUsage) {
			continue;
		}
		if (content.startsWith("(")) {
			break;
		}

		const row = parseUsageRow(content);
		if (row != null) {
			usage.push(row);
		}
	}

	return {
		selectedModel,
		availableModels,
		usage,
	};
}

function parseAvailableModel(
	line: string,
): { selected: boolean; index: number; id: string } | null {
	const match = /^(\u25cf)?\s*(\d+)\.\s+(\S+)$/u.exec(line);
	if (match == null) {
		return null;
	}

	return {
		selected: match[1] != null,
		index: Number(match[2]),
		id: match[3],
	};
}

function parseUsageRow(line: string): ParsedGeminiUsageRow | null {
	const match = /^(.*?)\s+(\d{1,3})%\s*(?:Resets:\s*(.*?))?$/u.exec(line);
	if (match == null) {
		return null;
	}

	return {
		name: stripUsageBar(match[1]),
		percentUsed: Number(match[2]),
		resetText: (match[3] ?? "").trim(),
		raw: line,
	};
}

function stripUsageBar(value: string): string {
	return value.replace(/[\s#=\-_\u2500-\u257F\u2580-\u259F\u25AC]+$/giu, "").trim();
}

function resolveModelId(name: string, availableModels: string[]): string {
	const tierModelId = TIER_MODEL_IDS.get(name);
	if (tierModelId != null) {
		return tierModelId;
	}

	const truncatedPrefix = name.endsWith("...")
		? name.slice(0, -3)
		: name.endsWith("…")
			? name.slice(0, -1)
			: null;
	if (truncatedPrefix) {
		const match = availableModels.find((model) => model.startsWith(truncatedPrefix));
		if (match != null) {
			return match;
		}
	}

	return name;
}

function modelScope(modelId: string): string {
	return modelId
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function stripGeminiFrame(line: string): string {
	return line
		.replace(/^\s*\u2502\s?/u, "")
		.replace(/\s*\u2502\s*$/u, "")
		.trim();
}
