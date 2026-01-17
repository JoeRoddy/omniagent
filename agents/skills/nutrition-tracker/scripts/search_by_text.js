#!/usr/bin/env node
"use strict";

const { parseArgs } = require("./lib/cli");
const { dailyLogKey } = require("./lib/constants");
const { getIndex } = require("./lib/index");
const { getJson } = require("./lib/redis");
const { printJson } = require("./lib/output");

function includesText(text, needle) {
	return typeof text === "string" && text.toLowerCase().includes(needle);
}

function collectMatches(log, date, needle) {
	const matches = [];

	if (includesText(log.notes, needle)) {
		matches.push({
			date,
			scope: "daily",
			field: "notes",
			text: log.notes,
		});
	}

	for (const meal of log.meals || []) {
		if (includesText(meal.name, needle)) {
			matches.push({
				date,
				scope: "meal",
				mealId: meal.id,
				field: "name",
				text: meal.name,
			});
		}
		if (includesText(meal.notes, needle)) {
			matches.push({
				date,
				scope: "meal",
				mealId: meal.id,
				field: "notes",
				text: meal.notes,
			});
		}
		for (const item of meal.items || []) {
			if (includesText(item.name, needle)) {
				matches.push({
					date,
					scope: "item",
					mealId: meal.id,
					itemId: item.id,
					field: "name",
					text: item.name,
				});
			}
			if (includesText(item.brand, needle)) {
				matches.push({
					date,
					scope: "item",
					mealId: meal.id,
					itemId: item.id,
					field: "brand",
					text: item.brand,
				});
			}
			if (includesText(item.notes, needle)) {
				matches.push({
					date,
					scope: "item",
					mealId: meal.id,
					itemId: item.id,
					field: "notes",
					text: item.notes,
				});
			}
		}
	}

	return matches;
}

function main() {
	const { flags, positionals } = parseArgs(process.argv.slice(2));
	const query = positionals.join(" ").trim();
	if (!query) {
		throw new Error("Usage: node scripts/search_by_text.js <query> [--limit N]");
	}

	const limit = flags.limit ? Number(flags.limit) : null;
	const needle = query.toLowerCase();
	const days = getIndex();
	const matches = [];

	for (const date of days) {
		const log = getJson(dailyLogKey(date));
		if (!log) {
			continue;
		}
		const next = collectMatches(log, date, needle);
		for (const match of next) {
			matches.push(match);
			if (limit && matches.length >= limit) {
				printJson({ query, matches });
				return;
			}
		}
	}

	printJson({ query, matches });
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
