#!/usr/bin/env node
"use strict";

const { requireDate } = require("./lib/date");
const { dailyLogKey } = require("./lib/constants");
const { getJson, setJson } = require("./lib/redis");
const { ensureDailyLog } = require("./lib/logs");
const { printJson } = require("./lib/output");

function main() {
	const date = requireDate(process.argv[2]);
	const key = dailyLogKey(date);
	const log = getJson(key);
	if (!log) {
		throw new Error("Daily log not found.");
	}
	const updated = ensureDailyLog(log, date);
	setJson(key, updated);
	printJson({ date, totals: updated.totals, log: updated });
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
