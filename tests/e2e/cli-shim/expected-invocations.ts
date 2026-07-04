import {
	type AgentE2EConfig,
	PROMPT,
	type SHARED_CASES,
	STRUCTURED_PROMPT,
	STRUCTURED_SCHEMA,
} from "./cases.js";

export type ExpectedInvocation = {
	command: string;
	args: string[];
	warnings?: string[];
};

export const TMPFILE_PLACEHOLDER = "<TMPFILE>";

type CaseId = (typeof SHARED_CASES)[number]["id"];
type AgentId = "codex" | "claude" | "agy" | "copilot";
type ApprovalValue = "prompt" | "auto-edit" | "yolo";
type SandboxValue = "workspace-write" | "off";
type OutputValue = "text" | "json" | "stream-json";

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

function resolveApproval(caseId: CaseId): ApprovalValue {
	if (caseId === "approval-auto-edit" || caseId === "auto-edit-alias") {
		return "auto-edit";
	}
	if (caseId === "approval-yolo") {
		return "yolo";
	}
	return "prompt";
}

function resolveSandbox(caseId: CaseId): SandboxValue {
	if (caseId === "approval-yolo") {
		return "off";
	}
	return "workspace-write";
}

function resolveOutput(caseId: CaseId): OutputValue {
	switch (caseId) {
		case "output-json":
		case "output-flag-json":
			return "json";
		case "output-stream-json":
			return "stream-json";
		default:
			return "text";
	}
}

function buildCodexInvocation(
	agent: AgentE2EConfig,
	flags: string[],
	passthrough: string[],
	prefixFlags: string[] = [],
	prompt: string = PROMPT,
): ExpectedInvocation {
	return {
		command: agent.cliCommand,
		args: [...prefixFlags, "exec", ...flags, ...passthrough, prompt],
	};
}

function buildFlagPromptInvocation(
	agent: AgentE2EConfig,
	flags: string[],
	passthrough: string[],
	prompt: string = PROMPT,
): ExpectedInvocation {
	return {
		command: agent.cliCommand,
		args: [...flags, "-p", prompt, ...passthrough],
	};
}

function buildCodex(caseId: CaseId, agent: AgentE2EConfig): ExpectedInvocation | null {
	const passthrough =
		caseId === "passthrough"
			? collectPassthrough(agent, agent.passthroughArgs ?? [])
			: collectPassthrough(agent);
	const approval = resolveApproval(caseId);
	const sandbox = resolveSandbox(caseId);
	const output = resolveOutput(caseId);
	const flags: string[] = [];
	const prefixFlags: string[] = caseId === "web-on" ? ["--search"] : [];

	if (approval === "auto-edit") {
		flags.push("--full-auto");
	} else if (approval === "yolo") {
		flags.push("--yolo");
	}

	if (sandbox === "workspace-write") {
		flags.push("--sandbox", "workspace-write");
	} else {
		flags.push("--sandbox", "danger-full-access");
	}

	if (output === "json" || output === "stream-json") {
		flags.push("--json");
	}

	if (caseId === "model") {
		if (!agent.model) {
			return null;
		}
		flags.push("-m", agent.model);
	}

	if (agent.model && !flags.includes("-m")) {
		flags.push("-m", agent.model);
	}

	if (caseId !== "web-on") {
		flags.push("--disable", "web_search_request");
	}

	if (caseId === "output-schema-inline") {
		flags.push(
			"--output-schema",
			TMPFILE_PLACEHOLDER,
			"--output-last-message",
			TMPFILE_PLACEHOLDER,
		);
		return buildCodexInvocation(agent, flags, passthrough, prefixFlags, STRUCTURED_PROMPT);
	}

	if (caseId === "web-on") {
		return buildCodexInvocation(agent, flags, passthrough, prefixFlags);
	}

	if (
		caseId !== "basic-oneshot" &&
		caseId !== "approval-auto-edit" &&
		caseId !== "auto-edit-alias" &&
		caseId !== "approval-yolo" &&
		caseId !== "sandbox-workspace-write" &&
		caseId !== "output-json" &&
		caseId !== "output-flag-json" &&
		caseId !== "output-stream-json" &&
		caseId !== "model" &&
		caseId !== "passthrough"
	) {
		return null;
	}

	return buildCodexInvocation(agent, flags, passthrough, prefixFlags);
}

function buildClaude(caseId: CaseId, agent: AgentE2EConfig): ExpectedInvocation | null {
	const passthrough =
		caseId === "passthrough"
			? collectPassthrough(agent, agent.passthroughArgs ?? [])
			: collectPassthrough(agent);
	let flags: string[] = [];
	let prompt = PROMPT;
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
		case "output-schema-inline":
			flags = ["--json-schema", STRUCTURED_SCHEMA, "--output-format", "json"];
			prompt = STRUCTURED_PROMPT;
			break;
		default:
			return null;
	}

	const invocation = buildFlagPromptInvocation(agent, flags, passthrough, prompt);
	return withWarnings(invocation, warnings);
}

function buildAgy(caseId: CaseId, agent: AgentE2EConfig): ExpectedInvocation | null {
	const passthrough =
		caseId === "passthrough"
			? collectPassthrough(agent, agent.passthroughArgs ?? [])
			: collectPassthrough(agent);
	let flags: string[] = ["--sandbox"];
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
			flags = ["--sandbox", "--model", agent.model];
			break;
		case "passthrough":
			break;
		default:
			return null;
	}

	const invocation = buildFlagPromptInvocation(agent, flags, passthrough);
	return withWarnings(invocation, warnings);
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
			flags = ["--output-format", "json"];
			break;
		case "output-stream-json":
			flags = ["--output-format", "json"];
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
		case "agy":
			return buildAgy(caseId, agent);
		case "copilot":
			return buildCopilot(caseId, agent);
		default:
			return null;
	}
}
