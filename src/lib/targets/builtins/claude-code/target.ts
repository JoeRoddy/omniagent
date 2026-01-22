import type { TargetDefinition } from "../../config-types.js";

export const claudeTarget: TargetDefinition = {
	id: "claude",
	displayName: "Claude Code",
	outputs: {
		skills: "{repoRoot}/.claude/skills/{itemName}",
		subagents: "{repoRoot}/.claude/agents/{itemName}.md",
		commands: {
			projectPath: "{repoRoot}/.claude/commands/{itemName}.md",
			userPath: "{homeDir}/.claude/commands/{itemName}.md",
		},
		instructions: {
			filename: "CLAUDE.md",
		},
	},
};
