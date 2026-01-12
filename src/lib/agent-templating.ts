export type AgentTemplatingOptions = {
	content: string;
	target: string;
	validAgents: string[];
	sourcePath?: string;
};

export type AgentTemplatingValidationOptions = {
	content: string;
	validAgents: string[];
	sourcePath?: string;
};

export class AgentTemplatingError extends Error {
	readonly sourcePath?: string;
	readonly validAgents: string[];

	constructor(message: string, options: { sourcePath?: string; validAgents: string[] }) {
		super(message);
		this.name = "AgentTemplatingError";
		this.sourcePath = options.sourcePath;
		this.validAgents = options.validAgents;
	}
}

type SelectorSets = {
	include: Set<string>;
	exclude: Set<string>;
	raw: string;
};

function normalizeAgentList(validAgents: string[]): string[] {
	const normalized: string[] = [];
	const seen = new Set<string>();

	for (const agent of validAgents) {
		const value = agent.trim().toLowerCase();
		if (!value || seen.has(value)) {
			continue;
		}
		seen.add(value);
		normalized.push(value);
	}

	return normalized;
}

function formatValidAgents(validAgents: string[]): string {
	if (validAgents.length === 0) {
		return "none";
	}
	return validAgents.join(", ");
}

function createTemplatingError(
	message: string,
	options: { sourcePath?: string; validAgents: string[] },
): AgentTemplatingError {
	const location = options.sourcePath ? ` in ${options.sourcePath}` : "";
	const validList = formatValidAgents(options.validAgents);
	return new AgentTemplatingError(
		`Agent templating error${location}: ${message}. Valid agents: ${validList}.`,
		options,
	);
}

function parseSelectorList(
	raw: string,
	validSet: Set<string>,
	options: { sourcePath?: string; validAgents: string[] },
): SelectorSets {
	const trimmed = raw.trim();
	if (!trimmed) {
		throw createTemplatingError("Selector list cannot be empty", options);
	}

	const excludeOnly = trimmed.toLowerCase().startsWith("not:");
	const include = new Set<string>();
	const exclude = new Set<string>();
	const entries = raw.split(",");

	for (const entry of entries) {
		const token = entry.trim();
		if (!token) {
			throw createTemplatingError("Selector list contains an empty entry", options);
		}

		const lower = token.toLowerCase();
		const hasNotPrefix = lower.startsWith("not:");
		const agentToken = hasNotPrefix ? token.slice(4).trim() : token;
		if (!agentToken) {
			throw createTemplatingError("Selector list contains an empty not: entry", options);
		}
		const normalized = agentToken.toLowerCase();
		if (!validSet.has(normalized)) {
			throw createTemplatingError(`Unknown agent selector "${agentToken}"`, options);
		}
		if (excludeOnly || hasNotPrefix) {
			exclude.add(normalized);
		} else {
			include.add(normalized);
		}
	}

	for (const agent of include) {
		if (exclude.has(agent)) {
			throw createTemplatingError(`Selector list includes and excludes "${agent}"`, options);
		}
	}

	return { include, exclude, raw };
}

function isWhitespace(value: string): boolean {
	return value === " " || value === "\t" || value === "\n" || value === "\r";
}

function processTemplating(
	content: string,
	options: {
		target?: string | null;
		validAgents: string[];
		sourcePath?: string;
	},
): string {
	const normalizedValid = normalizeAgentList(options.validAgents);
	const validSet = new Set(normalizedValid);
	const context = { sourcePath: options.sourcePath, validAgents: normalizedValid };
	const target = options.target ? options.target.toLowerCase() : null;

	let output = "";
	let index = 0;

	while (index < content.length) {
		const char = content[index];
		if (char !== "{") {
			if (target) {
				output += char;
			}
			index += 1;
			continue;
		}

		const selectorStart = index + 1;
		if (selectorStart >= content.length) {
			throw createTemplatingError("Unterminated selector block", context);
		}

		let selectorEnd = selectorStart;
		while (
			selectorEnd < content.length &&
			!isWhitespace(content[selectorEnd]) &&
			content[selectorEnd] !== "}"
		) {
			selectorEnd += 1;
		}

		const selectorRaw = content.slice(selectorStart, selectorEnd);
		if (!selectorRaw.trim()) {
			throw createTemplatingError("Selector list cannot be empty", context);
		}

		if (selectorEnd >= content.length) {
			throw createTemplatingError(`Unterminated selector block "{${selectorRaw}"`, context);
		}

		if (content[selectorEnd] === "}") {
			throw createTemplatingError(
				`Selector block "{${selectorRaw}}" is missing content`,
				context,
			);
		}

		const { include, exclude } = parseSelectorList(selectorRaw, validSet, context);
		const shouldInclude =
			target === null
				? false
				: include.size > 0
					? include.has(target) && !exclude.has(target)
					: !exclude.has(target);

		let cursor = selectorEnd;
		let blockOutput = "";

		while (cursor < content.length) {
			const current = content[cursor];
			if (current === "\\") {
				const next = content[cursor + 1];
				if (next === "}") {
					if (target && shouldInclude) {
						blockOutput += "}";
					}
					cursor += 2;
					continue;
				}
				if (target && shouldInclude) {
					blockOutput += current;
				}
				cursor += 1;
				continue;
			}

			if (current === "{") {
				throw createTemplatingError(
					`Nested selector block detected inside "{${selectorRaw} ... }"`,
					context,
				);
			}

			if (current === "}") {
				break;
			}

			if (target && shouldInclude) {
				blockOutput += current;
			}
			cursor += 1;
		}

		if (cursor >= content.length) {
			throw createTemplatingError(`Unterminated selector block "{${selectorRaw}"`, context);
		}

		if (target && shouldInclude) {
			output += blockOutput;
		}

		index = cursor + 1;
	}

	if (!target) {
		return content;
	}

	return output;
}

export function validateAgentTemplating(options: AgentTemplatingValidationOptions): void {
	processTemplating(options.content, {
		validAgents: options.validAgents,
		sourcePath: options.sourcePath,
	});
}

export function applyAgentTemplating(options: AgentTemplatingOptions): string {
	return processTemplating(options.content, {
		target: options.target,
		validAgents: options.validAgents,
		sourcePath: options.sourcePath,
	});
}
