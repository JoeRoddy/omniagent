#!/usr/bin/env node
"use strict";

const { parseArgs, readTextFromFlags } = require("./lib/cli");
const { requireDate } = require("./lib/date");
const { dailyLogKey } = require("./lib/constants");
const { getJson, setJson } = require("./lib/redis");
const { createEmptyDailyLog, ensureDailyLog, appendNoteToLog } = require("./lib/logs");
const { printJson } = require("./lib/output");

function main() {
	const { flags, positionals } = parseArgs(process.argv.slice(2));
	const date = requireDate(positionals[0]);
	const note = readTextFromFlags(positionals, flags, 1, "note");
	if (!note) {
		throw new Error(
			"Usage: node scripts/append_note.js <date> --note \"...\" [--meal-id <id>] [--item-id <id>]",
		);
	}

	const key = dailyLogKey(date);
	const existing = getJson(key);
	const mealId = typeof flags["meal-id"] === "string" ? flags["meal-id"] : null;
	const itemId = typeof flags["item-id"] === "string" ? flags["item-id"] : null;

	if (!existing && (mealId || itemId)) {
		throw new Error("Daily log not found for meal/item note.");
	}

	const log = existing || createEmptyDailyLog(date);
	appendNoteToLog(log, note, { mealId, itemId });
	const updated = ensureDailyLog(log, date);
	setJson(key, updated);
	printJson(updated);
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
