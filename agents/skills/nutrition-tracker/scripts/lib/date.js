"use strict";

const { DATE_REGEX } = require("./constants");

function requireDate(value) {
	if (!value || !DATE_REGEX.test(value)) {
		throw new Error("Date must be YYYY-MM-DD (America/New_York)");
	}
	return value;
}

module.exports = {
	requireDate,
};
