import path from "node:path";
import type { SearchRecord, SearchScope } from "./types.js";

const RELATIVE_DURATION = /^(\d+)\s*(s|m|h|d|w)$/i;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/;

const DURATION_MS: Record<string, number> = {
	s: 1_000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
	w: 604_800_000,
};

export class InvalidFilterError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "InvalidFilterError";
		this.code = code;
	}
}

/**
 * Accepts `YYYY-MM-DD`, a full ISO timestamp, or a relative duration like `7d` / `24h` / `30m`.
 *
 * Date-only values resolve in local time, and `--until 2026-08-05` covers that entire day, which
 * is what people mean by "up to the 5th".
 */
export function parseWhen(
	value: string,
	options: { flag: string; endOfDay?: boolean; now?: Date } = { flag: "--since" },
): Date {
	const trimmed = value.trim();
	const code = options.flag === "--until" ? "invalid_until" : "invalid_since";
	const fail = () => {
		throw new InvalidFilterError(
			code,
			`${options.flag} must be YYYY-MM-DD, an ISO timestamp, or a relative duration like 7d, 24h, or 30m.`,
		);
	};
	if (trimmed.length === 0) {
		fail();
	}

	const relative = RELATIVE_DURATION.exec(trimmed);
	if (relative) {
		const amount = Number(relative[1]);
		const unit = (relative[2] as string).toLowerCase();
		const now = options.now ?? new Date();
		return new Date(now.getTime() - amount * (DURATION_MS[unit] as number));
	}

	const dateOnly = DATE_ONLY.exec(trimmed);
	if (dateOnly) {
		const [year, month, day] = [
			Number(dateOnly[1]),
			Number(dateOnly[2]),
			Number(dateOnly[3]),
		] as const;
		const resolved = options.endOfDay
			? new Date(year, month - 1, day, 23, 59, 59, 999)
			: new Date(year, month - 1, day, 0, 0, 0, 0);
		if (Number.isNaN(resolved.getTime())) {
			fail();
		}
		return resolved;
	}

	const parsed = new Date(trimmed);
	if (Number.isNaN(parsed.getTime())) {
		fail();
	}
	return parsed;
}

/**
 * Distinguishes `--project ./src` (a location) from `--project src` (a name fragment). Anything
 * that starts like a path is resolved and scoped to the repository containing it; everything else
 * is a case-insensitive substring match. This is what lets `--project .` mean "this repo".
 */
export function isPathLikeProject(value: string): boolean {
	const trimmed = value.trim();
	return (
		trimmed === "." ||
		trimmed === ".." ||
		trimmed.startsWith("./") ||
		trimmed.startsWith("../") ||
		trimmed.startsWith(".\\") ||
		trimmed.startsWith("..\\") ||
		trimmed.startsWith("/") ||
		trimmed.startsWith("~") ||
		WINDOWS_ABSOLUTE.test(trimmed)
	);
}

export function expandHome(value: string, homeDir: string): string {
	const trimmed = value.trim();
	if (trimmed === "~") {
		return homeDir;
	}
	if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
		return path.join(homeDir, trimmed.slice(2));
	}
	return trimmed;
}

export function isWithinPath(candidate: string, root: string): boolean {
	return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

/**
 * The authoritative filter. Targets may prune files however they like in `listFiles`, but every
 * surviving record is re-checked here, so an over-eager or absent prune can never change results.
 */
export function recordMatchesScope(record: SearchRecord, scope: SearchScope): boolean {
	if (scope.projectPath) {
		// A record with no cwd cannot be confirmed to belong to the requested project. Excluding
		// it keeps an explicit filter predictable rather than leaking unverifiable rows.
		if (!record.cwd || !isWithinPath(record.cwd, scope.projectPath)) {
			return false;
		}
	}
	if (scope.projectMatch) {
		if (!record.cwd || !record.cwd.toLowerCase().includes(scope.projectMatch.toLowerCase())) {
			return false;
		}
	}
	if (scope.since || scope.until) {
		if (!record.timestamp) {
			return false;
		}
		const at = Date.parse(record.timestamp);
		if (Number.isNaN(at)) {
			return false;
		}
		if (scope.since && at < scope.since.getTime()) {
			return false;
		}
		if (scope.until && at > scope.until.getTime()) {
			return false;
		}
	}
	return true;
}
