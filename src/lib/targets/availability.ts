import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import type { ResolvedTarget } from "./config-types.js";

export type CliAvailabilityResult = "available" | "unavailable" | "inconclusive";

export type CliAvailabilityCheck = {
	command: string;
	result: CliAvailabilityResult;
	resolvedPath?: string;
	warning?: string;
};

export type TargetAvailability = {
	targetId: string;
	status: "available" | "unavailable";
	reason?: string;
	warnings: string[];
	checks: CliAvailabilityCheck[];
};

const DEFAULT_PATHEXT = [".EXE", ".CMD", ".BAT", ".COM"];

function normalizeCommand(value: string | undefined | null): string | null {
	if (!value) {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function hasPathSeparator(command: string): boolean {
	return command.includes("/") || command.includes("\\");
}

function normalizePathEntry(entry: string): string | null {
	const trimmed = entry.trim();
	if (!trimmed) {
		return null;
	}
	if (
		(trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		const unquoted = trimmed.slice(1, -1).trim();
		return unquoted.length > 0 ? unquoted : null;
	}
	return trimmed;
}

function parsePathEntries(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	return value
		.split(path.delimiter)
		.map(normalizePathEntry)
		.filter((entry): entry is string => Boolean(entry));
}

function normalizePathExt(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return "";
	}
	return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function parsePathExt(value: string | undefined): string[] {
	const raw = value?.split(";") ?? DEFAULT_PATHEXT;
	const normalized = raw
		.map(normalizePathExt)
		.filter((entry) => entry.length > 0);
	const unique = new Set<string>();
	const result: string[] = [];
	for (const entry of normalized) {
		const key = entry.toLowerCase();
		if (unique.has(key)) {
			continue;
		}
		unique.add(key);
		result.push(entry);
	}
	return result;
}

function buildCommandCandidates(command: string, isWindows: boolean): string[] {
	if (!isWindows) {
		return [command];
	}
	if (path.extname(command)) {
		return [command];
	}
	const extensions = parsePathExt(process.env.PATHEXT);
	const candidates = [command, ...extensions.map((extension) => `${command}${extension}`)];
	const seen = new Set<string>();
	return candidates.filter((candidate) => {
		const key = candidate.toLowerCase();
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

type PathCheck =
	| { status: "available"; resolvedPath: string }
	| { status: "unavailable" }
	| { status: "inconclusive"; warning: string };

async function checkExecutable(candidate: string): Promise<PathCheck> {
	try {
		const stats = await stat(candidate);
		if (!stats.isFile()) {
			return { status: "unavailable" };
		}
		await access(candidate, constants.X_OK);
		return { status: "available", resolvedPath: candidate };
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") {
			return { status: "unavailable" };
		}
		if (code === "EACCES" || code === "EPERM") {
			return {
				status: "inconclusive",
				warning: `Permission denied while checking ${candidate}.`,
			};
		}
		return {
			status: "inconclusive",
			warning: `Unable to verify ${candidate} due to ${code ?? "an unknown error"}.`,
		};
	}
}

function buildInconclusiveWarning(command: string): string {
	return `Unable to verify ${command} on PATH due to permissions or access errors.`;
}

export function getTargetCliCommands(target: Pick<ResolvedTarget, "cli">): string[] {
	const commands: string[] = [];
	const add = (value: string | undefined) => {
		const normalized = normalizeCommand(value);
		if (!normalized) {
			return;
		}
		const key = normalized.toLowerCase();
		if (commands.some((command) => command.toLowerCase() === key)) {
			return;
		}
		commands.push(normalized);
	};

	add(target.cli?.modes?.interactive?.command);
	add(target.cli?.modes?.oneShot?.command);

	return commands;
}

export async function checkCliOnPath(command: string): Promise<CliAvailabilityCheck> {
	const normalized = normalizeCommand(command);
	if (!normalized) {
		return { command: command ?? "", result: "unavailable" };
	}

	const isWindows = process.platform === "win32";
	const candidates = buildCommandCandidates(normalized, isWindows);
	let hasInconclusive = false;

	if (hasPathSeparator(normalized)) {
		for (const candidate of candidates) {
			const check = await checkExecutable(candidate);
			if (check.status === "available") {
				return { command: normalized, result: "available", resolvedPath: check.resolvedPath };
			}
			if (check.status === "inconclusive") {
				hasInconclusive = true;
			}
		}
		if (hasInconclusive) {
			return {
				command: normalized,
				result: "inconclusive",
				warning: buildInconclusiveWarning(normalized),
			};
		}
		return { command: normalized, result: "unavailable" };
	}

	const pathEntries = parsePathEntries(process.env.PATH);
	if (pathEntries.length === 0) {
		return {
			command: normalized,
			result: "inconclusive",
			warning: `PATH is not set; unable to verify ${normalized}.`,
		};
	}

	for (const entry of pathEntries) {
		for (const candidate of candidates) {
			const fullPath = path.join(entry, candidate);
			const check = await checkExecutable(fullPath);
			if (check.status === "available") {
				return { command: normalized, result: "available", resolvedPath: check.resolvedPath };
			}
			if (check.status === "inconclusive") {
				hasInconclusive = true;
			}
		}
	}

	if (hasInconclusive) {
		return {
			command: normalized,
			result: "inconclusive",
			warning: buildInconclusiveWarning(normalized),
		};
	}

	return { command: normalized, result: "unavailable" };
}

export async function checkTargetAvailability(
	target: Pick<ResolvedTarget, "id" | "cli">,
): Promise<TargetAvailability> {
	const commands = getTargetCliCommands(target);
	if (commands.length === 0) {
		return {
			targetId: target.id,
			status: "unavailable",
			reason: "Target does not declare a CLI command.",
			warnings: [],
			checks: [],
		};
	}

	const checks = await Promise.all(commands.map((command) => checkCliOnPath(command)));
	const hasAvailable = checks.some((check) => check.result === "available");
	if (hasAvailable) {
		return {
			targetId: target.id,
			status: "available",
			warnings: [],
			checks,
		};
	}

	const hasInconclusive = checks.some((check) => check.result === "inconclusive");
	const warnings = hasInconclusive
		? checks.flatMap((check) => (check.warning ? [check.warning] : []))
		: [];
	const reason = hasInconclusive
		? "CLI availability could not be confirmed."
		: "CLI not found on PATH.";

	return {
		targetId: target.id,
		status: "unavailable",
		reason,
		warnings,
		checks,
	};
}
