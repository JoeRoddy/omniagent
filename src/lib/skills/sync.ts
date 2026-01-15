import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { applyAgentTemplating } from "../agent-templating.js";
import { stripFrontmatterFields } from "../frontmatter-strip.js";
import {
	buildSummary,
	type SyncResult,
	type SyncSourceCounts,
	type SyncSummary,
} from "../sync-results.js";
import {
	resolveEffectiveTargets,
	TARGETS,
	type TargetName,
	type TargetSpec,
} from "../sync-targets.js";
import { loadSkillCatalog, type SkillDefinition } from "./catalog.js";

export type SkillSyncRequest = {
	repoRoot: string;
	targets: TargetSpec[];
	overrideOnly?: TargetName[] | null;
	overrideSkip?: TargetName[] | null;
	validAgents: string[];
	excludeLocal?: boolean;
};

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const TARGET_FRONTMATTER_KEYS = new Set(["targets", "targetagents"]);
const ALL_TARGET_NAMES = TARGETS.map((target) => target.name);

function decodeUtf8(buffer: Buffer): string | null {
	try {
		return utf8Decoder.decode(buffer);
	} catch {
		return null;
	}
}

function formatDisplayPath(repoRoot: string, absolutePath: string): string {
	const relative = path.relative(repoRoot, absolutePath);
	const isWithinRepo = relative && !relative.startsWith("..") && !path.isAbsolute(relative);
	return isWithinRepo ? relative : absolutePath;
}

async function copySkillDirectory(options: {
	source: string;
	destination: string;
	target: TargetName;
	validAgents: string[];
	skillFileName: string;
	outputFileName: string;
}): Promise<void> {
	await mkdir(options.destination, { recursive: true });
	const entries = await readdir(options.source, { withFileTypes: true });
	const selectedSkillFile = options.skillFileName.toLowerCase();
	const outputSkillFile = options.outputFileName;

	for (const entry of entries) {
		const sourcePath = path.join(options.source, entry.name);
		const entryLowerName = entry.name.toLowerCase();
		const isSkillFile = entryLowerName === "skill.md" || entryLowerName === "skill.local.md";
		if (isSkillFile && entryLowerName !== selectedSkillFile) {
			continue;
		}
		const destinationPath = isSkillFile
			? path.join(options.destination, outputSkillFile)
			: path.join(options.destination, entry.name);
		if (entry.isDirectory()) {
			await copySkillDirectory({
				...options,
				source: sourcePath,
				destination: path.join(options.destination, entry.name),
			});
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}

		const buffer = await readFile(sourcePath);
		const decoded = decodeUtf8(buffer);
		if (decoded === null) {
			await mkdir(path.dirname(destinationPath), { recursive: true });
			await writeFile(destinationPath, buffer);
			continue;
		}

		const templated = applyAgentTemplating({
			content: decoded,
			target: options.target,
			validAgents: options.validAgents,
			sourcePath,
		});
		const output = isSkillFile
			? stripFrontmatterFields(templated, TARGET_FRONTMATTER_KEYS)
			: templated;
		await mkdir(path.dirname(destinationPath), { recursive: true });
		await writeFile(destinationPath, output, "utf8");
	}
}

function buildInvalidTargetWarnings(skills: SkillDefinition[]): string[] {
	const warnings: string[] = [];
	for (const skill of skills) {
		if (skill.invalidTargets.length === 0) {
			continue;
		}
		const invalidList = skill.invalidTargets.join(", ");
		warnings.push(
			`Skill "${skill.name}" has unsupported targets (${invalidList}) in ${skill.sourcePath}.`,
		);
	}
	return warnings;
}

function resolveEffectiveTargetsForSkill(
	skill: SkillDefinition,
	overrideOnly?: TargetName[] | null,
	overrideSkip?: TargetName[] | null,
): TargetName[] {
	return resolveEffectiveTargets({
		defaultTargets: skill.targetAgents,
		overrideOnly: overrideOnly ?? undefined,
		overrideSkip: overrideSkip ?? undefined,
		allTargets: ALL_TARGET_NAMES,
	});
}

export async function syncSkills(request: SkillSyncRequest): Promise<SyncSummary> {
	const sourcePath = path.join(request.repoRoot, "agents", "skills");
	if (request.targets.length === 0) {
		return buildSummary(sourcePath, [], [], {
			shared: 0,
			local: 0,
			excludedLocal: request.excludeLocal ?? false,
		});
	}

	const catalog = await loadSkillCatalog(request.repoRoot, {
		includeLocal: !request.excludeLocal,
	});
	const warnings = buildInvalidTargetWarnings(catalog.skills);
	const effectiveTargetsBySkill = new Map<SkillDefinition, TargetName[]>();
	for (const skill of catalog.skills) {
		effectiveTargetsBySkill.set(
			skill,
			resolveEffectiveTargetsForSkill(skill, request.overrideOnly, request.overrideSkip),
		);
	}

	const targetNames = new Set(request.targets.map((target) => target.name));
	const sourceCounts: SyncSourceCounts = {
		shared: 0,
		local: 0,
		excludedLocal: request.excludeLocal ?? false,
	};
	for (const skill of catalog.skills) {
		const effectiveTargets = effectiveTargetsBySkill.get(skill) ?? [];
		if (!effectiveTargets.some((targetName) => targetNames.has(targetName))) {
			continue;
		}
		if (skill.sourceType === "local") {
			sourceCounts.local += 1;
		} else {
			sourceCounts.shared += 1;
		}
	}

	const results: SyncResult[] = [];
	const sourceDisplay = formatDisplayPath(request.repoRoot, sourcePath);

	for (const target of request.targets) {
		const destPath = path.join(request.repoRoot, target.relativePath);
		const destDisplay = formatDisplayPath(request.repoRoot, destPath);
		const selectedSkills = catalog.skills.filter((skill) => {
			const effectiveTargets = effectiveTargetsBySkill.get(skill) ?? [];
			return effectiveTargets.includes(target.name);
		});

		try {
			for (const skill of selectedSkills) {
				const destinationDir = path.join(destPath, skill.relativePath);
				await copySkillDirectory({
					source: skill.directoryPath,
					destination: destinationDir,
					target: target.name,
					validAgents: request.validAgents,
					skillFileName: skill.skillFileName,
					outputFileName: skill.outputFileName,
				});
			}
			results.push({
				targetName: target.name,
				status: "synced",
				message: `Synced ${sourceDisplay} -> ${destDisplay}`,
			});
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			results.push({
				targetName: target.name,
				status: "failed",
				message: `Failed ${sourceDisplay} -> ${destDisplay}: ${errorMessage}`,
				error: errorMessage,
			});
		}
	}

	return buildSummary(sourcePath, results, warnings, sourceCounts);
}
