import { createHash } from "node:crypto";
import { readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type ResetProjectStateResult = {
	removedPaths: string[];
};

function hashIdentifier(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

async function pathExists(candidate: string): Promise<boolean> {
	try {
		await stat(candidate);
		return true;
	} catch {
		return false;
	}
}

async function listRepoSlashCommandManifestPaths(repoRoot: string): Promise<string[]> {
	const matches: string[] = [];
	const stack = [repoRoot];

	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			continue;
		}
		const entries = await readdir(current, { withFileTypes: true });
		for (const entry of entries) {
			const childPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(childPath);
				continue;
			}
			if (entry.isFile() && entry.name === ".omniagent-slash-commands.toml") {
				matches.push(childPath);
			}
		}
	}

	return matches;
}

function resolveRepoScopedStatePaths(repoRoot: string, homeDir: string): string[] {
	const repoHash = hashIdentifier(repoRoot);

	return [
		path.join(homeDir, ".omniagent", "state", "managed-outputs", "projects", repoHash),
		path.join(homeDir, ".omniagent", "state", "instructions", "projects", repoHash),
		path.join(homeDir, ".omniagent", "state", "subagents", "projects", repoHash),
		path.join(homeDir, ".omniagent", "state", "slash-commands", "projects", repoHash),
		path.join(homeDir, ".omniagent", "state", "ignore-rules", "projects", `${repoHash}.json`),
		path.join(homeDir, ".omniagent", "slash-commands", "projects", repoHash),
		path.join(homeDir, ".omniagent", "slash-commands", "skills", "projects", repoHash),
		path.join(repoRoot, ".omniagent", "slash-commands"),
	];
}

export async function resetProjectState(
	repoRoot: string,
	homeDir: string = os.homedir(),
): Promise<ResetProjectStateResult> {
	const candidates = [
		...resolveRepoScopedStatePaths(repoRoot, homeDir),
		...(await listRepoSlashCommandManifestPaths(repoRoot)),
	];
	const uniqueCandidates = Array.from(new Set(candidates));
	const removedPaths: string[] = [];

	for (const candidate of uniqueCandidates) {
		if (!(await pathExists(candidate))) {
			continue;
		}
		await rm(candidate, { recursive: true, force: true });
		removedPaths.push(candidate);
	}

	return { removedPaths };
}
