import type { CommandModule } from "yargs";
import { DEFAULT_AGENTS_DIR, resolveAgentsDir, validateAgentsDir } from "../../lib/agents-dir.js";
import {
	createProfileItemFilter,
	DEFAULT_PROFILE_NAME,
	inspectProfileFiles,
	listProfileDirectory,
	listProfiles,
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

type ProfileValidationCatalog = {
	resolveTargetName: (value: string) => string | null;
	skills: SkillDefinition[];
	commands: SlashCommandDefinition[];
	subagents: SubagentDefinition[];
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
			.command(showSubcommand)
			.command(validateSubcommand)
			.demandCommand(0)
			.strictCommands(),
	handler: () => {
		// Subcommand handlers do the work; the default list handler runs when no subcommand is given.
	},
};
