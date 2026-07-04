import Ajv, { type Options, type ValidateFunction } from "ajv";
import Ajv2019 from "ajv/dist/2019.js";
import Ajv2020 from "ajv/dist/2020.js";
import type { StructuredOutputValidator } from "../../lib/targets/config-types.js";
import { InvalidUsageError } from "./errors.js";

const AJV_OPTIONS: Options = { allErrors: true, strict: false, validateFormats: false };

type SchemaDialect = "draft-07" | "2019-09" | "2020-12";

type AjvLike = { compile(schema: Record<string, unknown>): ValidateFunction };

const instances = new Map<SchemaDialect, AjvLike>();

function resolveDialect(schema: Record<string, unknown>): SchemaDialect {
	const declared = typeof schema.$schema === "string" ? schema.$schema : "";
	if (declared.includes("2020-12")) {
		return "2020-12";
	}
	if (declared.includes("2019-09")) {
		return "2019-09";
	}
	return "draft-07";
}

function ajvForDialect(dialect: SchemaDialect): AjvLike {
	let instance = instances.get(dialect);
	if (!instance) {
		instance =
			dialect === "2020-12"
				? new Ajv2020(AJV_OPTIONS)
				: dialect === "2019-09"
					? new Ajv2019(AJV_OPTIONS)
					: new Ajv(AJV_OPTIONS);
		instances.set(dialect, instance);
	}
	return instance;
}

export function compileSchemaValidator(schemaJson: string): StructuredOutputValidator {
	let compiled: ValidateFunction;
	try {
		const schema = JSON.parse(schemaJson) as Record<string, unknown>;
		compiled = ajvForDialect(resolveDialect(schema)).compile(schema);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new InvalidUsageError(`Invalid value for --output-schema: ${message}.`);
	}
	return (data: unknown) => {
		const valid = compiled(data) === true;
		const errors = (compiled.errors ?? []).map(
			(error) => `${error.instancePath || "/"}: ${error.message ?? "is invalid"}`,
		);
		return { valid, errors };
	};
}
