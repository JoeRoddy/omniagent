import path from "node:path";

export type TargetName = "claude" | "codex" | "gemini" | "copilot";
export type Scope = "project" | "global";
export type FileFormat = "markdown" | "toml";

export type AgentCapabilityProfile = {
	name: TargetName;
	displayName: string;
	supportsSlashCommands: boolean;
	supportedScopes: Scope[];
	fileFormat: FileFormat;
	supportsDescription: boolean;
	supportsNamespaces: boolean;
};

export const SLASH_COMMAND_TARGETS: AgentCapabilityProfile[] = [
	{
		name: "claude",
		displayName: "Claude Code",
		supportsSlashCommands: true,
		supportedScopes: ["project", "global"],
		fileFormat: "markdown",
		supportsDescription: true,
		supportsNamespaces: true,
	},
	{
		name: "gemini",
		displayName: "Gemini CLI",
		supportsSlashCommands: true,
		supportedScopes: ["project", "global"],
		fileFormat: "toml",
		supportsDescription: true,
		supportsNamespaces: true,
	},
	{
		name: "codex",
		displayName: "OpenAI Codex",
		supportsSlashCommands: true,
		supportedScopes: ["global"],
		fileFormat: "markdown",
		supportsDescription: false,
		supportsNamespaces: false,
	},
	{
		name: "copilot",
		displayName: "GitHub Copilot CLI",
		supportsSlashCommands: false,
		supportedScopes: [],
		fileFormat: "markdown",
		supportsDescription: false,
		supportsNamespaces: false,
	},
];

const targetNameSet = new Set<TargetName>(SLASH_COMMAND_TARGETS.map((target) => target.name));

export function isSlashCommandTargetName(value: string): value is TargetName {
	return targetNameSet.has(value as TargetName);
}

export function getTargetProfile(name: TargetName): AgentCapabilityProfile {
	const profile = SLASH_COMMAND_TARGETS.find((target) => target.name === name);
	if (!profile) {
		throw new Error(`Unknown slash command target: ${name}`);
	}
	return profile;
}

const PROJECT_COMMAND_PATHS: Partial<Record<TargetName, string>> = {
	claude: path.join(".claude", "commands"),
	gemini: path.join(".gemini", "commands"),
};

const GLOBAL_COMMAND_PATHS: Partial<Record<TargetName, string>> = {
	claude: path.join(".claude", "commands"),
	gemini: path.join(".gemini", "commands"),
	codex: path.join(".codex", "prompts"),
};

export function resolveCommandDestination(
	targetName: TargetName,
	scope: Scope,
	repoRoot: string,
	homeDir: string,
): string {
	const relativePath =
		scope === "project" ? PROJECT_COMMAND_PATHS[targetName] : GLOBAL_COMMAND_PATHS[targetName];
	if (!relativePath) {
		throw new Error(`No ${scope} command destination for target ${targetName}.`);
	}
	const base = scope === "project" ? repoRoot : homeDir;
	return path.join(base, relativePath);
}

export function getDefaultScope(profile: AgentCapabilityProfile): Scope {
	if (profile.supportedScopes.includes("project")) {
		return "project";
	}
	return "global";
}
