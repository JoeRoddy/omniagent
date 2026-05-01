import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CommandModule } from "yargs";
import { DEFAULT_AGENTS_DIR, resolveAgentsDir, validateAgentsDir } from "../../lib/agents-dir.js";
import {
	createProfileItemFilter,
	DEFAULT_PROFILE_NAME,
	inspectProfileFiles,
	listProfileDirectory,
	listProfiles,
	type Profile,
	profileLocalDedicatedPath,
	profileLocalSiblingPath,
	profileSharedPath,
	type ResolvedProfile,
	resolveProfiles,
} from "../../lib/profiles/index.js";
import { findRepoRoot } from "../../lib/repo-root.js";
import {
	assertSkillDefinitionUsable,
	loadSkillCatalog,
	type SkillDefinition,
} from "../../lib/skills/catalog.js";
import {
	assertSlashCommandDefinitionUsable,
	loadCommandCatalog,
	type SlashCommandDefinition,
} from "../../lib/slash-commands/catalog.js";
import {
	assertSubagentDefinitionUsable,
	loadSubagentCatalog,
	type SubagentDefinition,
} from "../../lib/subagents/catalog.js";
import { createTargetNameResolver } from "../../lib/sync-targets.js";
import { BUILTIN_TARGETS } from "../../lib/targets/builtins.js";
import { loadTargetConfig } from "../../lib/targets/config-loader.js";
import { validateTargetConfig } from "../../lib/targets/config-validate.js";
import { resolveTargets } from "../../lib/targets/resolve-targets.js";

type BaseArgs = {
	agentsDir?: string;
};

type ShowArgs = BaseArgs & {
	name: string;
	json?: boolean;
};

type ValidateArgs = BaseArgs & {
	strict?: boolean;
};

type ListArgs = BaseArgs & {
	json?: boolean;
};

type InitArgs = BaseArgs & {
	name: string;
};

type ProfileValidationCatalog = {
	resolveTargetName: (value: string) => string | null;
	skills: SkillDefinition[];
	commands: SlashCommandDefinition[];
	subagents: SubagentDefinition[];
};

const PROFILE_SCHEMA_URL =
	"https://raw.githubusercontent.com/JoeRoddy/omniagent/master/schemas/profile.v1.json";
const ANSI_GRAY = "\u001B[90m";
const ANSI_RESET_FOREGROUND = "\u001B[39m";
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const STARTER_PROFILE: Profile = {
	$schema: PROFILE_SCHEMA_URL,
	description: "",
	targets: {},
	enable: {
		skills: [],
		subagents: [],
		commands: [],
	},
	disable: {
		skills: [],
		subagents: [],
		commands: [],
	},
	variables: {},
};

type InitProfileTarget = {
	profileName: string;
	isLocal: boolean;
};

async function resolveRepoAndAgentsDir(
	argv: BaseArgs,
): Promise<{ repoRoot: string; agentsDir: string } | null> {
	const startDir = process.cwd();
	const repoRoot = await findRepoRoot(startDir);
	if (!repoRoot) {
		console.error(
			`Error: Repository root not found starting from ${startDir}. Looked for .git or package.json.`,
		);
		process.exit(1);
		return null;
	}
	const agentsDirResolution = resolveAgentsDir(repoRoot, argv.agentsDir);
	if (agentsDirResolution.source === "override") {
		const validation = await validateAgentsDir(repoRoot, argv.agentsDir);
		if (validation.validationStatus !== "valid") {
			console.error(`Error: ${validation.errorMessage}`);
			process.exit(1);
			return null;
		}
	}
	return { repoRoot, agentsDir: agentsDirResolution.resolvedPath };
}

function formatAnnotations(entry: {
	isDefault: boolean;
	hasShared: boolean;
	hasLocalSibling: boolean;
	hasLocalDedicated: boolean;
	isLocalOnly: boolean;
}): string[] {
	const annotations: string[] = [];
	if (entry.isDefault) {
		annotations.push("(active by default)");
	}
	if (entry.isLocalOnly) {
		annotations.push("[local-only]");
	} else if (entry.hasLocalSibling || entry.hasLocalDedicated) {
		annotations.push("[local override]");
	}
	return annotations;
}

function validateProfileNamePart(name: string): string | null {
	if (!PROFILE_NAME_PATTERN.test(name)) {
		return "Profile names may only contain letters, numbers, dots, underscores, and hyphens, and must start with a letter or number.";
	}
	return null;
}

function parseInitProfileTarget(name: string): InitProfileTarget | { error: string } {
	if (name.endsWith(".local")) {
		const profileName = name.slice(0, -".local".length);
		const issue = validateProfileNamePart(profileName);
		if (issue) {
			return { error: issue };
		}
		if (profileName.endsWith(".local")) {
			return { error: 'Profile names cannot end with ".local.local".' };
		}
		return {
			profileName,
			isLocal: true,
		};
	}

	const issue = validateProfileNamePart(name);
	if (issue) {
		return { error: issue };
	}
	return {
		profileName: name,
		isLocal: false,
	};
}

function colorsEnabled(): boolean {
	if (process.env.NO_COLOR !== undefined) {
		return false;
	}
	const forced = process.env.FORCE_COLOR;
	if (forced !== undefined) {
		return forced !== "0" && forced.toLowerCase() !== "false";
	}
	return Boolean(process.stdout.isTTY);
}

function findLineCommentStart(line: string): number | null {
	let inString = false;
	let escaped = false;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\" && inString) {
			escaped = true;
			continue;
		}
		if (char === '"') {
			inString = !inString;
			continue;
		}
		if (!inString && char === "/" && line[index + 1] === "/") {
			return index;
		}
	}
	return null;
}

function colorizeGuideComments(text: string): string {
	if (!colorsEnabled()) {
		return text;
	}
	return text
		.split("\n")
		.map((line) => {
			const commentStart = findLineCommentStart(line);
			if (commentStart === null) {
				return line;
			}
			return `${line.slice(0, commentStart)}${ANSI_GRAY}${line.slice(commentStart)}${ANSI_RESET_FOREGROUND}`;
		})
		.join("\n");
}

function initGuide(target: InitProfileTarget, displayPath: string): string {
	const label = target.isLocal
		? `Created local profile "${target.profileName}" at ${displayPath}.`
		: `Created profile "${target.profileName}" at ${displayPath}.`;
	const localHint = target.isLocal
		? `\nUse profile name "${target.profileName}" when syncing; ".local" is only the file suffix.\n`
		: "";

	return colorizeGuideComments(`${label}${localHint}

Profile files must be valid JSON. This commented version is just a guide:

{
  "$schema": "${PROFILE_SCHEMA_URL}",

  "description": "shown in \`omniagent profiles\`",

  "targets": {
    "claude": { "enabled": true }, // includes Claude; overrides an earlier profile setting it false
    "gemini": { "enabled": false } // skips Gemini for this profile
  },

  "enable": { // names/globs to include; also opts in items marked enabled:false
    "skills": ["code-review"],
    "subagents": ["reviewer"],
    "commands": []
  },

  "disable": { // names/globs to exclude after enable rules
    "skills": [],
    "subagents": [],
    "commands": ["*-legacy"]
  },

  // https://github.com/JoeRoddy/omniagent/blob/master/docs/templating.md
  "variables": {
    "REVIEW_STYLE": "thorough" // replaces {{REVIEW_STYLE}} in synced files
  }
}

Try it:
  omniagent profiles show ${target.profileName}
  omniagent sync --profile ${target.profileName}`);
}

async function loadProfileValidationCatalog(
	repoRoot: string,
	agentsDir: string,
): Promise<ProfileValidationCatalog> {
	const { config } = await loadTargetConfig({ repoRoot, agentsDir });
	const validation = validateTargetConfig({ config, builtIns: BUILTIN_TARGETS });
	if (!validation.valid) {
		throw new Error(`Invalid target configuration:\n- ${validation.errors.join("\n- ")}`);
	}

	const resolvedTargets = resolveTargets({
		config: validation.config,
		builtIns: BUILTIN_TARGETS,
	});
	const { resolveTargetName } = createTargetNameResolver(resolvedTargets.targets);
	const [skillCatalog, commandCatalog, subagentCatalog] = await Promise.all([
		loadSkillCatalog(repoRoot, { agentsDir, resolveTargetName }),
		loadCommandCatalog(repoRoot, { agentsDir, resolveTargetName }),
		loadSubagentCatalog(repoRoot, { agentsDir, resolveTargetName }),
	]);

	return {
		resolveTargetName,
		skills: skillCatalog.skills,
		commands: commandCatalog.commands,
		subagents: subagentCatalog.subagents,
	};
}

function collectProfileReferenceIssues(
	profileName: string,
	resolvedProfile: ResolvedProfile,
	catalog: ProfileValidationCatalog,
): string[] {
	const filter = createProfileItemFilter(resolvedProfile);
	const issues: string[] = [];
	for (const skill of catalog.skills) {
		const included = filter.includes("skills", {
			canonicalName: skill.name,
			enabledByDefault: skill.enabledByDefault,
		});
		if (!included) {
			continue;
		}
		try {
			assertSkillDefinitionUsable(skill);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			issues.push(`profile "${profileName}" includes unusable skill "${skill.name}": ${message}`);
		}
	}
	for (const command of catalog.commands) {
		const included = filter.includes("commands", {
			canonicalName: command.name,
			enabledByDefault: command.enabledByDefault,
		});
		if (!included) {
			continue;
		}
		try {
			assertSlashCommandDefinitionUsable(command);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			issues.push(
				`profile "${profileName}" includes unusable command "${command.name}": ${message}`,
			);
		}
	}
	for (const subagent of catalog.subagents) {
		const included = filter.includes("subagents", {
			canonicalName: subagent.resolvedName,
			enabledByDefault: subagent.enabledByDefault,
		});
		if (!included) {
			continue;
		}
		try {
			assertSubagentDefinitionUsable(subagent);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			issues.push(
				`profile "${profileName}" includes unusable subagent "${subagent.resolvedName}": ${message}`,
			);
		}
	}
	issues.push(...filter.collectUnknownWarnings());
	for (const targetName of Object.keys(resolvedProfile.targets)) {
		if (catalog.resolveTargetName(targetName)) {
			continue;
		}
		issues.push(`profile "${profileName}" references unknown target "${targetName}"`);
	}
	return issues;
}

const initSubcommand: CommandModule = {
	command: "init <name>",
	describe: "Create a new sync profile",
	builder: (yargs) =>
		yargs
			.positional("name", {
				type: "string",
				demandOption: true,
				describe: "Profile name",
			})
			.option("agentsDir", {
				type: "string",
				describe: "Override the agents directory",
				defaultDescription: DEFAULT_AGENTS_DIR,
			}),
	handler: async (argv) => {
		const typed = argv as unknown as InitArgs;
		const initTarget = parseInitProfileTarget(typed.name);
		if ("error" in initTarget) {
			console.error(`Error: ${initTarget.error}`);
			process.exit(1);
			return;
		}
		const resolved = await resolveRepoAndAgentsDir(typed);
		if (!resolved) return;

		if (initTarget.isLocal) {
			const existingDedicatedPath = profileLocalDedicatedPath(
				resolved.repoRoot,
				initTarget.profileName,
				resolved.agentsDir,
			);
			const inspected = await inspectProfileFiles(
				resolved.repoRoot,
				initTarget.profileName,
				resolved.agentsDir,
			);
			if (inspected.localDedicated.exists) {
				const displayPath = path
					.relative(resolved.repoRoot, existingDedicatedPath)
					.split(path.sep)
					.join("/");
				console.error(
					`Error: Local profile "${initTarget.profileName}" already exists at ${displayPath}.`,
				);
				process.exit(1);
				return;
			}
		}

		const targetPath = initTarget.isLocal
			? profileLocalSiblingPath(resolved.repoRoot, initTarget.profileName, resolved.agentsDir)
			: profileSharedPath(resolved.repoRoot, initTarget.profileName, resolved.agentsDir);
		const displayPath = path.relative(resolved.repoRoot, targetPath).split(path.sep).join("/");
		const starterContents = `${JSON.stringify(STARTER_PROFILE, null, 2)}\n`;
		try {
			await mkdir(path.dirname(targetPath), { recursive: true });
			await writeFile(targetPath, starterContents, { encoding: "utf8", flag: "wx" });
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "EEXIST") {
				const label = initTarget.isLocal ? "Local profile" : "Profile";
				console.error(
					`Error: ${label} "${initTarget.profileName}" already exists at ${displayPath}.`,
				);
				process.exit(1);
				return;
			}
			throw error;
		}

		console.log(initGuide(initTarget, displayPath));
	},
};

const listSubcommand: CommandModule = {
	command: "$0",
	describe: "List available sync profiles",
	builder: (yargs) =>
		yargs
			.option("agentsDir", {
				type: "string",
				describe: "Override the agents directory (relative paths resolve from the project root)",
				defaultDescription: DEFAULT_AGENTS_DIR,
			})
			.option("json", {
				type: "boolean",
				default: false,
				describe: "Output JSON",
			}),
	handler: async (argv) => {
		const typed = argv as unknown as ListArgs;
		const resolved = await resolveRepoAndAgentsDir(typed);
		if (!resolved) return;
		const entries = await listProfiles(resolved.repoRoot, resolved.agentsDir);
		if (typed.json) {
			console.log(JSON.stringify(entries, null, 2));
			return;
		}
		if (entries.length === 0) {
			console.log(
				"No profiles found. Create agents/profiles/<name>.json to define a sync profile.",
			);
			return;
		}
		const nameWidth = Math.max(8, ...entries.map((entry) => entry.name.length));
		for (const entry of entries) {
			const padded = entry.name.padEnd(nameWidth + 2, " ");
			const description = entry.description ?? "";
			const annotations = formatAnnotations(entry).join(" ");
			const parts = [padded, description, annotations].filter((part) => part.length > 0);
			console.log(parts.join(" ").trimEnd());
		}
	},
};

const showSubcommand: CommandModule = {
	command: "show <name>",
	describe: "Print the fully-resolved merged profile",
	builder: (yargs) =>
		yargs
			.positional("name", {
				type: "string",
				demandOption: true,
				describe: "Profile name (or comma-separated names)",
			})
			.option("agentsDir", {
				type: "string",
				describe: "Override the agents directory",
				defaultDescription: DEFAULT_AGENTS_DIR,
			})
			.option("json", {
				type: "boolean",
				default: false,
				describe: "Output JSON",
			}),
	handler: async (argv) => {
		const typed = argv as unknown as ShowArgs;
		const resolved = await resolveRepoAndAgentsDir(typed);
		if (!resolved) return;
		const names = typed.name
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean);
		if (names.length === 0) {
			console.error("Error: No profile name provided.");
			process.exit(1);
			return;
		}
		try {
			const resolvedProfile = await resolveProfiles(names, {
				repoRoot: resolved.repoRoot,
				agentsDir: resolved.agentsDir,
			});
			const output = {
				names: resolvedProfile.names,
				description: resolvedProfile.description,
				targets: resolvedProfile.targets,
				enable: resolvedProfile.enable,
				disable: resolvedProfile.disable,
				variables: resolvedProfile.variables,
				notices: resolvedProfile.notices,
			};
			console.log(JSON.stringify(output, null, 2));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`Error: ${message}`);
			process.exit(1);
		}
	},
};

const validateSubcommand: CommandModule = {
	command: "validate",
	describe: "Validate all profile files (non-zero exit on warnings or errors)",
	builder: (yargs) =>
		yargs.option("agentsDir", {
			type: "string",
			describe: "Override the agents directory",
			defaultDescription: DEFAULT_AGENTS_DIR,
		}),
	handler: async (argv) => {
		const typed = argv as unknown as ValidateArgs;
		const resolved = await resolveRepoAndAgentsDir(typed);
		if (!resolved) return;
		const listing = await listProfileDirectory(resolved.repoRoot, resolved.agentsDir);
		if (listing.length === 0) {
			console.log(`No profiles found (default: ${DEFAULT_PROFILE_NAME}).`);
			return;
		}
		let hasIssues = false;
		let validationCatalog: ProfileValidationCatalog | null = null;
		try {
			validationCatalog = await loadProfileValidationCatalog(resolved.repoRoot, resolved.agentsDir);
		} catch (error) {
			hasIssues = true;
			const message = error instanceof Error ? error.message : String(error);
			console.error(`Error: Failed to load catalogs for profile validation: ${message}`);
		}
		for (const entry of listing) {
			const inspected = await inspectProfileFiles(
				resolved.repoRoot,
				entry.name,
				resolved.agentsDir,
			);
			const sources = [inspected.shared, inspected.localSibling, inspected.localDedicated];
			const hasExistingSource = sources.some((source) => source.exists);
			if (!hasExistingSource) {
				continue;
			}
			let hasLoadIssues = false;
			for (const source of sources) {
				if (!source.exists || source.issues.length === 0) {
					continue;
				}
				hasIssues = true;
				hasLoadIssues = true;
				console.error(`Profile "${entry.name}" (${source.filePath}):`);
				for (const issue of source.issues) {
					console.error(`  - ${issue}`);
				}
			}
			if (hasLoadIssues) {
				continue;
			}
			try {
				const resolvedProfile = await resolveProfiles([entry.name], {
					repoRoot: resolved.repoRoot,
					agentsDir: resolved.agentsDir,
				});
				if (validationCatalog) {
					const issues = collectProfileReferenceIssues(
						entry.name,
						resolvedProfile,
						validationCatalog,
					);
					if (issues.length > 0) {
						hasIssues = true;
						console.error(`Profile "${entry.name}":`);
						for (const issue of issues) {
							console.error(`  - ${issue}`);
						}
					}
				}
				for (const notice of resolvedProfile.notices) {
					console.error(`Profile "${entry.name}" notice: ${notice}`);
				}
			} catch (error) {
				hasIssues = true;
				const message = error instanceof Error ? error.message : String(error);
				console.error(`Profile "${entry.name}" resolution failed: ${message}`);
			}
		}
		if (hasIssues) {
			process.exit(1);
			return;
		}
		console.log(`Validated ${listing.length} profile(s).`);
	},
};

export const profilesCommand: CommandModule = {
	command: "profiles",
	describe: "Inspect and validate sync profiles",
	builder: (yargs) =>
		yargs
			.command(listSubcommand)
			.command(initSubcommand)
			.command(showSubcommand)
			.command(validateSubcommand)
			.demandCommand(0)
			.strictCommands(),
	handler: () => {
		// Subcommand handlers do the work; the default list handler runs when no subcommand is given.
	},
};
