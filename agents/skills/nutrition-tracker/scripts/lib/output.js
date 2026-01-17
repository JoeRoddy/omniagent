"use strict";

function printJson(value) {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printText(value) {
	process.stdout.write(`${value}\n`);
}

module.exports = {
	printJson,
	printText,
};
