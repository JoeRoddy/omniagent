"use strict";

const path = require("node:path");
const { execFileSync } = require("node:child_process");

const UUID_SCRIPT = path.resolve(__dirname, "..", "generate_uuid.js");

function generateUuid() {
	try {
		const output = execFileSync("node", [UUID_SCRIPT], { encoding: "utf8" });
		return output.trim();
	} catch (error) {
		throw new Error("Failed to generate UUID.");
	}
}

module.exports = {
	generateUuid,
};
