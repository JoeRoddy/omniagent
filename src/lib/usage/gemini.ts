import { readFile } from "node:fs/promises";
import path from "node:path";
import { cleanControlOutput, compactLines, makeUsageLimit } from "./format.js";
import { enterKey, escapeKey, runPtyScenario, typeTextSteps } from "./pty.js";
import type {
	NormalizedUsageLimit,
	UsageExtractionContext,
	UsageExtractionResult,
} from "./types.js";

const TIER_MODEL_IDS = new Map([
	["Flash", "flash"],
	["Flash Lite", "flash-lite"],
	["Pro", "pro"],
]);
const GEMINI_OAUTH_PATH = [".gemini", "oauth_creds.json"];
const GEMINI_CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const GEMINI_CODE_ASSIST_API_VERSION = "v1internal";
const GEMINI_CODE_ASSIST_TIMEOUT_MS = 10_000;
const GEMINI_OAUTH_EXPIRY_SKEW_MS = 60_000;
const GEMINI_MODEL_TIERS = new Map([
	["gemini-2.5-flash", "flash"],
	["gemini-2.5-flash-lite", "flash-lite"],
	["gemini-2.5-pro", "pro"],
	["gemini-3-flash-preview", "flash"],
	["gemini-3-pro-preview", "pro"],
	["gemini-3.1-flash-lite-preview", "flash-lite"],
	["gemini-3.1-pro-preview", "pro"],
]);
const GEMINI_TIER_DISPLAY_NAMES = new Map([
	["flash", "Flash"],
	["flash-lite", "Flash Lite"],
	["pro", "Pro"],
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
	try {
		return await extractGeminiUsageFromApi(context);
	} catch (error) {
		if (context.signal.aborted) {
			throw error;
		}
		return extractGeminiUsageFromTui(context);
	}
}

async function extractGeminiUsageFromTui(
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

async function extractGeminiUsageFromApi(
	context: UsageExtractionContext,
): Promise<UsageExtractionResult> {
	const command = context.command ?? context.launch?.command ?? "gemini";
	const auth = await readGeminiOAuthCredentials(context.homeDir);
	if (auth == null) {
		throw new Error("Gemini OAuth credentials were not available.");
	}

	const accessToken = resolveGeminiAccessToken(auth);
	const projectResponse = await fetchGeminiCodeAssistJson(
		"loadCodeAssist",
		accessToken,
		buildGeminiLoadCodeAssistRequest(),
		context.signal,
	);
	if (projectResponse.status >= 400) {
		throw new Error(`Gemini Code Assist load API returned HTTP ${projectResponse.status}.`);
	}

	const project = extractGeminiCodeAssistProject(projectResponse.body);
	if (project == null) {
		throw new Error("Gemini Code Assist load API did not return a project.");
	}

	const quotaResponse = await fetchGeminiCodeAssistJson(
		"retrieveUserQuota",
		accessToken,
		{ project },
		context.signal,
	);
	if (quotaResponse.status >= 400) {
		throw new Error(`Gemini Code Assist quota API returned HTTP ${quotaResponse.status}.`);
	}

	return buildGeminiApiUsageResult(quotaResponse.body, {
		targetId: context.targetId,
		displayName: context.displayName,
		now: context.now,
		command,
	});
}

type GeminiApiUsageContext = Pick<UsageExtractionContext, "targetId" | "displayName" | "now"> & {
	command?: string;
};

type GeminiOAuthCredentials = {
	accessToken?: string;
	refreshToken?: string;
	expiryDate?: number;
};

type GeminiCodeAssistResponse = {
	status: number;
	body: unknown;
};

type GeminiQuotaPayload = {
	buckets?: GeminiQuotaBucket[];
};

type GeminiQuotaBucket = {
	modelId?: unknown;
	remainingFraction?: unknown;
	remainingAmount?: unknown;
	resetTime?: unknown;
};

type GeminiQuotaRow = {
	modelId: string;
	label: string;
	remainingFraction: number;
	resetAt: string | null;
};

export function buildGeminiApiUsageResult(
	payload: unknown,
	context: GeminiApiUsageContext,
): UsageExtractionResult {
	const usage = isRecord(payload) ? (payload as GeminiQuotaPayload) : {};
	const limits = buildGeminiApiUsageLimits(usage.buckets, context);
	if (limits.length === 0) {
		throw new Error("Gemini Code Assist quota API response did not include model quota buckets.");
	}

	return {
		targetId: context.targetId,
		displayName: context.displayName,
		command: context.command,
		limits,
	};
}

export function extractGeminiOAuthCredentials(blob: string): GeminiOAuthCredentials | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(blob);
	} catch {
		return null;
	}
	if (!isRecord(parsed)) {
		return null;
	}

	const accessToken =
		typeof parsed.access_token === "string" && parsed.access_token.trim()
			? parsed.access_token
			: undefined;
	const refreshToken =
		typeof parsed.refresh_token === "string" && parsed.refresh_token.trim()
			? parsed.refresh_token
			: undefined;
	const expiryDate = parseApiNumber(parsed.expiry_date) ?? undefined;
	if (!accessToken && !refreshToken) {
		return null;
	}
	return { accessToken, refreshToken, expiryDate };
}

async function readGeminiOAuthCredentials(homeDir: string): Promise<GeminiOAuthCredentials | null> {
	try {
		const raw = await readFile(path.join(homeDir, ...GEMINI_OAUTH_PATH), "utf8");
		return extractGeminiOAuthCredentials(raw);
	} catch {
		return null;
	}
}

function resolveGeminiAccessToken(auth: GeminiOAuthCredentials): string {
	if (
		auth.accessToken &&
		(auth.expiryDate == null || auth.expiryDate - Date.now() > GEMINI_OAUTH_EXPIRY_SKEW_MS)
	) {
		return auth.accessToken;
	}
	throw new Error("Gemini cached access token was not available or expired.");
}

async function fetchGeminiCodeAssistJson(
	method: string,
	accessToken: string,
	body: unknown,
	parentSignal: AbortSignal,
): Promise<GeminiCodeAssistResponse> {
	const endpoint = process.env.CODE_ASSIST_ENDPOINT ?? GEMINI_CODE_ASSIST_ENDPOINT;
	const version = process.env.CODE_ASSIST_API_VERSION ?? GEMINI_CODE_ASSIST_API_VERSION;
	const response = await fetchWithTimeout(
		`${endpoint}/${version}:${method}`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify(body),
		},
		parentSignal,
	);

	return {
		status: response.status,
		body: await response.json(),
	};
}

async function fetchWithTimeout(
	input: string,
	init: RequestInit,
	parentSignal: AbortSignal,
): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort(new Error("Gemini Code Assist API request timed out."));
	}, GEMINI_CODE_ASSIST_TIMEOUT_MS);
	const abortFromParent = () => {
		controller.abort(parentSignal.reason);
	};
	parentSignal.addEventListener("abort", abortFromParent, { once: true });

	try {
		return await fetch(input, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timeout);
		parentSignal.removeEventListener("abort", abortFromParent);
	}
}

function buildGeminiLoadCodeAssistRequest(): Record<string, unknown> {
	const project = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT_ID;
	const metadata: Record<string, string> = {
		ideType: "IDE_UNSPECIFIED",
		platform: "PLATFORM_UNSPECIFIED",
		pluginType: "GEMINI",
	};
	if (project) {
		metadata.duetProject = project;
	}
	return {
		...(project ? { cloudaicompanionProject: project } : {}),
		metadata,
	};
}

function extractGeminiCodeAssistProject(payload: unknown): string | null {
	if (!isRecord(payload)) {
		return null;
	}
	const project = payload.cloudaicompanionProject;
	if (typeof project === "string" && project.trim()) {
		return project;
	}
	if (isRecord(project) && typeof project.id === "string" && project.id.trim()) {
		return project.id;
	}
	return null;
}

function buildGeminiApiUsageLimits(
	buckets: GeminiQuotaBucket[] | undefined,
	context: Pick<UsageExtractionContext, "targetId" | "now">,
): NormalizedUsageLimit[] {
	if (!Array.isArray(buckets)) {
		return [];
	}

	return selectGeminiQuotaRows(buckets).map((row) =>
		makeGeminiApiUsageLimit({
			targetId: context.targetId,
			now: context.now,
			row,
		}),
	);
}

function selectGeminiQuotaRows(buckets: GeminiQuotaBucket[]): GeminiQuotaRow[] {
	const grouped = new Map<string, GeminiQuotaRow>();

	for (const bucket of buckets) {
		if (!isRecord(bucket) || typeof bucket.modelId !== "string") {
			continue;
		}
		const remainingFraction = parseApiNumber(bucket.remainingFraction);
		if (remainingFraction == null) {
			continue;
		}

		const modelId = bucket.modelId;
		const tier = GEMINI_MODEL_TIERS.get(modelId);
		const groupId = tier ?? modelId;
		const label =
			tier == null
				? formatGeminiModelLabel(modelId)
				: (GEMINI_TIER_DISPLAY_NAMES.get(tier) ?? tier);
		const row = {
			modelId: groupId,
			label,
			remainingFraction: clampFraction(remainingFraction),
			resetAt: parseGeminiResetTime(bucket.resetTime),
		};
		const existing = grouped.get(groupId);
		if (existing == null || row.remainingFraction < existing.remainingFraction) {
			grouped.set(groupId, row);
		}
	}

	return [...grouped.values()];
}

function makeGeminiApiUsageLimit(options: {
	targetId: string;
	now: Date;
	row: GeminiQuotaRow;
}): NormalizedUsageLimit {
	const percentUsed = Math.round((1 - options.row.remainingFraction) * 100);
	const percentRemaining = 100 - percentUsed;
	const resetText = options.row.resetAt == null ? null : `resets ${options.row.resetAt}`;
	const raw = `${options.row.label} ${percentUsed}% used${resetText == null ? "" : ` (${resetText})`}`;
	const limit = makeUsageLimit({
		targetId: options.targetId,
		scope: modelScope(options.row.modelId),
		window: "model",
		label: options.row.label,
		modelId: options.row.modelId,
		modelLabel: options.row.label,
		percentUsed,
		percentRemaining,
		resetText,
		raw,
		now: options.now,
	});
	return {
		...limit,
		resetAt: options.row.resetAt,
	};
}

function formatGeminiModelLabel(modelId: string): string {
	return modelId.length > 12 ? `${modelId.slice(0, 11)}…` : modelId;
}

function parseGeminiResetTime(value: unknown): string | null {
	if (typeof value !== "string" || !value.trim()) {
		return null;
	}
	const reset = new Date(value);
	if (Number.isNaN(reset.getTime()) || reset.getUTCFullYear() < 2000) {
		return null;
	}
	return reset.toISOString();
}

function parseApiNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value !== "string" || !value.trim()) {
		return null;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function clampFraction(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
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
