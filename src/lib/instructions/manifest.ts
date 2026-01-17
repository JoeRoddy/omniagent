import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { InstructionTargetName } from "./targets.js";

export type InstructionManifestEntry = {
	outputPath: string;
	targetName: InstructionTargetName;
	sourcePath: string;
	contentHash: string;
	lastSyncedAt: string;
};

export type InstructionSyncManifest = {
	entries: InstructionManifestEntry[];
};

function hashIdentifier(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function resolveManifestPath(
	repoRoot: string,
	homeDir: string = os.homedir(),
): string {
	const repoHash = hashIdentifier(repoRoot);
	const baseDir = path.join(homeDir, ".omniagent", "state", "instructions", "projects", repoHash);
	return path.join(baseDir, "instruction-outputs.json");
}

export async function readManifest(
	repoRoot: string,
	homeDir?: string,
): Promise<InstructionSyncManifest | null> {
	const manifestPath = resolveManifestPath(repoRoot, homeDir);
	try {
		const contents = await readFile(manifestPath, "utf8");
		const parsed = JSON.parse(contents) as InstructionSyncManifest;
		if (!parsed || !Array.isArray(parsed.entries)) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

export async function writeManifest(
	repoRoot: string,
	manifest: InstructionSyncManifest,
	homeDir?: string,
): Promise<void> {
	const manifestPath = resolveManifestPath(repoRoot, homeDir);
	const sorted = [...manifest.entries].sort((left, right) => {
		const targetCompare = left.targetName.localeCompare(right.targetName);
		if (targetCompare !== 0) {
			return targetCompare;
		}
		const outputCompare = left.outputPath.localeCompare(right.outputPath);
		if (outputCompare !== 0) {
			return outputCompare;
		}
		return left.sourcePath.localeCompare(right.sourcePath);
	});
	await mkdir(path.dirname(manifestPath), { recursive: true });
	await writeFile(
		manifestPath,
		`${JSON.stringify({ entries: sorted }, null, 2)}\n`,
		"utf8",
	);
}
