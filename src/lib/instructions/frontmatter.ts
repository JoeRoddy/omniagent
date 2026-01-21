import path from "node:path";
import { extractFrontmatter, type FrontmatterValue } from "../slash-commands/frontmatter.js";
import {
	hasRawTargetValues,
	InvalidFrontmatterTargetsError,
	resolveFrontmatterTargets,
} from "../sync-targets.js";
import type { InstructionTargetName } from "./targets.js";

export type InstructionFrontmatterResult = {
	frontmatter: Record<string, FrontmatterValue>;
	body: string;
	targets: InstructionTargetName[] | null;
	invalidTargets: string[];
	outPutPath: string | null;
	resolvedOutputDir: string | null;
};

function resolveOutPutPathValue(frontmatter: Record<string, FrontmatterValue>): string | null {
	const raw = frontmatter.outPutPath ?? frontmatter.outputPath;
	if (raw === undefined || raw === null) {
		return null;
	}
	if (Array.isArray(raw)) {
		return null;
	}
	const trimmed = raw.trim();
	return trimmed ? trimmed : null;
}

function normalizeOutputDir(rawPath: string, repoRoot: string): string {
	const absolute = path.isAbsolute(rawPath) ? rawPath : path.resolve(repoRoot, rawPath);
	const normalized = path.normalize(absolute);
	const extension = path.extname(normalized);
	if (extension.toLowerCase() === ".md") {
		return path.dirname(normalized);
	}
	return normalized;
}

export function parseInstructionFrontmatter(options: {
	contents: string;
	sourcePath: string;
	repoRoot: string;
	resolveTargetName: (value: string) => string | null;
}): InstructionFrontmatterResult {
	const { frontmatter, body } = extractFrontmatter(options.contents);
	const rawTargets = [frontmatter.targets, frontmatter.targetAgents];
	const { targets, invalidTargets } = resolveFrontmatterTargets(
		rawTargets,
		options.resolveTargetName,
	);
	if (invalidTargets.length > 0) {
		const invalidList = invalidTargets.join(", ");
		throw new InvalidFrontmatterTargetsError(
			`Instruction template has unsupported targets (${invalidList}) in ${options.sourcePath}.`,
		);
	}
	if (hasRawTargetValues(rawTargets) && (!targets || targets.length === 0)) {
		throw new InvalidFrontmatterTargetsError(
			`Instruction template has empty targets in ${options.sourcePath}.`,
		);
	}

	const outPutPath = resolveOutPutPathValue(frontmatter);
	const resolvedOutputDir = outPutPath ? normalizeOutputDir(outPutPath, options.repoRoot) : null;

	return {
		frontmatter,
		body,
		targets,
		invalidTargets,
		outPutPath,
		resolvedOutputDir,
	};
}
