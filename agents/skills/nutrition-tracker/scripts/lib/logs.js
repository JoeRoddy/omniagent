"use strict";

const { NUTRIENT_KEYS, TIMEZONE } = require("./constants");
const { generateUuid } = require("./uuid");

function nowIso() {
	return new Date().toISOString();
}

function coerceNumber(value, fallback = 0) {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return fallback;
}

function emptyNutrients() {
	const nutrients = {};
	for (const key of NUTRIENT_KEYS) {
		nutrients[key] = 0;
	}
	return nutrients;
}

function normalizeNutrients(input) {
	const nutrients = {};
	for (const key of NUTRIENT_KEYS) {
		nutrients[key] = coerceNumber(input ? input[key] : undefined, 0);
	}
	return nutrients;
}

function addNutrients(a, b) {
	const result = {};
	for (const key of NUTRIENT_KEYS) {
		result[key] = coerceNumber(a ? a[key] : undefined, 0) + coerceNumber(b ? b[key] : undefined, 0);
	}
	return result;
}

function scaleNutrients(nutrients, servings) {
	const base = normalizeNutrients(nutrients);
	const multiplier = coerceNumber(servings, 1);
	const scaled = {};
	for (const key of NUTRIENT_KEYS) {
		scaled[key] = base[key] * multiplier;
	}
	return scaled;
}

function ensureServing(serving) {
	if (!serving || typeof serving !== "object") {
		return { amount: 1, unit: "serving" };
	}
	return {
		amount: coerceNumber(serving.amount, 1),
		unit: typeof serving.unit === "string" && serving.unit ? serving.unit : "serving",
	};
}

function ensureItem(raw) {
	const item = { ...raw };
	item.id = item.id || generateUuid();
	item.name = item.name || "Unnamed item";
	item.brand = item.brand || "";
	item.serving = ensureServing(item.serving);
	item.servings = coerceNumber(item.servings, 1);
	item.nutrients = normalizeNutrients(item.nutrients);
	item.notes = item.notes || "";
	item.estimated = Boolean(item.estimated);
	return item;
}

function rollupMealTotals(meal) {
	let totals = emptyNutrients();
	for (const item of meal.items) {
		const scaled = scaleNutrients(item.nutrients, item.servings);
		totals = addNutrients(totals, scaled);
	}
	meal.totals = totals;
	return meal;
}

function ensureMeal(raw) {
	const meal = { ...raw };
	meal.id = meal.id || generateUuid();
	meal.name = meal.name || "Meal";
	meal.time = meal.time || "";
	meal.items = Array.isArray(meal.items) ? meal.items.map(ensureItem) : [];
	meal.notes = meal.notes || "";
	return rollupMealTotals(meal);
}

function rollupDailyTotals(log) {
	let totals = emptyNutrients();
	log.meals = log.meals.map(ensureMeal);
	for (const meal of log.meals) {
		totals = addNutrients(totals, meal.totals);
	}
	log.totals = totals;
	return log;
}

function createEmptyDailyLog(date) {
	const timestamp = nowIso();
	return {
		date,
		timezone: TIMEZONE,
		meals: [],
		notes: "",
		totals: emptyNutrients(),
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

function ensureDailyLog(raw, date) {
	const base = createEmptyDailyLog(date);
	const log = {
		...base,
		...raw,
		date,
		timezone: TIMEZONE,
	};

	log.meals = Array.isArray(log.meals) ? log.meals : [];
	log.notes = log.notes || "";
	log.createdAt = log.createdAt || base.createdAt;
	log.updatedAt = nowIso();

	return rollupDailyTotals(log);
}

function mergeDailyLog(existing, patch, date) {
	const merged = { ...existing, ...patch };
	if (patch && Array.isArray(patch.meals)) {
		merged.meals = patch.meals;
	}
	if (patch && Object.prototype.hasOwnProperty.call(patch, "notes")) {
		merged.notes = patch.notes;
	}
	return ensureDailyLog(merged, date);
}

function mergeMeal(existing, patch) {
	const merged = { ...existing, ...patch };
	if (patch && Array.isArray(patch.items)) {
		merged.items = patch.items;
	}
	return ensureMeal(merged);
}

function appendNote(existing, note) {
	if (!note) {
		return existing || "";
	}
	if (!existing) {
		return note;
	}
	return `${existing}\n${note}`;
}

function findMealIndex(log, mealId) {
	return log.meals.findIndex((meal) => meal.id === mealId);
}

function findItemLocation(log, itemId, mealId) {
	if (mealId) {
		const mealIndex = findMealIndex(log, mealId);
		if (mealIndex === -1) {
			return null;
		}
		const itemIndex = log.meals[mealIndex].items.findIndex((item) => item.id === itemId);
		if (itemIndex === -1) {
			return null;
		}
		return { mealIndex, itemIndex };
	}

	let match = null;
	for (let mealIndex = 0; mealIndex < log.meals.length; mealIndex += 1) {
		const itemIndex = log.meals[mealIndex].items.findIndex((item) => item.id === itemId);
		if (itemIndex !== -1) {
			if (match) {
				throw new Error("Item ID matched multiple meals. Provide --meal-id to disambiguate.");
			}
			match = { mealIndex, itemIndex };
		}
	}

	return match;
}

function appendNoteToLog(log, note, { mealId, itemId }) {
	if (itemId) {
		const location = findItemLocation(log, itemId, mealId);
		if (!location) {
			throw new Error("Item not found for note append.");
		}
		const { mealIndex, itemIndex } = location;
		const item = log.meals[mealIndex].items[itemIndex];
		item.notes = appendNote(item.notes, note);
		return log;
	}

	if (mealId) {
		const mealIndex = findMealIndex(log, mealId);
		if (mealIndex === -1) {
			throw new Error("Meal not found for note append.");
		}
		const meal = log.meals[mealIndex];
		meal.notes = appendNote(meal.notes, note);
		return log;
	}

	log.notes = appendNote(log.notes, note);
	return log;
}

module.exports = {
	createEmptyDailyLog,
	ensureDailyLog,
	mergeDailyLog,
	mergeMeal,
	appendNoteToLog,
	findMealIndex,
	rollupDailyTotals,
};
