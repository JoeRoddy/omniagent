import type {
	ConverterDecision,
	ConverterRef,
	ConverterRule,
	GeneratedOutput,
} from "./config-types.js";

export type ConverterRegistry = Map<string, ConverterRule>;

export function resolveConverter(
	ref: ConverterRef | undefined,
	registry: ConverterRegistry,
): ConverterRule | null {
	if (!ref) {
		return null;
	}
	if ("convert" in ref && typeof ref.convert === "function") {
		return ref;
	}
	if ("id" in ref && ref.id) {
		return registry.get(ref.id) ?? null;
	}
	return null;
}

export type NormalizedConverterResult = {
	outputs: GeneratedOutput[];
	skip: boolean;
	error?: string;
};

export function normalizeConverterDecision(decision: ConverterDecision): NormalizedConverterResult {
	if ("error" in decision) {
		return { outputs: [], skip: false, error: decision.error };
	}
	if ("skip" in decision) {
		return { outputs: [], skip: true };
	}
	if ("outputs" in decision) {
		return { outputs: decision.outputs, skip: false };
	}
	return { outputs: [decision.output], skip: false };
}
