import path from "node:path";
import type { InstructionTargetName } from "./targets.js";
import { resolveInstructionFileName } from "./targets.js";

export function resolveInstructionOutputPath(
	outputDir: string,
	targetName: InstructionTargetName,
): string {
	return path.join(outputDir, resolveInstructionFileName(targetName));
}

export function resolveRepoInstructionOutputPath(
	sourcePath: string,
	targetName: InstructionTargetName,
): string {
	return resolveInstructionOutputPath(path.dirname(sourcePath), targetName);
}
