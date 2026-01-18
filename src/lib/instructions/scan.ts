import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
	buildSourceMetadata,
	detectLocalMarkerFromPath,
	type LocalMarkerType,
	type SourceType,
	stripLocalSuffix,
} from "../local-sources.js";

export type RepoInstructionFile = {
	sourcePath: string;
	sourceType: SourceType;
	markerType?: LocalMarkerType;
	isLocalFallback: boolean;
};

const DEFAULT_SKIP_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	".claude",
	".codex",
	".gemini",
	".github",
	".omniagent",
	"coverage",
]);

type IgnoreRule = {
	negated: boolean;
	dirOnly: boolean;
	basenameOnly: boolean;
	regex: RegExp;
};

function normalizePath(value: string): string {
	return value.replace(/\\/g, "/");
}

function globToRegExp(glob: string): RegExp {
	let regex = "^";
	let index = 0;
	while (index < glob.length) {
		const char = glob[index];
		if (char === "*") {
			const next = glob[index + 1];
			if (next === "*") {
				const nextNext = glob[index + 2];
				if (nextNext === "/") {
					regex += "(?:.*\\/)?";
					index += 3;
					continue;
				}
				regex += ".*";
				index += 2;
				continue;
			}
			regex += "[^/]*";
			index += 1;
			continue;
		}
		if (char === "?") {
			regex += "[^/]";
			index += 1;
			continue;
		}
		regex += char.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&");
		index += 1;
	}
	regex += "$";
	return new RegExp(regex);
}

function parseGitignore(contents: string): IgnoreRule[] {
	const rules: IgnoreRule[] = [];
	const lines = contents.split(/\r?\n/);
	for (const raw of lines) {
		const trimmed = raw.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		let pattern = trimmed;
		let negated = false;
		if (pattern.startsWith("!")) {
			negated = true;
			pattern = pattern.slice(1).trim();
		}
		if (!pattern) {
			continue;
		}
		const dirOnly = pattern.endsWith("/");
		if (dirOnly) {
			pattern = pattern.slice(0, -1);
		}
		const normalized = pattern.replace(/\\/g, "/");
		const anchored = normalized.startsWith("/");
		const rawPattern = anchored ? normalized.slice(1) : normalized;
		const basenameOnly = !rawPattern.includes("/");
		const glob = basenameOnly ? rawPattern : anchored ? rawPattern : `**/${rawPattern}`;
		const regex = globToRegExp(glob);
		rules.push({
			negated,
			dirOnly,
			basenameOnly,
			regex,
		});
	}
	return rules;
}

function matchIgnoreRule(rule: IgnoreRule, relPath: string, isDir: boolean): boolean {
	if (rule.dirOnly && !isDir) {
		return false;
	}
	const normalized = normalizePath(relPath);
	if (rule.basenameOnly) {
		const base = path.posix.basename(normalized);
		return rule.regex.test(base);
	}
	return rule.regex.test(normalized);
}

function buildIgnoreMatcher(rules: IgnoreRule[]): (relPath: string, isDir: boolean) => boolean {
	return (relPath, isDir) => {
		let ignored = false;
		for (const rule of rules) {
			if (matchIgnoreRule(rule, relPath, isDir)) {
				ignored = !rule.negated;
			}
		}
		return ignored;
	};
}

function hasSkippedSegment(relPath: string): boolean {
	const segments = relPath.split("/");
	return segments.some((segment) => DEFAULT_SKIP_DIRS.has(segment));
}

function detectLocalMarker(filePath: string): LocalMarkerType | null {
	return detectLocalMarkerFromPath(filePath);
}

function isRepoAgentsFile(fileName: string): boolean {
	const lower = fileName.toLowerCase();
	if (!lower.endsWith(".md")) {
		return false;
	}
	const { baseName } = stripLocalSuffix(fileName, ".md");
	return baseName.toLowerCase() === "agents";
}

async function loadIgnoreRules(repoRoot: string): Promise<IgnoreRule[]> {
	try {
		const contents = await readFile(path.join(repoRoot, ".gitignore"), "utf8");
		return parseGitignore(contents);
	} catch {
		return [];
	}
}

export async function scanRepoInstructionSources(options: {
	repoRoot: string;
	includeLocal?: boolean;
}): Promise<RepoInstructionFile[]> {
	const includeLocal = options.includeLocal ?? true;
	const rules = await loadIgnoreRules(options.repoRoot);
	const shouldIgnore = buildIgnoreMatcher(rules);
	const sources: RepoInstructionFile[] = [];

	const walk = async (relative: string, absolute: string): Promise<void> => {
		const entries = await readdir(absolute, { withFileTypes: true });
		for (const entry of entries) {
			const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;
			const normalizedRelative = normalizePath(entryRelative);
			if (normalizedRelative === "agents" || normalizedRelative.startsWith("agents/")) {
				if (entry.isDirectory()) {
					continue;
				}
				if (entry.isFile()) {
					continue;
				}
			}
			if (hasSkippedSegment(normalizedRelative)) {
				continue;
			}
			if (shouldIgnore(normalizedRelative, entry.isDirectory())) {
				continue;
			}
			const entryPath = path.join(absolute, entry.name);
			if (entry.isDirectory()) {
				await walk(entryRelative, entryPath);
				continue;
			}
			if (!entry.isFile()) {
				continue;
			}
			if (!isRepoAgentsFile(entry.name)) {
				continue;
			}
			const markerType = detectLocalMarker(entryPath);
			const sourceType: SourceType = markerType ? "local" : "shared";
			if (!includeLocal && sourceType === "local") {
				continue;
			}
			const metadata = buildSourceMetadata(sourceType, markerType ?? undefined);
			sources.push({
				sourcePath: entryPath,
				sourceType: metadata.sourceType,
				markerType: metadata.markerType,
				isLocalFallback: metadata.isLocalFallback,
			});
		}
	};

	await walk("", options.repoRoot);
	return sources;
}
