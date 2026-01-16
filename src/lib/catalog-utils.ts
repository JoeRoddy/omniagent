import { stat } from "node:fs/promises";

/**
 * Read directory stats, returning null if the directory does not exist.
 */
export async function readDirectoryStats(
	directory: string,
): Promise<Awaited<ReturnType<typeof stat>> | null> {
	try {
		return await stat(directory);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

/**
 * Normalize a name for case-insensitive comparison.
 */
export function normalizeName(name: string): string {
	return name.toLowerCase();
}
