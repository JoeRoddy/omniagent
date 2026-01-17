#!/usr/bin/env node
"use strict";

const { parseArgs, readJsonFromFlags } = require("./lib/cli");
const { requireDate } = require("./lib/date");
const { dailyLogKey } = require("./lib/constants");
const { getJson, setJson } = require("./lib/redis");
const { ensureDailyLog, mergeMeal, findMealIndex } = require("./lib/logs");
const { printJson } = require("./lib/output");

function main() {
	const { flags, positionals } = parseArgs(process.argv.slice(2));
	const date = requireDate(positionals[0]);
	const mealId = positionals[1];
	if (!mealId) {
		throw new Error("Usage: node scripts/update_meal.js <date> <meal-id> --file <path>|--json '<meal>'");
	}
	const patch = readJsonFromFlags(flags, { required: true });
	const key = dailyLogKey(date);
	const log = getJson(key);
	if (!log) {
		throw new Error("Daily log not found.");
	}

	const mealIndex = findMealIndex(log, mealId);
	if (mealIndex === -1) {
		throw new Error("Meal not found.");
	}

	const merged = mergeMeal(log.meals[mealIndex], patch);
	log.meals[mealIndex] = merged;

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
