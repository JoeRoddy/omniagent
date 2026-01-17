"use strict";

const { INDEX_KEY } = require("./constants");
const { getJson, setJson } = require("./redis");

function getIndex() {
	const data = getJson(INDEX_KEY);
	return Array.isArray(data) ? data : [];
}

function saveIndex(list) {
	setJson(INDEX_KEY, list);
	return list;
}

function addDateToIndex(date) {
	const index = getIndex();
	if (!index.includes(date)) {
		index.push(date);
		index.sort();
		saveIndex(index);
	}
	return index;
}

function removeDateFromIndex(date) {
	const next = getIndex().filter((entry) => entry !== date);
	saveIndex(next);
	return next;
}

module.exports = {
	getIndex,
	addDateToIndex,
	removeDateFromIndex,
};
