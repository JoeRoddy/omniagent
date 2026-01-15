import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type IgnorePromptPreference = {
	projectId: string;
	ignorePromptDeclined: boolean;
	updatedAt: string;
};

function hashIdentifier(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function resolveIgnorePreferencePath(
	repoRoot: string,
	homeDir: string = os.homedir(),
): string {
	const repoHash = hashIdentifier(repoRoot);
	return path.join(homeDir, ".omniagent", "state", "ignore-rules", "projects", `${repoHash}.json`);
}

export async function readIgnorePreference(
	repoRoot: string,
	homeDir: string = os.homedir(),
): Promise<IgnorePromptPreference | null> {
	const filePath = resolveIgnorePreferencePath(repoRoot, homeDir);
	try {
		const contents = await readFile(filePath, "utf8");
		const parsed = JSON.parse(contents) as Partial<IgnorePromptPreference>;
		if (!parsed || typeof parsed.ignorePromptDeclined !== "boolean") {
			return null;
		}
		return {
			projectId: parsed.projectId ?? hashIdentifier(repoRoot),
			ignorePromptDeclined: parsed.ignorePromptDeclined,
			updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
		};
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

export async function recordIgnorePromptDeclined(
	repoRoot: string,
	homeDir: string = os.homedir(),
): Promise<IgnorePromptPreference> {
	const filePath = resolveIgnorePreferencePath(repoRoot, homeDir);
	const preference: IgnorePromptPreference = {
		projectId: hashIdentifier(repoRoot),
		ignorePromptDeclined: true,
		updatedAt: new Date().toISOString(),
	};
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(preference, null, 2)}\n`, "utf8");
	return preference;
}
