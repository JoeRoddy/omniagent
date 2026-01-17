"use strict";

const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
	const flags = {};
	const positionals = [];

	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (token.startsWith("--")) {
			const name = token.slice(2);
			const next = argv[i + 1];
			if (next && !next.startsWith("--")) {
				flags[name] = next;
				i += 1;
			} else {
				flags[name] = true;
			}
			continue;
		}
		positionals.push(token);
	}

	return { flags, positionals };
}

function readJsonFromFlags(flags, { required = true } = {}) {
	if (flags.file) {
		const filePath = path.resolve(flags.file);
		if (!fs.existsSync(filePath)) {
			throw new Error(`JSON file not found: ${filePath}`);
		}
		const raw = fs.readFileSync(filePath, "utf8");
		return JSON.parse(raw);
	}

	if (flags.json) {
		return JSON.parse(flags.json);
	}

	if (required) {
		throw new Error("Provide --file <path> or --json '<payload>'");
	}

	return null;
}

function readTextFromFlags(positionals, flags, startIndex, flagName) {
	const flagged = flags[flagName];
	if (typeof flagged === "string") {
		return flagged;
	}
	const remaining = positionals.slice(startIndex);
	if (remaining.length === 0) {
		return "";
	}
	return remaining.join(" ");
}

module.exports = {
	parseArgs,
	readJsonFromFlags,
	readTextFromFlags,
};
