"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function resolveRedisSkillPath() {
	if (process.env.REDIS_SKILL_PATH) {
		return path.resolve(process.env.REDIS_SKILL_PATH);
	}

	if (process.env.CODEX_HOME) {
		const candidate = path.join(process.env.CODEX_HOME, "skills", "redis");
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}

	const defaultPath = path.join(os.homedir(), ".codex", "skills", "redis");
	if (fs.existsSync(defaultPath)) {
		return defaultPath;
	}

	throw new Error(
		"Redis skill not found. Set REDIS_SKILL_PATH or CODEX_HOME to locate ~/.codex/skills/redis.",
	);
}

function runRedisScript(scriptName, args) {
	const redisSkillPath = resolveRedisSkillPath();
	const scriptPath = path.join(redisSkillPath, "scripts", scriptName);

	if (!fs.existsSync(scriptPath)) {
		throw new Error(`Missing redis script: ${scriptPath}`);
	}

	try {
		return execFileSync("node", [scriptPath, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		const stderr = error && error.stderr ? error.stderr.toString("utf8").trim() : "";
		const stdout = error && error.stdout ? error.stdout.toString("utf8").trim() : "";
		const details = stderr || stdout;
		throw new Error(details || "Redis script failed.");
	}
}

function parseRedisOutput(raw) {
	const trimmed = raw.trim();
	if (!trimmed) {
		return null;
	}
	try {
		return JSON.parse(trimmed);
	} catch (error) {
		return trimmed;
	}
}

function getKey(key) {
	const output = runRedisScript("get_redis_key.js", [key]);
	return parseRedisOutput(output);
}

function setKey(key, value) {
	const output = runRedisScript("set_redis_key.js", [key, value]);
	return parseRedisOutput(output);
}

function parseStoredJson(payload) {
	if (payload === null || payload === undefined) {
		return null;
	}
	if (typeof payload === "string") {
		const trimmed = payload.trim();
		if (!trimmed || trimmed === "null") {
			return null;
		}
		try {
			return JSON.parse(trimmed);
		} catch (error) {
			return payload;
		}
	}
	return payload;
}

function getJson(key) {
	const payload = getKey(key);
	if (payload && typeof payload === "object" && "result" in payload) {
		return parseStoredJson(payload.result);
	}
	return parseStoredJson(payload);
}

function setJson(key, value) {
	const raw = JSON.stringify(value);
	return setKey(key, raw);
}

module.exports = {
	getJson,
	setJson,
};
