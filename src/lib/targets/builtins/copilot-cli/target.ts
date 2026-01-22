import type { TargetDefinition } from "../../config-types.js";

export const copilotTarget: TargetDefinition = {
	id: "copilot",
	displayName: "GitHub Copilot CLI",
	outputs: {
		skills: "{repoRoot}/.github/skills/{itemName}",
		subagents: {
			path: "{repoRoot}/.github/skills/{itemName}",
			fallback: { mode: "convert", targetType: "skills" },
		},
		commands: {
			projectPath: "{repoRoot}/.github/skills/{itemName}",
			fallback: { mode: "convert", targetType: "skills" },
		},
		instructions: {
			filename: "AGENTS.md",
			group: "agents",
		},
	},
};
