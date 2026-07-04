import { agyTarget } from "./builtins/antigravity-cli/target.js";
import { claudeTarget } from "./builtins/claude-code/target.js";
import { codexTarget } from "./builtins/codex/target.js";
import { copilotTarget } from "./builtins/copilot-cli/target.js";
import type { TargetDefinition } from "./config-types.js";

export const BUILTIN_TARGETS: TargetDefinition[] = [
	codexTarget,
	claudeTarget,
	agyTarget,
	copilotTarget,
];

export const BUILTIN_TARGET_IDS = Object.freeze(BUILTIN_TARGETS.map((target) => target.id));
