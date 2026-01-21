import type { ConvertOutput, ConvertResult } from "./types.js";

export type NormalizedConvertResult =
	| { kind: "outputs"; outputs: ConvertOutput[] }
	| { kind: "skip"; reason?: string }
	| { kind: "satisfy"; reason?: string }
	| { kind: "error"; message: string };

function isOutput(value: unknown): value is ConvertOutput {
	return (
		Boolean(value) &&
		typeof value === "object" &&
		"path" in value &&
		"content" in value &&
		typeof (value as ConvertOutput).path === "string" &&
		typeof (value as ConvertOutput).content === "string"
	);
}

export function normalizeConvertResult(options: {
	result: ConvertResult;
	defaultPath?: string | null;
}): NormalizedConvertResult {
	const result = options.result;
	if (result === null || result === undefined) {
		return { kind: "skip" };
	}
	if (typeof result === "string") {
		if (!options.defaultPath) {
			return {
				kind: "error",
				message: "Converter returned content but no default path was available.",
			};
		}
		return {
			kind: "outputs",
			outputs: [{ path: options.defaultPath, content: result }],
		};
	}
	if (Array.isArray(result)) {
		const outputs = result.filter(isOutput);
		if (outputs.length !== result.length) {
			return { kind: "error", message: "Converter returned invalid output entries." };
		}
		return { kind: "outputs", outputs };
	}
	if (typeof result === "object") {
		if ("skip" in result && result.skip) {
			return { kind: "skip", reason: result.reason };
		}
		if ("satisfy" in result && result.satisfy) {
			return { kind: "satisfy", reason: result.reason };
		}
		if ("error" in result && typeof result.error === "string") {
			return { kind: "error", message: result.error };
		}
		if (isOutput(result)) {
			return { kind: "outputs", outputs: [result] };
		}
	}
	return { kind: "error", message: "Converter returned an unsupported result." };
}
