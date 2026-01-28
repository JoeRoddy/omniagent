import type { TargetDefinition } from "../../config-types.js";

export const copilotTarget: TargetDefinition = {
	id: "copilot",
	displayName: "GitHub Copilot CLI",
	cli: {
		modes: {
			interactive: { command: "copilot" },
			oneShot: { command: "copilot" },
		},
		prompt: { type: "flag", flag: ["-p"] },
		flags: {
			approval: {
				values: {
					prompt: null,
					"auto-edit": null,
					yolo: ["--allow-all-tools"],
				},
			},
			model: { flag: ["--model"] },
		},
	},
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
