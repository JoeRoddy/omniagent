import type { TargetDefinition } from "../../config-types.js";

export const geminiTarget: TargetDefinition = {
	id: "gemini",
	displayName: "Gemini CLI",
	outputs: {
		skills: "{repoRoot}/.gemini/skills/{itemName}",
		subagents: {
			path: "{repoRoot}/.gemini/skills/{itemName}",
			fallback: { mode: "convert", targetType: "skills" },
		},
		commands: {
			projectPath: "{repoRoot}/.gemini/commands/{itemName}.toml",
			userPath: "{homeDir}/.gemini/commands/{itemName}.toml",
		},
		instructions: {
			filename: "GEMINI.md",
		},
	},
};
