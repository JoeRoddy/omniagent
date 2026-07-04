import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
	InvocationMode,
	StructuredOutputCapture,
	StructuredOutputPlan,
	StructuredOutputSpec,
} from "../../lib/targets/config-types.js";
import { InvalidUsageError } from "./errors.js";

const SCHEMA_LABEL = "--output-schema";

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSchemaJson(text: string, sourceLabel: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new InvalidUsageError(`Invalid value for ${SCHEMA_LABEL}: ${sourceLabel}.`);
	}
	if (!isPlainObject(parsed)) {
		throw new InvalidUsageError(`Invalid value for ${SCHEMA_LABEL}: schema must be a JSON object.`);
	}
	return JSON.stringify(parsed);
}

export async function resolveOutputSchema(raw: string): Promise<string> {
	const trimmed = raw.trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		return parseSchemaJson(trimmed, "schema is not valid JSON");
	}
	let contents: string;
	try {
		contents = await readFile(trimmed, "utf8");
	} catch {
		throw new InvalidUsageError(
			`Invalid value for ${SCHEMA_LABEL}: cannot read schema file ${trimmed}.`,
		);
	}
	return parseSchemaJson(contents, `schema file ${trimmed} is not valid JSON`);
}

export type PlanStructuredOutputOptions = {
	rawSchema: string | null;
	mode: InvocationMode;
	agentId: string;
	spec: StructuredOutputSpec | undefined;
	tempDir?: string;
};

export async function planStructuredOutput(
	options: PlanStructuredOutputOptions,
): Promise<StructuredOutputPlan | null> {
	const { rawSchema, mode, agentId, spec } = options;
	if (rawSchema === null) {
		return null;
	}
	if (!spec) {
		throw new InvalidUsageError(`${agentId} does not support ${SCHEMA_LABEL}.`);
	}
	if (mode !== "one-shot") {
		throw new InvalidUsageError(
			`${SCHEMA_LABEL} requires one-shot mode; provide -p/--prompt or pipe stdin.`,
		);
	}

	const schemaJson = await resolveOutputSchema(rawSchema);

	const needsTempDir = spec.delivery === "file" || spec.extraction.type === "last-message-file";
	const tempPaths: string[] = [];
	let tempDirPath: string | null = null;
	if (needsTempDir) {
		tempDirPath = await mkdtemp(path.join(options.tempDir ?? os.tmpdir(), "omniagent-schema-"));
		tempPaths.push(tempDirPath);
	}

	let deliveryValue = schemaJson;
	if (spec.delivery === "file" && tempDirPath) {
		deliveryValue = path.join(tempDirPath, "schema.json");
		await writeFile(deliveryValue, schemaJson, "utf8");
	}

	const args = [...spec.flag, deliveryValue, ...(spec.companionArgs ?? [])];

	let capture: StructuredOutputCapture;
	if (spec.extraction.type === "json-envelope") {
		capture = { type: "json-envelope", field: spec.extraction.field };
	} else {
		const lastMessagePath = path.join(tempDirPath ?? os.tmpdir(), "last-message.txt");
		args.push(...spec.extraction.flag, lastMessagePath);
		capture = { type: "last-message-file", path: lastMessagePath };
	}

	return { schemaJson, args, capture, tempPaths };
}

export async function cleanupStructuredOutput(
	plan: StructuredOutputPlan | null | undefined,
): Promise<void> {
	if (!plan) {
		return;
	}
	for (const tempPath of plan.tempPaths) {
		try {
			await rm(tempPath, { recursive: true, force: true });
		} catch {
			// Best-effort cleanup; leftover temp dirs are harmless.
		}
	}
}
