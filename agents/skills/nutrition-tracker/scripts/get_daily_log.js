#!/usr/bin/env node
"use strict";

const { requireDate } = require("./lib/date");
const { dailyLogKey } = require("./lib/constants");
const { getJson } = require("./lib/redis");
const { printJson } = require("./lib/output");

function main() {
	const date = requireDate(process.argv[2]);
	const key = dailyLogKey(date);
	const log = getJson(key);
	printJson(log);
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
