import path from "node:path";
import { resolveAgentsDirPath } from "../agents-dir.js";

export const PROFILES_DIRNAME = "profiles";
export const LOCAL_DIRNAME = ".local";

export function resolveProfilesDir(repoRoot: string, agentsDir?: string | null): string {
	const agentsRoot = resolveAgentsDirPath(repoRoot, agentsDir);
	return path.join(agentsRoot, PROFILES_DIRNAME);
}

export function resolveLocalProfilesDir(repoRoot: string, agentsDir?: string | null): string {
	const agentsRoot = resolveAgentsDirPath(repoRoot, agentsDir);
	return path.join(agentsRoot, LOCAL_DIRNAME, PROFILES_DIRNAME);
}

export function profileSharedPath(
	repoRoot: string,
	name: string,
	agentsDir?: string | null,
): string {
	return path.join(resolveProfilesDir(repoRoot, agentsDir), `${name}.json`);
}

export function profileLocalSiblingPath(
	repoRoot: string,
	name: string,
	agentsDir?: string | null,
): string {
	return path.join(resolveProfilesDir(repoRoot, agentsDir), `${name}.local.json`);
}

export function profileLocalDedicatedPath(
	repoRoot: string,
	name: string,
	agentsDir?: string | null,
): string {
	return path.join(resolveLocalProfilesDir(repoRoot, agentsDir), `${name}.json`);
}
