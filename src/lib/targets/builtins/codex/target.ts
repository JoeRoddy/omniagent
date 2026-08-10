import {
	listCodexFiles,
	normalizeCodexLine,
	prefilterCodexLine,
	resumeCodexSession,
} from "../../../history/codex.js";
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
		passthrough: {
			position: "before-prompt",
			collisions: [
				{ option: "--ask-for-approval", sources: ["approval"] },
				{ option: "-a", allowAttachedValue: true, sources: ["approval"] },
				{ option: "--full-auto", sources: ["approval", "sandbox"] },
				{ option: "--yolo", sources: ["approval", "sandbox"] },
				{
					option: "--dangerously-bypass-approvals-and-sandbox",
					sources: ["approval", "sandbox"],
				},
				{ option: "--sandbox", sources: ["sandbox"] },
				{ option: "-s", allowAttachedValue: true, sources: ["sandbox"] },
				{ option: "--json", sources: ["output"], modes: ["one-shot"] },
				{ option: "--experimental-json", sources: ["output"], modes: ["one-shot"] },
				{ option: "--model", sources: ["model"] },
				{ option: "-m", allowAttachedValue: true, sources: ["model"] },
				{ option: "--search", sources: ["web"] },
				{ option: "-c", value: 'web_search="disabled"', sources: ["web"] },
				// Keep recognizing the legacy toggle when users pass it through explicitly.
				{ option: "--disable", value: "web_search_request", sources: ["web"] },
				{
					option: "--output-schema",
					sources: ["structuredOutput"],
					modes: ["one-shot"],
				},
				{
					option: "--output-last-message",
					sources: ["structuredOutput"],
					modes: ["one-shot"],
				},
				{
					option: "-o",
					allowAttachedValue: true,
					sources: ["structuredOutput"],
					modes: ["one-shot"],
				},
			],
		},
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
			web: { on: ["--search"], off: ["-c", 'web_search="disabled"'] },
			structuredOutput: {
				delivery: "file",
				flag: ["--output-schema"],
				extraction: { type: "last-message-file", flag: ["--output-last-message"] },
			},
		},
	},
	outputs: {
		skills: "{repoRoot}/.codex/skills/{itemName}",
		subagents: {
			path: "{repoRoot}/.codex/skills/{itemName}",
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
		windows: ["hourly", "weekly"],
		launch: {
			command: "codex",
			// Usage probing does not need plugins/apps; disabling them avoids MCP startup work.
			args: [
				"--no-alt-screen",
				"--disable",
				"apps",
				"--disable",
				"computer_use",
				"--disable",
				"plugins",
			],
			timeoutMs: 60_000,
		},
		extract: async (context) => {
			const { extractCodexUsage } = await import("../../../usage/codex.js");
			return extractCodexUsage(context);
		},
	},
	history: {
		// Codex persists nothing equivalent to a subagent transcript, so it declares partial
		// support rather than silently returning no rows for `--role agent`.
		roles: ["user", "assistant"],
		listFiles: listCodexFiles,
		prefilter: prefilterCodexLine,
		normalize: normalizeCodexLine,
		resume: resumeCodexSession,
	},
};
