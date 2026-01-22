import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type ManagedOutputRecord = {
	targetId: string;
	outputPath: string;
	sourceType: "skill" | "command" | "subagent" | "instruction";
	sourceId: string;
	checksum: string;
	lastSyncedAt: string;
	writerId?: string;
};

export type ManagedOutputsManifest = {
	entries: ManagedOutputRecord[];
};

function hashIdentifier(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function hashContent(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

export function normalizeManagedOutputPath(outputPath: string): string {
	return path.normalize(outputPath).replace(/\\/g, "/").toLowerCase();
}

export function buildManagedOutputKey(
	entry: Pick<ManagedOutputRecord, "targetId" | "sourceType" | "outputPath">,
): string {
	return `${entry.targetId}:${entry.sourceType}:${normalizeManagedOutputPath(entry.outputPath)}`;
}

async function hashDirectoryContents(directoryPath: string): Promise<string> {
	const entries: Array<{ relativePath: string; hash: string }> = [];

	const walk = async (currentPath: string): Promise<void> => {
		const children = await readdir(currentPath, { withFileTypes: true });
		for (const child of children) {
			const childPath = path.join(currentPath, child.name);
			if (child.isDirectory()) {
				await walk(childPath);
				continue;
			}
			if (!child.isFile()) {
				continue;
			}
			const buffer = await readFile(childPath);
			const relativePath = path.relative(directoryPath, childPath).replace(/\\/g, "/");
			entries.push({ relativePath, hash: hashContent(buffer) });
		}
	};

	await walk(directoryPath);
	entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

	const digest = createHash("sha256");
	for (const entry of entries) {
		digest.update(entry.relativePath);
		digest.update("\n");
		digest.update(entry.hash);
		digest.update("\n");
	}
	return digest.digest("hex");
}

export async function hashOutputPath(outputPath: string): Promise<string | null> {
	try {
		const stats = await stat(outputPath);
		if (stats.isFile()) {
			const buffer = await readFile(outputPath);
			return hashContent(buffer);
		}
		if (stats.isDirectory()) {
			return await hashDirectoryContents(outputPath);
		}
		return null;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

export function resolveManagedOutputsPath(
	repoRoot: string,
	homeDir: string = os.homedir(),
): string {
	const repoHash = hashIdentifier(repoRoot);
	const baseDir = path.join(
		homeDir,
		".omniagent",
		"state",
		"managed-outputs",
		"projects",
		repoHash,
	);
	return path.join(baseDir, "managed-outputs.json");
}

export async function readManagedOutputs(
	repoRoot: string,
	homeDir?: string,
): Promise<ManagedOutputsManifest | null> {
	const manifestPath = resolveManagedOutputsPath(repoRoot, homeDir);
	try {
		const contents = await readFile(manifestPath, "utf8");
		const parsed = JSON.parse(contents) as ManagedOutputsManifest;
		if (!parsed || !Array.isArray(parsed.entries)) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

export async function writeManagedOutputs(
	repoRoot: string,
	manifest: ManagedOutputsManifest,
	homeDir?: string,
): Promise<void> {
	const manifestPath = resolveManagedOutputsPath(repoRoot, homeDir);
	const sorted = [...manifest.entries].sort((left, right) => {
		const targetCompare = left.targetId.localeCompare(right.targetId);
		if (targetCompare !== 0) {
			return targetCompare;
		}
		const outputCompare = left.outputPath.localeCompare(right.outputPath);
		if (outputCompare !== 0) {
			return outputCompare;
		}
		return left.sourceId.localeCompare(right.sourceId);
	});
	await mkdir(path.dirname(manifestPath), { recursive: true });
	await writeFile(manifestPath, `${JSON.stringify({ entries: sorted }, null, 2)}\n`, "utf8");
}
