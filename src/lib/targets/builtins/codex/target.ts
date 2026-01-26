import type { TargetDefinition } from "../../config-types.js";

export const codexTarget: TargetDefinition = {
	id: "codex",
	displayName: "OpenAI Codex",
	cli: {
		modes: {
			interactive: { command: "codex" },
			oneShot: { command: "codex", args: ["exec"] },
		},
		prompt: { type: "positional", position: "last" },
		passthrough: { position: "before-prompt" },
		flags: {
			approval: {
				byMode: {
					interactive: {
						prompt: ["--ask-for-approval", "on-request"],
						"auto-edit": ["--full-auto"],
						yolo: ["--yolo"],
					},
					"one-shot": {
						prompt: null,
						"auto-edit": ["--full-auto"],
						yolo: ["--yolo"],
					},
				},
			},
			sandbox: {
				values: {
					"workspace-write": ["--sandbox", "workspace-write"],
					off: ["--sandbox", "danger-full-access"],
				},
			},
			output: {
				byMode: {
					"one-shot": {
						text: [],
						json: ["--json"],
						"stream-json": ["--json"],
					},
				},
			},
			model: { flag: ["-m"] },
			web: { on: ["--search"], off: ["--disable", "web_search_request"] },
		},
	},
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
