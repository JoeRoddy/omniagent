import {
	EXIT_CODES,
	type ExitCode,
	type ExitCodeReason,
	exitCodeFor,
	InvalidUsageError,
	ShimError,
} from "../../lib/errors.js";

export {
	EXIT_CODES,
	type ExitCode,
	type ExitCodeReason,
	exitCodeFor,
	InvalidUsageError,
	ShimError,
};

export class BlockedError extends ShimError {
	constructor(message: string) {
		super("blocked", message);
	}
}

export class ExecutionError extends ShimError {
	constructor(message: string) {
		super("execution-error", message);
	}
}
