#!/usr/bin/env node
"use strict";

const { requireDate } = require("./lib/date");
const { dailyLogKey } = require("./lib/constants");
const { getJson, setJson } = require("./lib/redis");
const { removeDateFromIndex } = require("./lib/index");
const { printJson } = require("./lib/output");

function main() {
	const date = requireDate(process.argv[2]);
	const key = dailyLogKey(date);
	const existing = getJson(key);
	if (!existing) {
		printJson({ deleted: false, date, reason: "not_found" });
		return;
	}

	setJson(key, null);
	removeDateFromIndex(date);
	printJson({ deleted: true, date });
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
