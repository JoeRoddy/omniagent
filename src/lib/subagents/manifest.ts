import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SubagentTargetName } from "./targets.js";

export type ManagedSubagent = {
	name: string;
	hash: string;
	lastSyncedAt: string;
};

export type SubagentSyncManifest = {
	targetName: SubagentTargetName;
	managedSubagents: ManagedSubagent[];
};

function hashIdentifier(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function resolveManifestPath(
	repoRoot: string,
	targetName: SubagentTargetName,
	homeDir: string,
): string {
	const repoHash = hashIdentifier(repoRoot);
	const baseDir = path.join(homeDir, ".agentctrl", "state", "subagents", "projects", repoHash);
	return path.join(baseDir, `${targetName}.toml`);
}

function parseTomlValue(rawValue: string): string {
	const trimmed = rawValue.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		try {
			return JSON.parse(trimmed);
		} catch {
			return trimmed.slice(1, -1);
		}
	}
	return trimmed;
}

function parseManifest(contents: string): SubagentSyncManifest | null {
	const lines = contents.split(/\r?\n/);
	let targetName: SubagentTargetName | null = null;
	const managedSubagents: ManagedSubagent[] = [];
	let current: Partial<ManagedSubagent> | null = null;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}

		if (trimmed === "[[managedSubagents]]") {
			if (current?.name && current.hash && current.lastSyncedAt) {
				managedSubagents.push({
					name: current.name,
					hash: current.hash,
					lastSyncedAt: current.lastSyncedAt,
				});
			}
			current = {};
			continue;
		}

		const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
		if (!match) {
			continue;
		}
		const [, key, rawValue] = match;
		const value = parseTomlValue(rawValue);

		if (current) {
			if (key === "name") {
				current.name = value;
				continue;
			}
			if (key === "hash") {
				current.hash = value;
				continue;
			}
			if (key === "lastSyncedAt") {
				current.lastSyncedAt = value;
				continue;
			}
		}

		if (key === "targetName") {
			targetName = value as SubagentTargetName;
		}
	}

	if (current?.name && current.hash && current.lastSyncedAt) {
		managedSubagents.push({
			name: current.name,
			hash: current.hash,
			lastSyncedAt: current.lastSyncedAt,
		});
	}

	if (!targetName) {
		return null;
	}

	return {
		targetName,
		managedSubagents,
	};
}

function formatTomlString(value: string): string {
	return JSON.stringify(value);
}

export async function readManifest(manifestPath: string): Promise<SubagentSyncManifest | null> {
	try {
		const contents = await readFile(manifestPath, "utf8");
		return parseManifest(contents);
	} catch {
		return null;
	}
}

export async function writeManifest(
	manifestPath: string,
	manifest: SubagentSyncManifest,
): Promise<void> {
	const sorted = [...manifest.managedSubagents].sort((a, b) => a.name.localeCompare(b.name));
	const lines: string[] = [`targetName = ${formatTomlString(manifest.targetName)}`, ""];

	for (const entry of sorted) {
		lines.push("[[managedSubagents]]");
		lines.push(`name = ${formatTomlString(entry.name)}`);
		lines.push(`hash = ${formatTomlString(entry.hash)}`);
		lines.push(`lastSyncedAt = ${formatTomlString(entry.lastSyncedAt)}`);
		lines.push("");
	}

	await writeFile(manifestPath, `${lines.join("\n")}\n`, "utf8");
}
