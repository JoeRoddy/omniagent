#!/usr/bin/env node
"use strict";

const { parseArgs, readJsonFromFlags } = require("./lib/cli");
const { requireDate } = require("./lib/date");
const { dailyLogKey } = require("./lib/constants");
const { getJson, setJson } = require("./lib/redis");
const { addDateToIndex } = require("./lib/index");
const { createEmptyDailyLog, ensureDailyLog } = require("./lib/logs");
const { printJson } = require("./lib/output");

function main() {
	const { flags, positionals } = parseArgs(process.argv.slice(2));
	const date = requireDate(positionals[0]);
	const meal = readJsonFromFlags(flags, { required: true });
	const key = dailyLogKey(date);
	const log = getJson(key) || createEmptyDailyLog(date);

	log.meals = Array.isArray(log.meals) ? log.meals : [];
	log.meals.push(meal);

	const updated = ensureDailyLog(log, date);
	setJson(key, updated);
	addDateToIndex(date);
	printJson(updated);
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
