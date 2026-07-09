import type { TargetDefinition } from "../../config-types.js";

export const agyTarget: TargetDefinition = {
	id: "agy",
	displayName: "Antigravity CLI",
	aliases: ["gemini"],
	cli: {
		modes: {
			interactive: { command: "agy" },
			oneShot: { command: "agy" },
		},
		// agy requires the prompt as -p's argument; the shim always passes the
		// (possibly stdin-derived) prompt inline, so piped stdin works.
		prompt: { type: "flag", flag: ["-p"] },
		flags: {
			approval: {
				values: {
					prompt: [],
					"auto-edit": null,
					yolo: ["--dangerously-skip-permissions"],
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
						json: null,
						"stream-json": null,
					},
				},
			},
			// Model names are display strings, e.g. "Gemini 3.5 Flash (Low)"; list via `agy models`.
			model: { flag: ["--model"] },
			structuredOutputFallback: {
				extraction: { type: "text" },
			},
		},
	},
	outputs: {
		skills: "{repoRoot}/.agents/skills/{itemName}",
		subagents: {
			path: "{repoRoot}/.agents/skills/{itemName}",
			fallback: { mode: "convert", targetType: "skills" },
		},
		commands: {
			fallback: { mode: "convert", targetType: "skills" },
		},
		instructions: {
			filename: "AGENTS.md",
			group: "agents",
		},
	},
	usage: {
		windows: ["weekly"],
		launch: {
			command: "agy",
			timeoutMs: 70_000,
		},
		extract: async (context) => {
			const { extractAgyUsage } = await import("../../../usage/agy.js");
			return extractAgyUsage(context);
		},
	},
};
