import { stat } from "node:fs/promises";
import path from "node:path";

async function pathExists(candidate: string): Promise<boolean> {
	try {
		await stat(candidate);
		return true;
	} catch {
		return false;
	}
}

async function findUp(startDir: string, markerRelativePath: string): Promise<string | null> {
	let current = path.resolve(startDir);
	let previous = "";

	while (current !== previous) {
		if (await pathExists(path.join(current, markerRelativePath))) {
			return current;
		}

		previous = current;
		current = path.dirname(current);
	}

	return null;
}

export async function findRepoRoot(startDir: string): Promise<string | null> {
	const gitRoot = await findUp(startDir, ".git");
	if (gitRoot) {
		return gitRoot;
	}

	return await findUp(startDir, "package.json");
}
