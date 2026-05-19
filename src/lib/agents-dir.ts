import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_AGENTS_DIR = "agents";

export type AgentsDirSource = "default" | "override";
export type AgentsDirValidationStatus = "valid" | "missing" | "notDirectory" | "permissionDenied";

export type AgentsDirResolution = {
	requestedPath: string | null;
	resolvedPath: string;
	source: AgentsDirSource;
	isDefault: boolean;
};

export type AgentsDirValidationResult =
	| (AgentsDirResolution & {
			validationStatus: "valid";
			errorMessage: null;
	  })
	| (AgentsDirResolution & {
			validationStatus: Exclude<AgentsDirValidationStatus, "valid">;
			errorMessage: string;
	  });

export type AgentsDirValidationOptions = {
	requireWrite?: boolean;
};

function normalizeRequestedPath(value?: string | null): string | null {
	if (!value) {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function resolveAgentsDir(repoRoot: string, agentsDir?: string | null): AgentsDirResolution {
	const requestedPath = normalizeRequestedPath(agentsDir);
	const source: AgentsDirSource = requestedPath ? "override" : "default";
	const basePath = requestedPath ?? DEFAULT_AGENTS_DIR;
	return {
		requestedPath,
		resolvedPath: path.resolve(repoRoot, basePath),
		source,
		isDefault: source === "default",
	};
}

export function resolveAgentsDirPath(repoRoot: string, agentsDir?: string | null): string {
	return resolveAgentsDir(repoRoot, agentsDir).resolvedPath;
}

export function resolveAgentsDirRelativePath(
	repoRoot: string,
	agentsDir?: string | null,
): string | null {
	const resolved = resolveAgentsDir(repoRoot, agentsDir).resolvedPath;
	const relative = path.relative(repoRoot, resolved);
	if (relative && (relative.startsWith("..") || path.isAbsolute(relative))) {
		return null;
	}
	if (!relative || relative === ".") {
		return "";
	}
	return relative.replace(/\\/g, "/").replace(/\/+$/, "");
}

function buildValidationError(
	resolution: AgentsDirResolution,
	status: Exclude<AgentsDirValidationStatus, "valid">,
	message: string,
): AgentsDirValidationResult {
	return {
		...resolution,
		validationStatus: status,
		errorMessage: message,
	};
}

export async function validateAgentsDir(
	repoRoot: string,
	agentsDir?: string | null,
	options: AgentsDirValidationOptions = {},
): Promise<AgentsDirValidationResult> {
	const resolution = resolveAgentsDir(repoRoot, agentsDir);
	const requireWrite = options.requireWrite ?? true;
	const buildNotDirectoryError = (): AgentsDirValidationResult =>
		buildValidationError(
			resolution,
			"notDirectory",
			`Agents directory is not a directory: ${resolution.resolvedPath}. ` +
				"Provide a directory path or adjust --agentsDir.",
		);

	let stats: Awaited<ReturnType<typeof stat>>;
	try {
		stats = await stat(resolution.resolvedPath);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return buildValidationError(
				resolution,
				"missing",
				`Agents directory not found: ${resolution.resolvedPath}. ` +
					"Create it or pass a different --agentsDir.",
			);
		}
		if (code === "EACCES" || code === "EPERM") {
			return buildValidationError(
				resolution,
				"permissionDenied",
				`Agents directory is not accessible: ${resolution.resolvedPath}. ` +
					"Check permissions or choose another directory.",
			);
		}
		if (code === "ENOTDIR") {
			return buildNotDirectoryError();
		}
		throw error;
	}

	if (!stats.isDirectory()) {
		return buildNotDirectoryError();
	}

	try {
		const requiredAccess = constants.R_OK | constants.X_OK | (requireWrite ? constants.W_OK : 0);
		await access(resolution.resolvedPath, requiredAccess);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "EACCES" || code === "EPERM") {
			const requirement = requireWrite
				? "readable, writable, or searchable"
				: "readable or searchable";
			return buildValidationError(
				resolution,
				"permissionDenied",
				`Agents directory is not ${requirement}: ${resolution.resolvedPath}. ` +
					"Check permissions or choose another directory.",
			);
		}
		throw error;
	}

	return {
		...resolution,
		validationStatus: "valid",
		errorMessage: null,
	};
}
