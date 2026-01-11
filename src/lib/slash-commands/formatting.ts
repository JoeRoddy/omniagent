import type { FrontmatterValue, SlashCommandDefinition } from "./catalog.js";

function ensureTrailingNewline(value: string): string {
	return value.endsWith("\n") ? value : `${value}\n`;
}

function formatTomlString(value: string): string {
	return JSON.stringify(value);
}

function formatTomlValue(value: FrontmatterValue): string {
	if (Array.isArray(value)) {
		return `[${value.map((entry) => formatTomlString(entry)).join(", ")}]`;
	}
	return formatTomlString(value);
}

function formatYamlString(value: string): string {
	return JSON.stringify(value);
}

function renderYamlFrontmatter(
	frontmatter: Record<string, FrontmatterValue>,
	defaultName?: string,
): string | null {
	const entries = Object.entries(frontmatter);
	const hasName = Object.hasOwn(frontmatter, "name");
	const lines: string[] = ["---"];

	if (hasName) {
		const value = frontmatter.name;
		if (Array.isArray(value)) {
			lines.push("name:");
			for (const entry of value) {
				lines.push(`  - ${formatYamlString(entry)}`);
			}
		} else {
			lines.push(`name: ${formatYamlString(value)}`);
		}
	} else if (defaultName) {
		lines.push(`name: ${formatYamlString(defaultName)}`);
	}

	for (const [key, value] of entries) {
		if (key === "name") {
			continue;
		}
		if (Array.isArray(value)) {
			lines.push(`${key}:`);
			for (const entry of value) {
				lines.push(`  - ${formatYamlString(entry)}`);
			}
			continue;
		}
		lines.push(`${key}: ${formatYamlString(value)}`);
	}

	if (lines.length === 1) {
		return null;
	}
	lines.push("---", "");
	return lines.join("\n");
}

const GEMINI_RESERVED_KEYS = new Set(["prompt", "targets", "targetagents"]);

export function renderClaudeCommand(command: SlashCommandDefinition): string {
	const prompt = command.prompt.trimEnd();
	return ensureTrailingNewline(prompt);
}

export function renderGeminiCommand(command: SlashCommandDefinition): string {
	const lines: string[] = [];
	for (const [key, value] of Object.entries(command.frontmatter)) {
		const normalizedKey = key.trim();
		if (!normalizedKey) {
			continue;
		}
		if (GEMINI_RESERVED_KEYS.has(normalizedKey.toLowerCase())) {
			continue;
		}
		lines.push(`${normalizedKey} = ${formatTomlValue(value)}`);
	}
	lines.push(`prompt = ${formatTomlString(command.prompt)}`);
	return ensureTrailingNewline(lines.join("\n"));
}

export function renderCodexPrompt(command: SlashCommandDefinition): string {
	const prompt = command.prompt.trimEnd();
	return ensureTrailingNewline(prompt);
}

export function renderSkillFromCommand(command: SlashCommandDefinition): string {
	const headerLines = [`# ${command.name}`];
	const prompt = command.prompt.trim();
	const body = `${headerLines.join("\n")}\n\n${prompt}`;
	const frontmatter = renderYamlFrontmatter(command.frontmatter, command.name);
	if (frontmatter) {
		return ensureTrailingNewline(`${frontmatter}${body}`);
	}
	return ensureTrailingNewline(body);
}
