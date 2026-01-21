import type { TargetDefinition } from "./config-types.js";

export const BUILTIN_TARGETS: TargetDefinition[] = [
	{
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
	},
	{
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
	},
	{
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
	},
	{
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
	},
];

export const BUILTIN_TARGET_IDS = Object.freeze(BUILTIN_TARGETS.map((target) => target.id));
