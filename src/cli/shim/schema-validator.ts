import Ajv from "ajv";
import type { StructuredOutputValidator } from "../../lib/targets/config-types.js";
import { InvalidUsageError } from "./errors.js";

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });

export function compileSchemaValidator(schemaJson: string): StructuredOutputValidator {
	let compiled: ReturnType<typeof ajv.compile>;
	try {
		compiled = ajv.compile(JSON.parse(schemaJson));
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
