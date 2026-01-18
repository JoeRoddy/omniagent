import type { TargetName } from "../sync-targets.js";

export type InstructionTargetName = TargetName;
export type InstructionTargetGroup = "claude" | "gemini" | "agents";

const TARGET_FILE_NAMES: Record<InstructionTargetName, string> = {
	claude: "CLAUDE.md",
	gemini: "GEMINI.md",
	codex: "AGENTS.md",
	copilot: "AGENTS.md",
};

export function resolveInstructionFileName(targetName: InstructionTargetName): string {
	return TARGET_FILE_NAMES[targetName];
}

export function isAgentsTarget(
	targetName: InstructionTargetName,
): targetName is Extract<InstructionTargetName, "codex" | "copilot"> {
	return targetName === "codex" || targetName === "copilot";
}

export function resolveInstructionTargetGroup(
	targetName: InstructionTargetName,
): InstructionTargetGroup {
	return isAgentsTarget(targetName) ? "agents" : targetName;
}
