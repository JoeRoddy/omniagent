export type AgentE2EConfig = {
	agentId: string;
	cliCommand: string;
	model?: string | null;
	requiredEnv?: string[];
	passthroughDefaults?: string[];
	passthroughArgs?: string[];
	timeoutMs?: number;
	extraEnv?: Record<string, string>;
};

export type ShimCase = {
	id: string;
	buildArgs: (agent: AgentE2EConfig) => string[];
	buildPassthrough?: (agent: AgentE2EConfig) => string[];
	skipWhen?: (agent: AgentE2EConfig) => string | null;
};

export const PROMPT = "Output exactly: 5";

export const SHARED_CASES: ShimCase[] = [
	{
		id: "basic-oneshot",
		buildArgs: () => ["-p", PROMPT],
	},
	{
		id: "approval-auto-edit",
		buildArgs: () => ["-p", PROMPT, "--approval", "auto-edit"],
	},
	{
		id: "auto-edit-alias",
		buildArgs: () => ["-p", PROMPT, "--auto-edit"],
	},
	{
		id: "approval-yolo",
		buildArgs: () => ["-p", PROMPT, "--yolo"],
	},
	{
		id: "sandbox-workspace-write",
		buildArgs: () => ["-p", PROMPT, "--sandbox", "workspace-write"],
	},
	{
		id: "output-json",
		buildArgs: () => ["-p", PROMPT, "--json"],
	},
	{
		id: "output-flag-json",
		buildArgs: () => ["-p", PROMPT, "--output", "json"],
	},
	{
		id: "output-stream-json",
		buildArgs: () => ["-p", PROMPT, "--stream-json"],
	},
	{
		id: "web-on",
		buildArgs: () => ["-p", PROMPT, "--web", "on"],
	},
	{
		id: "model",
		buildArgs: (agent) => ["-p", PROMPT, "--model", agent.model ?? ""],
		skipWhen: (agent) => (agent.model ? null : "model not configured"),
	},
	{
		id: "passthrough",
		buildArgs: () => ["-p", PROMPT],
		buildPassthrough: (agent) => agent.passthroughArgs ?? [],
		skipWhen: (agent) =>
			agent.passthroughArgs && agent.passthroughArgs.length > 0
				? null
				: "passthrough args not configured",
	},
];
