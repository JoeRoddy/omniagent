const PREVIOUS_OUTPUT_LIMIT = 4000;

const RESPONSE_RULES =
	"Respond with only the JSON value - no explanations, no markdown code fences, no additional text.";

function schemaBlock(schemaJson: string): string {
	return `Your entire response must be a single JSON value that conforms to this JSON Schema:\n${schemaJson}`;
}

function truncate(text: string, limit: number): string {
	if (text.length <= limit) {
		return text;
	}
	return `${text.slice(0, limit)}\n[truncated]`;
}

export function buildFallbackPrompt(prompt: string, schemaJson: string): string {
	const base = prompt.trim().length > 0 ? `${prompt}\n\n` : "";
	return `${base}${schemaBlock(schemaJson)}\n\n${RESPONSE_RULES}`;
}

export function buildRetryPrompt(
	prompt: string,
	schemaJson: string,
	previousOutput: string,
	errors: string[],
): string {
	const base = prompt.trim().length > 0 ? `${prompt}\n\n` : "";
	const previous =
		previousOutput.trim().length > 0
			? truncate(previousOutput.trim(), PREVIOUS_OUTPUT_LIMIT)
			: "(empty response)";
	const errorLines = errors.map((error) => `- ${error}`).join("\n");
	return [
		`${base}${schemaBlock(schemaJson)}`,
		`Your previous response failed validation.\n\nPrevious response:\n${previous}`,
		`Validation errors:\n${errorLines}`,
		`Respond again with only the corrected JSON value. ${RESPONSE_RULES}`,
	].join("\n\n");
}

export type ExtractedJsonPayload = { ok: true; value: unknown } | { ok: false; error: string };

function tryParse(text: string): { ok: true; value: unknown } | null {
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch {
		return null;
	}
}

export function extractJsonPayload(text: string): ExtractedJsonPayload {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		return { ok: false, error: "the response was empty" };
	}

	const whole = tryParse(trimmed);
	if (whole) {
		return whole;
	}

	const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
	if (fenced?.[1]) {
		const parsed = tryParse(fenced[1].trim());
		if (parsed) {
			return parsed;
		}
	}

	for (const [open, close] of [
		["{", "}"],
		["[", "]"],
	] as const) {
		const start = trimmed.indexOf(open);
		const end = trimmed.lastIndexOf(close);
		if (start !== -1 && end > start) {
			const parsed = tryParse(trimmed.slice(start, end + 1));
			if (parsed) {
				return parsed;
			}
		}
	}

	return { ok: false, error: "the response did not contain parseable JSON" };
}
