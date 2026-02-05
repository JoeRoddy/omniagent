import {
	agentConfig as claudeConfig,
	expectedDir as claudeExpectedDir,
} from "../../../src/lib/targets/builtins/claude-code/e2e/agent.config.js";
import {
	agentConfig as codexConfig,
	expectedDir as codexExpectedDir,
} from "../../../src/lib/targets/builtins/codex/e2e/agent.config.js";
import {
	agentConfig as copilotConfig,
	expectedDir as copilotExpectedDir,
} from "../../../src/lib/targets/builtins/copilot-cli/e2e/agent.config.js";
import {
	agentConfig as geminiConfig,
	expectedDir as geminiExpectedDir,
} from "../../../src/lib/targets/builtins/gemini-cli/e2e/agent.config.js";
import type { AgentE2EConfig } from "./cases.js";

export type AgentModule = {
	agentConfig: AgentE2EConfig;
	expectedDir: string | URL;
};

export const AGENT_MODULES: AgentModule[] = [
	{ agentConfig: codexConfig, expectedDir: codexExpectedDir },
	{ agentConfig: claudeConfig, expectedDir: claudeExpectedDir },
	{ agentConfig: geminiConfig, expectedDir: geminiExpectedDir },
	{ agentConfig: copilotConfig, expectedDir: copilotExpectedDir },
];
