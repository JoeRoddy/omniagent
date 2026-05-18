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
	const command = context.launch?.command ?? context.command ?? "gemini";
	const ptyResult = await runPtyScenario({
		command,
		args: context.launch?.args ?? ["--skip-trust"],
		cwd: context.repoRoot,
		cols: 110,
		rows: 42,
		timeoutMs: context.launch?.timeoutMs ?? 70_000,
		debug: context.debug,
		steps: [
			{ waitMs: 8_000 },
			...typeTextSteps("/model", 60),
			{ waitMs: 150, write: enterKey() },
			{ waitMs: 8_000, capture: "model" },
			{ write: escapeKey() },
			{ waitMs: 500 },
			...typeTextSteps("/quit", 30),
			{ waitMs: 150, write: enterKey() },
			{ waitMs: 1_500 },
		],
	});

	const modelSnapshot = ptyResult.snapshots.model ?? ptyResult;
	const cleanedOutput = cleanControlOutput(modelSnapshot.raw);
	const parsed = parseGeminiModelDialog(modelSnapshot.screen, cleanedOutput);

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
