import type { NormalizedUsageLimit, UsageWindow } from "./types.js";

const MONTHS = new Map([
	["jan", 0],
	["january", 0],
	["feb", 1],
	["february", 1],
	["mar", 2],
	["march", 2],
	["apr", 3],
	["april", 3],
	["may", 4],
	["jun", 5],
	["june", 5],
	["jul", 6],
	["july", 6],
	["aug", 7],
	["august", 7],
	["sep", 8],
	["sept", 8],
	["september", 8],
	["oct", 9],
	["october", 9],
	["nov", 10],
	["november", 10],
	["dec", 11],
	["december", 11],
]);
const ESCAPE_CHARACTER = String.fromCharCode(27);
const BELL_CHARACTER = String.fromCharCode(7);
const OSC_SEQUENCE_PATTERN = new RegExp(
	`${escapeRegExp(ESCAPE_CHARACTER)}\\][\\s\\S]*?(?:${escapeRegExp(BELL_CHARACTER)}|${escapeRegExp(ESCAPE_CHARACTER)}\\\\)`,
	"g",
);
const CSI_SEQUENCE_PATTERN = new RegExp(
	`${escapeRegExp(ESCAPE_CHARACTER)}\\[[0-?]*[ -/]*[@-~]`,
	"g",
);
const CHARSET_SEQUENCE_PATTERN = new RegExp(
	`${escapeRegExp(ESCAPE_CHARACTER)}[()][A-Za-z0-9]`,
	"g",
);
const MODE_SEQUENCE_PATTERN = new RegExp(`${escapeRegExp(ESCAPE_CHARACTER)}[=>]`, "g");

export type MakeUsageLimitOptions = {
	targetId: string;
	agent?: string;
	scope?: string;
	window: UsageWindow;
	label?: string;
	modelId?: string;
	modelLabel?: string;
	percentUsed: number | null;
	percentRemaining: number | null;
	remainingText?: string | null;
	resetText?: string | null;
	raw?: string;
	now: Date;
	resetSourceTimeZone?: "local" | "utc";
};

export function makeUsageLimit(options: MakeUsageLimitOptions): NormalizedUsageLimit {
	const agent = options.agent ?? options.targetId;
	const resetText = emptyToNull(options.resetText);
	const window = normalizeUsageWindow(options.window);

	return {
		id: [options.targetId, options.scope, window, options.modelId].filter(Boolean).join("."),
		targetId: options.targetId,
		agent,
		scope: options.scope,
		window,
		label: options.label,
		modelId: options.modelId,
		modelLabel: options.modelLabel,
		percentUsed: options.percentUsed,
		percentRemaining: options.percentRemaining,
		remainingText: emptyToNull(options.remainingText) ?? undefined,
		resetAt: parseResetAt(resetText, {
			now: options.now,
			sourceTimeZone: options.resetSourceTimeZone ?? "local",
		}),
		resetText,
		raw: options.raw ?? "",
	};
}

export function parsePercentUsed(value: string | null | undefined): number | null {
	return parsePercent(value, /(\d+(?:\.\d+)?)\s*%\s*used/i);
}

export function parsePercentRemaining(value: string | null | undefined): number | null {
	return parsePercent(value, /(\d+(?:\.\d+)?)\s*%\s*(?:left|remaining)/i);
}

export function parsePercent(
	value: string | null | undefined,
	pattern = /(\d+(?:\.\d+)?)\s*%/,
): number | null {
	const match = pattern.exec(value ?? "");
	if (match == null) {
		return null;
	}
	return Number(match[1]);
}

export function parseResetText(value: string | null | undefined): string | null {
	const match = /\((resets[^)]*)\)/i.exec(value ?? "");
	return match == null ? null : match[1].trim();
}

export function normalizeUsageWindow(window: UsageWindow): UsageWindow {
	const normalized = window.trim().toLowerCase();
	if (
		normalized === "5h" ||
		normalized === "five_hour" ||
		normalized === "five-hour" ||
		normalized === "session" ||
		normalized === "hourly"
	) {
		return "hourly";
	}
	if (normalized === "week" || normalized === "current_week" || normalized === "weekly") {
		return "weekly";
	}
	if (normalized === "model") {
		return "model";
	}
	return normalized;
}

export function cleanControlOutput(raw: string): string {
	return raw
		.replace(OSC_SEQUENCE_PATTERN, "")
		.replace(CSI_SEQUENCE_PATTERN, "")
		.replace(CHARSET_SEQUENCE_PATTERN, "")
		.replace(MODE_SEQUENCE_PATTERN, "")
		.replace(/\r/g, "\n")
		.split("\n")
		.map((line) => line.replace(/[ \t]+$/g, ""))
		.join("\n");
}

export function compactLines(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

export function parseResetAt(
	resetText: string | null | undefined,
	options: { now?: Date; sourceTimeZone?: "local" | "utc" } = {},
): string | null {
	const now = options.now ?? new Date();
	const sourceTimeZone = options.sourceTimeZone ?? "local";
	const text = normalizeResetText(resetText);
	if (!text) {
		return null;
	}

	return (
		parseHourMinuteOnDayMonth(text, now, sourceTimeZone) ??
		parseMonthDayAtTime(text, now, sourceTimeZone) ??
		parseDayMonthAtTime(text, now, sourceTimeZone) ??
		parseTimeOnly(text, now, sourceTimeZone)
	);
}

function parseHourMinuteOnDayMonth(
	text: string,
	now: Date,
	sourceTimeZone: "local" | "utc",
): string | null {
	const match = /^(\d{1,2}):(\d{2})\s+on\s+(\d{1,2})\s+([A-Za-z]+)$/i.exec(text);
	if (match == null) {
		return null;
	}

	const [, hour, minute, day, monthName] = match;
	const month = parseMonth(monthName);
	if (month == null) {
		return null;
	}

	return buildFutureDate(now, sourceTimeZone, {
		month,
		day: Number(day),
		hour: Number(hour),
		minute: Number(minute),
	});
}

function parseMonthDayAtTime(
	text: string,
	now: Date,
	sourceTimeZone: "local" | "utc",
): string | null {
	const match = /^([A-Za-z]+)\s+(\d{1,2})(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i.exec(
		text,
	);
	if (match == null) {
		return null;
	}

	const [, monthName, day, hour = "0", minute = "0", meridiem] = match;
	const month = parseMonth(monthName);
	if (month == null) {
		return null;
	}

	return buildFutureDate(now, sourceTimeZone, {
		month,
		day: Number(day),
		hour: parseHour(hour, meridiem),
		minute: Number(minute),
	});
}

function parseDayMonthAtTime(
	text: string,
	now: Date,
	sourceTimeZone: "local" | "utc",
): string | null {
	const match = /^(\d{1,2})\s+([A-Za-z]+)(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i.exec(
		text,
	);
	if (match == null) {
		return null;
	}

	const [, day, monthName, hour = "0", minute = "0", meridiem] = match;
	const month = parseMonth(monthName);
	if (month == null) {
		return null;
	}

	return buildFutureDate(now, sourceTimeZone, {
		month,
		day: Number(day),
		hour: parseHour(hour, meridiem),
		minute: Number(minute),
	});
}

function parseTimeOnly(text: string, now: Date, sourceTimeZone: "local" | "utc"): string | null {
	const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text);
	if (match == null) {
		return null;
	}

	const [, hour, minute = "0", meridiem] = match;
	const date =
		sourceTimeZone === "utc"
			? new Date(
					Date.UTC(
						now.getUTCFullYear(),
						now.getUTCMonth(),
						now.getUTCDate(),
						parseHour(hour, meridiem),
						Number(minute),
					),
				)
			: new Date(
					now.getFullYear(),
					now.getMonth(),
					now.getDate(),
					parseHour(hour, meridiem),
					Number(minute),
				);

	if (date <= now) {
		if (sourceTimeZone === "utc") {
			date.setUTCDate(date.getUTCDate() + 1);
		} else {
			date.setDate(date.getDate() + 1);
		}
	}
	return date.toISOString();
}

function buildFutureDate(
	now: Date,
	sourceTimeZone: "local" | "utc",
	values: { month: number; day: number; hour: number; minute: number },
): string {
	const date =
		sourceTimeZone === "utc"
			? new Date(
					Date.UTC(now.getUTCFullYear(), values.month, values.day, values.hour, values.minute),
				)
			: new Date(now.getFullYear(), values.month, values.day, values.hour, values.minute);

	if (date <= now) {
		if (sourceTimeZone === "utc") {
			date.setUTCFullYear(date.getUTCFullYear() + 1);
		} else {
			date.setFullYear(date.getFullYear() + 1);
		}
	}
	return date.toISOString();
}

function normalizeResetText(resetText: string | null | undefined): string {
	return (resetText ?? "")
		.replace(/^resets\s+/i, "")
		.replace(/\([^)]*\)/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function parseMonth(monthName: string): number | null {
	return MONTHS.get(monthName.toLowerCase()) ?? null;
}

function parseHour(hourValue: string, meridiem: string | undefined): number {
	const hour = Number(hourValue);
	if (meridiem == null) {
		return hour;
	}

	const lower = meridiem.toLowerCase();
	if (lower === "am") {
		return hour === 12 ? 0 : hour;
	}
	if (lower === "pm") {
		return hour === 12 ? 12 : hour + 12;
	}
	return hour;
}

function emptyToNull(value: string | null | undefined): string | null {
	return value == null || value === "" ? null : value;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
