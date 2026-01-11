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
	const lines: string[] = ["---"];

	let explicitName: FrontmatterValue | undefined;
	let explicitDescription: FrontmatterValue | undefined;
	const remaining: Array<[string, FrontmatterValue]> = [];

	for (const [key, value] of entries) {
		const normalizedKey = key.toLowerCase();
		if (normalizedKey === "name" && explicitName === undefined) {
			explicitName = value;
			continue;
		}
		if (normalizedKey === "description" && explicitDescription === undefined) {
			explicitDescription = value;
			continue;
		}
		remaining.push([key, value]);
	}

	const nameValue = explicitName ?? (defaultName ? defaultName : undefined);
	if (nameValue !== undefined) {
		if (Array.isArray(nameValue)) {
			lines.push("name:");
			for (const entry of nameValue) {
				lines.push(`  - ${formatYamlString(entry)}`);
			}
		} else {
			lines.push(`name: ${formatYamlString(nameValue)}`);
		}
	}

	if (explicitDescription !== undefined) {
		if (Array.isArray(explicitDescription)) {
			lines.push("description:");
			for (const entry of explicitDescription) {
				lines.push(`  - ${formatYamlString(entry)}`);
			}
		} else {
			lines.push(`description: ${formatYamlString(explicitDescription)}`);
		}
	}

	for (const [key, value] of remaining) {
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
	return command.rawContents;
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
	return command.rawContents;
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
