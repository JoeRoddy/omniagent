export type AgentE2EConfig = {
	agentId: string;
	cliCommand: string;
	model?: string | null;
	// Declared by a target whose definition ships a model alias table, so the shared harness never
	// needs to know which agents have one.
	modelAlias?: { alias: string; resolved: string };
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
	// A case that drives a shared flag the agent config also pins through passthrough has to drop
	// those defaults, otherwise the shim rejects the run as a passthrough/shared-flag conflict.
	omitPassthroughDefaults?: boolean;
	// How the case is verified. Omitted means it compares against recorded stdout/stderr baselines,
	// and the suite fails if those artifacts are missing. Declare an assertion mode only when a
	// baseline cannot be recorded reliably:
	//   "structured" - parses the run's stdout payload and asserts the translated argv.
	//   "trace"      - asserts only the translated argv, for flags whose baseline is unrecordable.
	// Exemptions live here rather than in the runner so a deleted baseline still fails loudly.
	assertion?: "structured" | "trace";
	skipWhen?: (agent: AgentE2EConfig) => string | null;
};

export const PROMPT = "Output exactly: 5";

export const STRUCTURED_PROMPT = "Set answer to the integer 5.";

export const STRUCTURED_SCHEMA = JSON.stringify({
	type: "object",
	properties: { answer: { type: "integer" } },
	required: ["answer"],
	additionalProperties: false,
});

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
		id: "effort-high",
		buildArgs: () => ["-p", PROMPT, "--effort", "high"],
		omitPassthroughDefaults: true,
		// The committed codex baselines pin a model this repo can no longer record against, so the
		// effort mapping is asserted from the translated argv instead of recorded agent output.
		assertion: "trace",
	},
	{
		id: "model",
		buildArgs: (agent) => ["-p", PROMPT, "--model", agent.model ?? ""],
		skipWhen: (agent) => (agent.model ? null : "model not configured"),
	},
	{
		id: "model-alias",
		buildArgs: (agent) => ["-p", PROMPT, "-m", agent.modelAlias?.alias ?? ""],
		skipWhen: (agent) => (agent.modelAlias ? null : "no model aliases declared"),
		// The alias expansion is a translation concern, so it is asserted from the argv rather than
		// from recorded agent output.
		assertion: "trace",
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
	{
		id: "output-schema-inline",
		buildArgs: () => ["-p", STRUCTURED_PROMPT, "--output-schema", STRUCTURED_SCHEMA],
		// Structured runs involve nondeterministic temp paths and model output.
		assertion: "structured",
	},
];
