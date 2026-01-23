import type { AgentId } from "../../lib/targets/config-types.js";

export const APPROVAL_POLICIES = ["prompt", "auto-edit", "yolo"] as const;
export type ApprovalPolicy = (typeof APPROVAL_POLICIES)[number];

export const SANDBOX_MODES = ["workspace-write", "off"] as const;
export type SandboxMode = (typeof SANDBOX_MODES)[number];

export const OUTPUT_FORMATS = ["text", "json", "stream-json"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export type InvocationMode = "interactive" | "one-shot";

export type FlagSource = "default" | "flag" | "alias" | "derived";

export type FlagValue<T> = {
	value: T;
	source: FlagSource;
	explicit: boolean;
};

export type ParsedShimFlags = {
	prompt: string | null;
	promptExplicit: boolean;
	approval: ApprovalPolicy;
	approvalExplicit: boolean;
	sandbox: SandboxMode;
	sandboxExplicit: boolean;
	output: OutputFormat;
	outputExplicit: boolean;
	model: string | null;
	modelExplicit: boolean;
	web: boolean;
	webExplicit: boolean;
	agent: AgentId | null;
	agentExplicit: boolean;
	help: boolean;
	version: boolean;
	hasDelimiter: boolean;
	passthroughArgs: string[];
};

export type SessionConfiguration = {
	approvalPolicy: ApprovalPolicy;
	sandbox: SandboxMode;
	outputFormat: OutputFormat;
	model: string | null;
	webEnabled: boolean;
	sandboxExplicit: boolean;
};

export type AgentSelection = {
	id: AgentId;
	source: "flag" | "config";
	configPath: string | null;
};

export type AgentPassthrough = {
	hasDelimiter: boolean;
	args: string[];
};

export type FlagRequests = {
	approval?: ApprovalPolicy;
	sandbox?: SandboxMode;
	output?: OutputFormat;
	model?: string;
	web?: boolean;
};

export type ResolvedInvocation = {
	mode: InvocationMode;
	prompt: string | null;
	usesPipedStdin: boolean;
	agent: AgentSelection;
	session: SessionConfiguration;
	requests: FlagRequests;
	passthrough: AgentPassthrough;
};
