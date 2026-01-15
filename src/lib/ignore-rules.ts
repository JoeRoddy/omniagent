import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_IGNORE_RULES = ["agents/.local/", "**/*.local.md"] as const;

export type IgnoreRuleStatus = {
	ignoreFilePath: string;
	missingRules: string[];
};

function normalizeRule(rule: string): string {
	return rule.trim();
}

function normalizeForMatch(value: string): string {
	return value.replace(/\/+$/, "").trim();
}

function parseIgnoreLines(contents: string): string[] {
	return contents
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"));
}

function hasRule(lines: string[], rule: string): boolean {
	const normalizedRule = normalizeForMatch(rule);
	return lines.some((line) => normalizeForMatch(line) === normalizedRule);
}

export async function getIgnoreRuleStatus(
	repoRoot: string,
	rules: string[] = [...DEFAULT_IGNORE_RULES],
): Promise<IgnoreRuleStatus> {
	const ignoreFilePath = path.join(repoRoot, ".gitignore");
	let contents = "";
	try {
		contents = await readFile(ignoreFilePath, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") {
			throw error;
		}
	}

	const lines = parseIgnoreLines(contents);
	const missingRules = rules
		.map((rule) => normalizeRule(rule))
		.filter((rule) => rule.length > 0 && !hasRule(lines, rule));

	return {
		ignoreFilePath,
		missingRules,
	};
}

export async function appendIgnoreRules(
	repoRoot: string,
	rules: string[] = [...DEFAULT_IGNORE_RULES],
): Promise<IgnoreRuleStatus> {
	const ignoreFilePath = path.join(repoRoot, ".gitignore");
	let contents = "";
	try {
		contents = await readFile(ignoreFilePath, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") {
			throw error;
		}
	}

	const lines = parseIgnoreLines(contents);
	const missingRules = rules
		.map((rule) => normalizeRule(rule))
		.filter((rule) => rule.length > 0 && !hasRule(lines, rule));

	if (missingRules.length === 0) {
		return { ignoreFilePath, missingRules };
	}

	const trimmed = contents.trimEnd();
	const appendLines = [
		trimmed.length > 0 ? "" : null,
		"# omniagent local overrides",
		...missingRules,
	].filter((line): line is string => line !== null);

	const nextContents =
		trimmed.length > 0 ? `${trimmed}\n${appendLines.join("\n")}\n` : `${appendLines.join("\n")}\n`;
	await writeFile(ignoreFilePath, nextContents, "utf8");

	return {
		ignoreFilePath,
		missingRules: [],
	};
}
