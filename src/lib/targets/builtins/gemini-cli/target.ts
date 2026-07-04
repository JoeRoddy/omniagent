import type { TargetDefinition } from "../../config-types.js";

export const geminiTarget: TargetDefinition = {
	id: "gemini",
	displayName: "Gemini CLI",
	cli: {
		modes: {
			interactive: { command: "gemini" },
			oneShot: { command: "gemini" },
		},
		prompt: { type: "flag", flag: ["-p"] },
		flags: {
			approval: {
				values: {
					prompt: ["--approval-mode", "default"],
					"auto-edit": ["--approval-mode", "auto_edit"],
					yolo: ["--yolo"],
				},
			},
			sandbox: {
				values: {
					"workspace-write": ["--sandbox"],
					off: [],
				},
			},
			output: {
				byMode: {
					"one-shot": {
						text: [],
						json: ["--output-format", "json"],
						"stream-json": ["--output-format", "stream-json"],
					},
				},
			},
			model: { flag: ["--model"] },
			web: { on: [], off: null },
			structuredOutputFallback: {
				args: ["--output-format", "json"],
				extraction: { type: "json-envelope", field: "response" },
			},
		},
	},
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
	usage: {
		windows: ["model"],
		launch: {
			command: "gemini",
			// /model inspection does not need a model override; Gemini requires session-scoped trust.
			args: ["--skip-trust"],
			timeoutMs: 70_000,
		},
		extract: async (context) => {
			const { extractGeminiUsage } = await import("../../../usage/gemini.js");
			return extractGeminiUsage(context);
		},
	},
};
