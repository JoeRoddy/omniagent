#!/usr/bin/env node
"use strict";

const { getIndex } = require("./lib/index");
const { printJson } = require("./lib/output");

function main() {
	const index = getIndex();
	printJson(index);
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
