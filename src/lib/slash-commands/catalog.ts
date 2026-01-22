import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeName, readDirectoryStats } from "../catalog-utils.js";
import { resolveLocalPrecedence } from "../local-precedence.js";
import {
	buildSourceMetadata,
	type LocalMarkerType,
	resolveLocalCategoryRoot,
	resolveSharedCategoryRoot,
	type SourceType,
	stripLocalSuffix,
} from "../local-sources.js";
import {
	createTargetNameResolver,
	hasRawTargetValues,
	InvalidFrontmatterTargetsError,
	resolveFrontmatterTargets,
} from "../sync-targets.js";
import { BUILTIN_TARGETS } from "../targets/builtins.js";
import { extractFrontmatter, type FrontmatterValue } from "./frontmatter.js";
import type { TargetName } from "./targets.js";

export type { FrontmatterValue } from "./frontmatter.js";

export type SlashCommandDefinition = {
	name: string;
	prompt: string;
	sourcePath: string;
	sourceType: SourceType;
	markerType?: LocalMarkerType;
	isLocalFallback: boolean;
	rawContents: string;
	targetAgents: TargetName[] | null;
	invalidTargets: string[];
	frontmatter: Record<string, FrontmatterValue>;
};

export type CommandCatalog = {
	repoRoot: string;
	commandsPath: string;
	localCommandsPath: string;
	canonicalStandard: "canonical";
	commands: SlashCommandDefinition[];
	sharedCommands: SlashCommandDefinition[];
	localCommands: SlashCommandDefinition[];
	localEffectiveCommands: SlashCommandDefinition[];
};

export type LoadCommandCatalogOptions = {
	includeLocal?: boolean;
	agentsDir?: string | null;
	resolveTargetName?: (value: string) => string | null;
};

async function listMarkdownFiles(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const entryPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listMarkdownFiles(entryPath)));
			continue;
		}
		if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
			files.push(entryPath);
		}
	}
	return files;
}

async function buildCommandDefinition(options: {
	filePath: string;
	commandName: string;
	sourceType: SourceType;
	markerType?: LocalMarkerType;
	resolveTargetName: (value: string) => string | null;
}): Promise<SlashCommandDefinition> {
	const contents = await readFile(options.filePath, "utf8");
	const { frontmatter, body } = extractFrontmatter(contents);
	const prompt = body.trimEnd();
	if (!prompt.trim()) {
		throw new Error(`Slash command "${options.commandName}" has an empty prompt.`);
	}

	const rawTargets = [frontmatter.targets, frontmatter.targetAgents];
	const { targets, invalidTargets } = resolveFrontmatterTargets(
		rawTargets,
		options.resolveTargetName,
	);
	if (invalidTargets.length > 0) {
		const invalidList = invalidTargets.join(", ");
		throw new InvalidFrontmatterTargetsError(
			`Slash command "${options.commandName}" has unsupported targets (${invalidList}) in ${options.filePath}.`,
		);
	}
	if (hasRawTargetValues(rawTargets) && (!targets || targets.length === 0)) {
		throw new InvalidFrontmatterTargetsError(
			`Slash command "${options.commandName}" has empty targets in ${options.filePath}.`,
		);
	}

	let metadata: ReturnType<typeof buildSourceMetadata>;
	if (options.sourceType === "local") {
		const markerType = options.markerType;
		if (!markerType) {
			throw new Error("Local sources must include a marker type.");
		}
		metadata = buildSourceMetadata("local", markerType);
	} else {
		metadata = buildSourceMetadata("shared");
	}

	return {
		name: options.commandName,
		prompt,
		sourcePath: options.filePath,
		sourceType: metadata.sourceType,
		markerType: metadata.markerType,
		isLocalFallback: metadata.isLocalFallback,
		rawContents: contents,
		targetAgents: targets,
		invalidTargets,
		frontmatter,
	};
}

function registerUniqueName(
	seen: Map<string, string>,
	commandName: string,
	filePath: string,
): void {
	const lowerName = normalizeName(commandName);
	if (seen.has(lowerName)) {
		const existing = seen.get(lowerName);
		throw new Error(
			`Duplicate command name "${commandName}" (case-insensitive). Also found: ${existing}.`,
		);
	}
	seen.set(lowerName, filePath);
}

export async function loadCommandCatalog(
	repoRoot: string,
	options: LoadCommandCatalogOptions = {},
): Promise<CommandCatalog> {
	const includeLocal = options.includeLocal ?? true;
	const fallbackResolver = createTargetNameResolver(BUILTIN_TARGETS).resolveTargetName;
	const resolveTargetName = options.resolveTargetName ?? fallbackResolver;
	const commandsPath = resolveSharedCategoryRoot(repoRoot, "commands", options.agentsDir);
	const localCommandsPath = resolveLocalCategoryRoot(repoRoot, "commands", options.agentsDir);

	const sharedStats = await readDirectoryStats(commandsPath);
	if (sharedStats && !sharedStats.isDirectory()) {
		throw new Error(`Command catalog path is not a directory: ${commandsPath}.`);
	}
	const localStats = includeLocal ? await readDirectoryStats(localCommandsPath) : null;
	if (localStats && !localStats.isDirectory()) {
		throw new Error(`Local command catalog path is not a directory: ${localCommandsPath}.`);
	}

	const sharedFiles = sharedStats ? await listMarkdownFiles(commandsPath) : [];
	const localFiles = localStats ? await listMarkdownFiles(localCommandsPath) : [];

	const sharedCommands: SlashCommandDefinition[] = [];
	const localPathCommands: SlashCommandDefinition[] = [];
	const localSuffixCommands: SlashCommandDefinition[] = [];
	const seenShared = new Map<string, string>();
	const seenLocalPath = new Map<string, string>();
	const seenLocalSuffix = new Map<string, string>();

	for (const filePath of sharedFiles) {
		const fileName = path.basename(filePath);
		const { baseName, hadLocalSuffix } = stripLocalSuffix(fileName, ".md");
		if (!baseName) {
			continue;
		}
		if (hadLocalSuffix) {
			if (!includeLocal) {
				continue;
			}
			registerUniqueName(seenLocalSuffix, baseName, filePath);
			localSuffixCommands.push(
				await buildCommandDefinition({
					filePath,
					commandName: baseName,
					sourceType: "local",
					markerType: "suffix",
					resolveTargetName,
				}),
			);
		} else {
			registerUniqueName(seenShared, baseName, filePath);
			sharedCommands.push(
				await buildCommandDefinition({
					filePath,
					commandName: baseName,
					sourceType: "shared",
					resolveTargetName,
				}),
			);
		}
	}

	if (includeLocal) {
		for (const filePath of localFiles) {
			const fileName = path.basename(filePath);
			const { baseName } = stripLocalSuffix(fileName, ".md");
			if (!baseName) {
				continue;
			}
			registerUniqueName(seenLocalPath, baseName, filePath);
			localPathCommands.push(
				await buildCommandDefinition({
					filePath,
					commandName: baseName,
					sourceType: "local",
					markerType: "path",
					resolveTargetName,
				}),
			);
		}
	}

	const {
		local: localCommands,
		localEffective: localEffectiveCommands,
		sharedEffective: sharedEffectiveCommands,
	} = resolveLocalPrecedence({
		shared: sharedCommands,
		localPath: localPathCommands,
		localSuffix: localSuffixCommands,
		key: (command) => normalizeName(command.name),
	});
	const commands = includeLocal
		? [...localEffectiveCommands, ...sharedEffectiveCommands]
		: sharedCommands;

	return {
		repoRoot,
		commandsPath,
		localCommandsPath,
		canonicalStandard: "canonical",
		commands,
		sharedCommands,
		localCommands,
		localEffectiveCommands,
	};
}
