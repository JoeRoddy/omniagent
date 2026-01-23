export const EXIT_CODES = {
	success: 0,
	"execution-error": 1,
	"invalid-usage": 2,
	blocked: 3,
} as const;

export type ExitCodeReason = keyof typeof EXIT_CODES;
export type ExitCode = (typeof EXIT_CODES)[ExitCodeReason];

export function exitCodeFor(reason: ExitCodeReason): ExitCode {
	return EXIT_CODES[reason];
}

export class ShimError extends Error {
	readonly reason: ExitCodeReason;
	readonly exitCode: ExitCode;

	constructor(reason: ExitCodeReason, message: string) {
		super(message);
		this.reason = reason;
		this.exitCode = exitCodeFor(reason);
	}
}

export class InvalidUsageError extends ShimError {
	constructor(message: string) {
		super("invalid-usage", message);
	}
}

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
