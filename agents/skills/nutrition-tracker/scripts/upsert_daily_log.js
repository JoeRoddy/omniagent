#!/usr/bin/env node
"use strict";

const { parseArgs, readJsonFromFlags } = require("./lib/cli");
const { requireDate } = require("./lib/date");
const { dailyLogKey } = require("./lib/constants");
const { getJson, setJson } = require("./lib/redis");
const { addDateToIndex } = require("./lib/index");
const { createEmptyDailyLog, mergeDailyLog } = require("./lib/logs");
const { printJson } = require("./lib/output");

function main() {
	const { flags, positionals } = parseArgs(process.argv.slice(2));
	const date = requireDate(positionals[0]);
	const patch = readJsonFromFlags(flags, { required: true });
	const key = dailyLogKey(date);
	const existing = getJson(key) || createEmptyDailyLog(date);
	const merged = mergeDailyLog(existing, patch, date);
	setJson(key, merged);
	addDateToIndex(date);
	printJson(merged);
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
