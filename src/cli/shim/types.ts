import type { ResolvedTarget } from "../../lib/targets/config-types.js";
import {
	APPROVAL_POLICIES,
	type ApprovalPolicy,
	type InvocationMode,
	OUTPUT_FORMATS,
	type OutputFormat,
	SANDBOX_MODES,
	type SandboxMode,
} from "../../lib/targets/config-types.js";

export {
	APPROVAL_POLICIES,
	type ApprovalPolicy,
	OUTPUT_FORMATS,
	type OutputFormat,
	SANDBOX_MODES,
	type SandboxMode,
};

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
	agent: string | null;
	agentExplicit: boolean;
	traceTranslate: boolean;
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
	approvalExplicit: boolean;
	sandboxExplicit: boolean;
	outputExplicit: boolean;
	modelExplicit: boolean;
	webExplicit: boolean;
};

export type AgentSelection = {
	id: string;
	source: "flag" | "config";
	configPath: string | null;
};

export type AgentPassthrough = {
	hasDelimiter: boolean;
	args: string[];
};

export type FlagRequests = {
	approval: ApprovalPolicy;
	sandbox: SandboxMode;
	output: OutputFormat;
	model?: string;
	web: boolean;
};

export type ResolvedInvocation = {
	mode: InvocationMode;
	prompt: string | null;
	usesPipedStdin: boolean;
	agent: AgentSelection;
	target: ResolvedTarget;
	session: SessionConfiguration;
	requests: FlagRequests;
	passthrough: AgentPassthrough;
};
