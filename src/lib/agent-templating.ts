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

const OPEN_TAG = "<agents ";
const CLOSE_TAG = "</agents>";

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
		const openIndex = content.indexOf(OPEN_TAG, index);
		if (openIndex === -1) {
			if (target) {
				output += content.slice(index);
			}
			break;
		}

		if (target) {
			output += content.slice(index, openIndex);
		}

		const selectorStart = openIndex + OPEN_TAG.length;
		const selectorEnd = content.indexOf(">", selectorStart);
		if (selectorEnd === -1) {
			throw createTemplatingError("Unterminated selector block", context);
		}

		const selectorRaw = content.slice(selectorStart, selectorEnd);
		if (!selectorRaw.trim()) {
			throw createTemplatingError("Selector list cannot be empty", context);
		}

		const contentStart = selectorEnd + 1;
		if (content.startsWith(CLOSE_TAG, contentStart)) {
			throw createTemplatingError(
				`Selector block "${OPEN_TAG}${selectorRaw}>" is missing content`,
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

		let cursor = contentStart;
		let blockOutput = "";

		while (cursor < content.length) {
			if (content[cursor] === "\\" && content.startsWith(CLOSE_TAG, cursor + 1)) {
				if (target && shouldInclude) {
					blockOutput += CLOSE_TAG;
				}
				cursor += 1 + CLOSE_TAG.length;
				continue;
			}

			if (content.startsWith(OPEN_TAG, cursor)) {
				throw createTemplatingError(
					`Nested selector block detected inside "${OPEN_TAG}${selectorRaw}> ... ${CLOSE_TAG}"`,
					context,
				);
			}

			if (content.startsWith(CLOSE_TAG, cursor)) {
				break;
			}

			if (target && shouldInclude) {
				blockOutput += content[cursor];
			}
			cursor += 1;
		}

		if (cursor >= content.length) {
			throw createTemplatingError(
				`Unterminated selector block "${OPEN_TAG}${selectorRaw}>"`,
				context,
			);
		}

		if (target && shouldInclude) {
			output += blockOutput;
		}

		index = cursor + CLOSE_TAG.length;
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
