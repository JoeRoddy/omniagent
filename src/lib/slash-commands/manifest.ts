import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Scope, TargetName } from "./targets.js";

export type ManagedCommand = {
	name: string;
	hash: string;
	lastSyncedAt: string;
};

export type SyncStateManifest = {
	targetName: TargetName;
	scope: Scope;
	managedCommands: ManagedCommand[];
};

export const MANIFEST_FILENAME = ".agentctl-slash-commands.toml";

export function resolveManifestPath(directory: string): string {
	return path.join(directory, MANIFEST_FILENAME);
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

function parseManifest(contents: string): SyncStateManifest | null {
	const lines = contents.split(/\r?\n/);
	let targetName: TargetName | null = null;
	let scope: Scope | null = null;
	const managedCommands: ManagedCommand[] = [];
	let current: Partial<ManagedCommand> | null = null;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}

		if (trimmed === "[[managedCommands]]") {
			if (current?.name && current.hash && current.lastSyncedAt) {
				managedCommands.push({
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
			targetName = value as TargetName;
			continue;
		}
		if (key === "scope") {
			scope = value as Scope;
		}
	}

	if (current?.name && current.hash && current.lastSyncedAt) {
		managedCommands.push({
			name: current.name,
			hash: current.hash,
			lastSyncedAt: current.lastSyncedAt,
		});
	}

	if (!targetName || !scope) {
		return null;
	}

	return {
		targetName,
		scope,
		managedCommands,
	};
}

function formatTomlString(value: string): string {
	return JSON.stringify(value);
}

export async function readManifest(manifestPath: string): Promise<SyncStateManifest | null> {
	try {
		const contents = await readFile(manifestPath, "utf8");
		return parseManifest(contents);
	} catch {
		return null;
	}
}

export async function writeManifest(
	manifestPath: string,
	manifest: SyncStateManifest,
): Promise<void> {
	const sorted = [...manifest.managedCommands].sort((a, b) => a.name.localeCompare(b.name));
	const lines: string[] = [
		`targetName = ${formatTomlString(manifest.targetName)}`,
		`scope = ${formatTomlString(manifest.scope)}`,
		"",
	];

	for (const command of sorted) {
		lines.push("[[managedCommands]]");
		lines.push(`name = ${formatTomlString(command.name)}`);
		lines.push(`hash = ${formatTomlString(command.hash)}`);
		lines.push(`lastSyncedAt = ${formatTomlString(command.lastSyncedAt)}`);
		lines.push("");
	}

	await writeFile(manifestPath, `${lines.join("\n")}\n`, "utf8");
}
