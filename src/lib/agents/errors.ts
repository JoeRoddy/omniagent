import { ShimError } from "../../cli/shim/errors.js";

export class InvalidUsageError extends ShimError {
	constructor(message: string) {
		super("invalid-usage", message);
	}
}
