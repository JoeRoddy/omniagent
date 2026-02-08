import path from "node:path";
import { stripFrontmatterFields } from "../../../frontmatter-strip.js";
import type { TargetDefinition } from "../../config-types.js";

const TARGET_FRONTMATTER_KEYS = new Set(["targets", "targetagents"]);

type SlashCommandLike = {
	name: string;
	rawContents: string;
};

function isSlashCommandLike(value: unknown): value is SlashCommandLike {
	if (!value || typeof value !== "object") {
		return false;
	}
	const command = value as Partial<SlashCommandLike>;
	return typeof command.name === "string" && typeof command.rawContents === "string";
}

function renderPromptReference(agentName: string): string {
	return `---\nagent: ${JSON.stringify(agentName)}\n---\n`;
}

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
		subagents: "{repoRoot}/.github/agents/{itemName}.agent.md",
		commands: {
			projectPath: "{repoRoot}/.github/agents/{itemName}.agent.md",
			converter: {
				id: "copilot-command-to-agent-and-prompt",
				convert: (item, context) => {
					if (!isSlashCommandLike(item)) {
						return { error: "Invalid slash command payload for Copilot conversion." };
					}
					const agentPath = path.join(
						context.repoRoot,
						".github",
						"agents",
						`${item.name}.agent.md`,
					);
					const promptPath = path.join(
						context.repoRoot,
						".github",
						"prompts",
						`${item.name}.prompt.md`,
					);
					return {
						outputs: [
							{
								outputPath: agentPath,
								content: stripFrontmatterFields(item.rawContents, TARGET_FRONTMATTER_KEYS),
							},
							{
								outputPath: promptPath,
								content: renderPromptReference(item.name),
							},
						],
					};
				},
			},
		},
		instructions: {
			filename: "AGENTS.md",
			group: "agents",
		},
	},
};
