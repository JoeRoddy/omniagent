#!/usr/bin/env node
"use strict";

const { requireDate } = require("./lib/date");
const { dailyLogKey } = require("./lib/constants");
const { getJson, setJson } = require("./lib/redis");
const { ensureDailyLog, findMealIndex } = require("./lib/logs");
const { printJson } = require("./lib/output");

function main() {
	const date = requireDate(process.argv[2]);
	const mealId = process.argv[3];
	if (!mealId) {
		throw new Error("Usage: node scripts/remove_meal.js <date> <meal-id>");
	}
	const key = dailyLogKey(date);
	const log = getJson(key);
	if (!log) {
		throw new Error("Daily log not found.");
	}

	const mealIndex = findMealIndex(log, mealId);
	if (mealIndex === -1) {
		throw new Error("Meal not found.");
	}

	log.meals.splice(mealIndex, 1);
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
