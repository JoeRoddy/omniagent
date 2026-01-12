import path from "node:path";

export type SubagentTargetName = "claude" | "codex" | "copilot" | "gemini";

export type SubagentTargetProfile = {
	name: SubagentTargetName;
	displayName: string;
	supportsSubagents: boolean;
	subagentPath: string | null;
	skillPath: string;
};

const SUBAGENT_PATHS: Partial<Record<SubagentTargetName, string>> = {
	claude: path.join(".claude", "agents"),
};

const SKILL_PATHS: Record<SubagentTargetName, string> = {
	codex: path.join(".codex", "skills"),
	claude: path.join(".claude", "skills"),
	copilot: path.join(".github", "skills"),
	gemini: path.join(".gemini", "skills"),
};

export const SUBAGENT_TARGETS: SubagentTargetProfile[] = [
	{
		name: "claude",
		displayName: "Claude Code",
		supportsSubagents: true,
		subagentPath: SUBAGENT_PATHS.claude ?? null,
		skillPath: SKILL_PATHS.claude,
	},
	{
		name: "codex",
		displayName: "OpenAI Codex",
		supportsSubagents: false,
		subagentPath: null,
		skillPath: SKILL_PATHS.codex,
	},
	{
		name: "copilot",
		displayName: "GitHub Copilot CLI",
		supportsSubagents: false,
		subagentPath: null,
		skillPath: SKILL_PATHS.copilot,
	},
	{
		name: "gemini",
		displayName: "Gemini CLI",
		supportsSubagents: false,
		subagentPath: null,
		skillPath: SKILL_PATHS.gemini,
	},
];

const targetNameSet = new Set<SubagentTargetName>(SUBAGENT_TARGETS.map((target) => target.name));

export function isSubagentTargetName(value: string): value is SubagentTargetName {
	return targetNameSet.has(value as SubagentTargetName);
}

export function getSubagentProfile(name: SubagentTargetName): SubagentTargetProfile {
	const profile = SUBAGENT_TARGETS.find((target) => target.name === name);
	if (!profile) {
		throw new Error(`Unknown subagent target: ${name}`);
	}
	return profile;
}

export function resolveSubagentDirectory(targetName: SubagentTargetName, repoRoot: string): string {
	const profile = getSubagentProfile(targetName);
	if (!profile.subagentPath) {
		throw new Error(`Target ${targetName} does not support Claude-format subagents.`);
	}
	return path.join(repoRoot, profile.subagentPath);
}

export function resolveSkillDirectory(targetName: SubagentTargetName, repoRoot: string): string {
	const profile = getSubagentProfile(targetName);
	return path.join(repoRoot, profile.skillPath);
}
