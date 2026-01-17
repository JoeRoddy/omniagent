"use strict";

const KEY_PREFIX = "fitness-skill:";
const DAILY_LOG_PREFIX = `${KEY_PREFIX}daily-logs:`;
const INDEX_KEY = `${KEY_PREFIX}daily-logs:index`;
const TIMEZONE = "EST";
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const NUTRIENT_KEYS = [
	"calories",
	"protein_g",
	"carbs_g",
	"fat_g",
	"sugar_g",
	"fiber_g",
	"sodium_mg",
];

function dailyLogKey(date) {
	return `${DAILY_LOG_PREFIX}${date}`;
}

module.exports = {
	KEY_PREFIX,
	DAILY_LOG_PREFIX,
	INDEX_KEY,
	TIMEZONE,
	DATE_REGEX,
	NUTRIENT_KEYS,
	dailyLogKey,
};
