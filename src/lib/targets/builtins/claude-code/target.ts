import {
	listClaudeFiles,
	normalizeClaudeLine,
	prefilterClaudeLine,
	resumeClaudeSession,
} from "../../../history/claude.js";
import type { TargetDefinition } from "../../config-types.js";

export const claudeTarget: TargetDefinition = {
	id: "claude",
	displayName: "Claude Code",
	cli: {
		modes: {
			interactive: { command: "claude" },
			oneShot: { command: "claude" },
		},
		prompt: { type: "flag", flag: ["-p"] },
		passthrough: {
			collisions: [
				{
					option: "-p",
					allowAttachedValue: true,
					sources: ["prompt"],
					modes: ["one-shot"],
				},
				{ option: "--print", sources: ["prompt"], modes: ["one-shot"] },
				{ option: "--dangerously-skip-permissions", sources: ["approval"] },
				{ option: "--model", sources: ["model"] },
				{ option: "--output-format", sources: ["output", "structuredOutput"] },
				{
					option: "--json-schema",
					sources: ["structuredOutput"],
					modes: ["one-shot"],
				},
			],
		},
		flags: {
			approval: {
				values: {
					prompt: [],
					"auto-edit": null,
					yolo: ["--dangerously-skip-permissions"],
				},
			},
			output: {
				byMode: {
					"one-shot": {
						text: [],
						json: ["--output-format", "json"],
						"stream-json": ["--output-format", "stream-json", "--verbose"],
					},
				},
			},
			model: { flag: ["--model"] },
			structuredOutput: {
				delivery: "inline",
				flag: ["--json-schema"],
				companionArgs: ["--output-format", "json"],
				extraction: { type: "json-envelope", field: "structured_output" },
			},
		},
	},
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
	usage: {
		windows: ["hourly", "weekly"],
		launch: {
			command: "claude",
			// Haiku keeps the interactive usage probe on Claude's lowest-cost model family.
			args: ["--model", "haiku"],
			cheapModel: "haiku",
			timeoutMs: 60_000,
		},
		extract: async (context) => {
			const { extractClaudeUsage } = await import("../../../usage/claude.js");
			return extractClaudeUsage(context);
		},
	},
	// Everything Claude-specific about searching history lives here, not in the search engine:
	// where transcripts are, how the cwd is encoded into a directory name, which record shapes
	// count as messages, and how to get back into a session.
	// Imported statically rather than through a lazy thunk (as `usage.extract` does) because
	// `normalize` runs per line and must stay synchronous, so deferring the import buys nothing.
	history: {
		// Subagent transcripts are on disk, so Claude can answer for all three roles.
		roles: ["user", "assistant", "agent"],
		listFiles: listClaudeFiles,
		prefilter: prefilterClaudeLine,
		normalize: normalizeClaudeLine,
		resume: resumeClaudeSession,
	},
};
