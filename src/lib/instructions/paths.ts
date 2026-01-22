import path from "node:path";
export function resolveInstructionOutputPath(outputDir: string, filename: string): string {
	return path.join(outputDir, filename);
}

export function resolveRepoInstructionOutputPath(sourcePath: string, filename: string): string {
	return resolveInstructionOutputPath(path.dirname(sourcePath), filename);
}
