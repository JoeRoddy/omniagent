import { type AgentE2EConfig, PROMPT, type SHARED_CASES } from "./cases.js";

export type ExpectedInvocation = {
	command: string;
	args: string[];
	warnings?: string[];
};

type CaseId = (typeof SHARED_CASES)[number]["id"];
type AgentId = "codex" | "claude" | "gemini" | "copilot";

function formatWarning(agentId: string, flag: string, value?: string): string {
	const suffix = value ? ` (${value})` : "";
	return `Warning: ${agentId} does not support ${flag}${suffix}; ignoring.`;
}

function withWarnings(
	invocation: ExpectedInvocation,
	warnings: string[] | undefined,
): ExpectedInvocation {
	if (!warnings || warnings.length === 0) {
		return invocation;
	}
	return { ...invocation, warnings };
}

function collectPassthrough(agent: AgentE2EConfig, extra: string[] = []): string[] {
	return [...(agent.passthroughDefaults ?? []), ...extra];
}

function buildCodexInvocation(
	agent: AgentE2EConfig,
	flags: string[],
	passthrough: string[],
	prefixFlags: string[] = [],
): ExpectedInvocation {
	return {
		command: agent.cliCommand,
		args: [...prefixFlags, "exec", ...flags, ...passthrough, PROMPT],
	};
}

function buildFlagPromptInvocation(
	agent: AgentE2EConfig,
	flags: string[],
	passthrough: string[],
): ExpectedInvocation {
	return {
		command: agent.cliCommand,
		args: [...flags, "-p", PROMPT, ...passthrough],
	};
}

function buildCodex(caseId: CaseId, agent: AgentE2EConfig): ExpectedInvocation | null {
	const passthrough =
		caseId === "passthrough"
			? collectPassthrough(agent, agent.passthroughArgs ?? [])
			: collectPassthrough(agent);
	let flags: string[] = [];

	switch (caseId) {
		case "basic-oneshot":
			break;
		case "approval-auto-edit":
		case "auto-edit-alias":
			flags = ["--full-auto"];
			break;
		case "approval-yolo":
			flags = ["--yolo", "--sandbox", "danger-full-access"];
			break;
		case "sandbox-workspace-write":
			flags = ["--sandbox", "workspace-write"];
			break;
		case "output-json":
		case "output-flag-json":
		case "output-stream-json":
			flags = ["--json"];
			break;
		case "web-on":
			return buildCodexInvocation(agent, [], passthrough, ["--search"]);
		case "model":
			if (!agent.model) {
				return null;
			}
			flags = ["-m", agent.model];
			break;
		case "passthrough":
			break;
		default:
			return null;
	}

	return buildCodexInvocation(agent, flags, passthrough);
}

function buildClaude(caseId: CaseId, agent: AgentE2EConfig): ExpectedInvocation | null {
	const passthrough =
		caseId === "passthrough"
			? collectPassthrough(agent, agent.passthroughArgs ?? [])
			: collectPassthrough(agent);
	let flags: string[] = [];
	const warnings: string[] = [];

	switch (caseId) {
		case "basic-oneshot":
			break;
		case "approval-auto-edit":
		case "auto-edit-alias":
			warnings.push(formatWarning(agent.agentId, "--approval", "auto-edit"));
			break;
		case "approval-yolo":
			flags = ["--dangerously-skip-permissions"];
			break;
		case "sandbox-workspace-write":
			warnings.push(formatWarning(agent.agentId, "--sandbox", "workspace-write"));
			break;
		case "output-json":
		case "output-flag-json":
			flags = ["--output-format", "json"];
			break;
		case "output-stream-json":
			flags = ["--output-format", "stream-json", "--verbose"];
			break;
		case "web-on":
			warnings.push(formatWarning(agent.agentId, "--web", "on"));
			break;
		case "model":
			if (!agent.model) {
				return null;
			}
			flags = ["--model", agent.model];
			break;
		case "passthrough":
			break;
		default:
			return null;
	}

	const invocation = buildFlagPromptInvocation(agent, flags, passthrough);
	return withWarnings(invocation, warnings);
}

function buildGemini(caseId: CaseId, agent: AgentE2EConfig): ExpectedInvocation | null {
	const passthrough =
		caseId === "passthrough"
			? collectPassthrough(agent, agent.passthroughArgs ?? [])
			: collectPassthrough(agent);
	let flags: string[] = [];

	switch (caseId) {
		case "basic-oneshot":
			break;
		case "approval-auto-edit":
		case "auto-edit-alias":
			flags = ["--approval-mode", "auto_edit"];
			break;
		case "approval-yolo":
			flags = ["--yolo"];
			break;
		case "sandbox-workspace-write":
			flags = ["--sandbox"];
			break;
		case "output-json":
		case "output-flag-json":
			flags = ["--output-format", "json"];
			break;
		case "output-stream-json":
			flags = ["--output-format", "stream-json"];
			break;
		case "web-on":
			break;
		case "model":
			if (!agent.model) {
				return null;
			}
			flags = ["--model", agent.model];
			break;
		case "passthrough":
			break;
		default:
			return null;
	}

	return buildFlagPromptInvocation(agent, flags, passthrough);
}

function buildCopilot(caseId: CaseId, agent: AgentE2EConfig): ExpectedInvocation | null {
	const passthrough =
		caseId === "passthrough"
			? collectPassthrough(agent, agent.passthroughArgs ?? [])
			: collectPassthrough(agent);
	let flags: string[] = [];
	const warnings: string[] = [];

	switch (caseId) {
		case "basic-oneshot":
			break;
		case "approval-auto-edit":
		case "auto-edit-alias":
			warnings.push(formatWarning(agent.agentId, "--approval", "auto-edit"));
			break;
		case "approval-yolo":
			flags = ["--allow-all-tools"];
			break;
		case "sandbox-workspace-write":
			warnings.push(formatWarning(agent.agentId, "--sandbox", "workspace-write"));
			break;
		case "output-json":
		case "output-flag-json":
			warnings.push(formatWarning(agent.agentId, "--output", "json"));
			break;
		case "output-stream-json":
			warnings.push(formatWarning(agent.agentId, "--output", "stream-json"));
			break;
		case "web-on":
			warnings.push(formatWarning(agent.agentId, "--web", "on"));
			break;
		case "model":
			if (!agent.model) {
				return null;
			}
			flags = ["--model", agent.model];
			break;
		case "passthrough":
			break;
		default:
			return null;
	}

	const invocation = buildFlagPromptInvocation(agent, flags, passthrough);
	return withWarnings(invocation, warnings);
}

export function getExpectedInvocation(
	caseId: CaseId,
	agent: AgentE2EConfig,
): ExpectedInvocation | null {
	switch (agent.agentId as AgentId) {
		case "codex":
			return buildCodex(caseId, agent);
		case "claude":
			return buildClaude(caseId, agent);
		case "gemini":
			return buildGemini(caseId, agent);
		case "copilot":
			return buildCopilot(caseId, agent);
		default:
			return null;
	}
}
