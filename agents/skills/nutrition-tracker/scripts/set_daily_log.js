#!/usr/bin/env node
"use strict";

const { parseArgs, readJsonFromFlags } = require("./lib/cli");
const { requireDate } = require("./lib/date");
const { dailyLogKey } = require("./lib/constants");
const { setJson } = require("./lib/redis");
const { addDateToIndex } = require("./lib/index");
const { ensureDailyLog } = require("./lib/logs");
const { printJson } = require("./lib/output");

function main() {
	const { flags, positionals } = parseArgs(process.argv.slice(2));
	const date = requireDate(positionals[0]);
	const input = readJsonFromFlags(flags, { required: true });
	const log = ensureDailyLog(input, date);
	setJson(dailyLogKey(date), log);
	addDateToIndex(date);
	printJson(log);
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
