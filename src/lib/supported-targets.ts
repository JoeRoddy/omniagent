import { SLASH_COMMAND_TARGETS } from "./slash-commands/targets.js";
import { SUBAGENT_TARGETS } from "./subagents/targets.js";
import { TARGETS } from "./sync-targets.js";

function buildSupportedAgents(): string[] {
	const names = new Set<string>();

	for (const target of TARGETS) {
		names.add(target.name);
	}
	for (const target of SLASH_COMMAND_TARGETS) {
		names.add(target.name);
	}
	for (const target of SUBAGENT_TARGETS) {
		names.add(target.name);
	}

	return Array.from(names);
}

export const SUPPORTED_AGENT_NAMES = Object.freeze(buildSupportedAgents());
