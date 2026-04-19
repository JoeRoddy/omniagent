import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveAgentsDirRelativePath } from "./agents-dir.js";

export const LOCAL_OVERRIDE_IGNORE_RULES = [
	"**/*.local/",
	"**/*.local.md",
	"**/*.local.json",
] as const;

export type IgnoreRuleStatus = {
	ignoreFilePath: string;
	missingRules: string[];
};

type IgnoreRuleOptions = {
	agentsDir?: string | null;
	rules?: string[];
};

export function buildAgentsIgnoreRules(repoRoot: string, agentsDir?: string | null): string[] {
	const relativeAgentsDir = resolveAgentsDirRelativePath(repoRoot, agentsDir);
	if (relativeAgentsDir === null) {
		return [...LOCAL_OVERRIDE_IGNORE_RULES];
	}
	const localRootRule = relativeAgentsDir ? `${relativeAgentsDir}/.local/` : ".local/";
	return [localRootRule, ...LOCAL_OVERRIDE_IGNORE_RULES];
}

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
	options: IgnoreRuleOptions = {},
): Promise<IgnoreRuleStatus> {
	const rules = options.rules ?? buildAgentsIgnoreRules(repoRoot, options.agentsDir);
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
	options: IgnoreRuleOptions = {},
): Promise<IgnoreRuleStatus> {
	const rules = options.rules ?? buildAgentsIgnoreRules(repoRoot, options.agentsDir);
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
