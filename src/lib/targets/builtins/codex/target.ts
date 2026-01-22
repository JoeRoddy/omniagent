import type { TargetDefinition } from "../../config-types.js";

export const codexTarget: TargetDefinition = {
	id: "codex",
	displayName: "OpenAI Codex",
	outputs: {
		skills: "{repoRoot}/.codex/skills/{itemName}",
		subagents: {
			path: "{repoRoot}/.codex/skills/{itemName}",
			fallback: { mode: "convert", targetType: "skills" },
		},
		commands: {
			userPath: "{homeDir}/.codex/prompts/{itemName}.md",
		},
		instructions: {
			filename: "AGENTS.md",
			group: "agents",
		},
	},
};
