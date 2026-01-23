import type { AgentId } from "../../lib/targets/config-types.js";
import type { ApprovalPolicy, OutputFormat, SandboxMode } from "./types.js";

export type AgentCapability = {
	id: AgentId;
	command: string;
	promptFlag: string[];
	supports: {
		approval: boolean;
		sandbox: boolean;
		output: boolean;
		model: boolean;
		web: boolean;
	};
	flags: {
		approval?: Record<ApprovalPolicy, string[]>;
		sandbox?: Record<SandboxMode, string[]>;
		output?: Record<OutputFormat, string[]>;
		model?: (value: string) => string[];
		web?: {
			on: string[];
			off?: string[];
		};
	};
};

const SHIM_APPROVAL_FLAGS: Record<ApprovalPolicy, string[]> = {
	prompt: ["--approval", "prompt"],
	"auto-edit": ["--approval", "auto-edit"],
	yolo: ["--approval", "yolo"],
};

const SHIM_SANDBOX_FLAGS: Record<SandboxMode, string[]> = {
	"workspace-write": ["--sandbox", "workspace-write"],
	off: ["--sandbox", "off"],
};

const SHIM_OUTPUT_FLAGS: Record<OutputFormat, string[]> = {
	text: ["--output", "text"],
	json: ["--output", "json"],
	"stream-json": ["--output", "stream-json"],
};

const SHIM_WEB_FLAGS = {
	on: ["--web", "on"],
	off: ["--web", "off"],
};

const CAPABILITIES: Record<AgentId, AgentCapability> = {
	claude: {
		id: "claude",
		command: "claude",
		promptFlag: ["-p"],
		supports: {
			approval: true,
			sandbox: false,
			output: false,
			model: true,
			web: false,
		},
		flags: {
			approval: SHIM_APPROVAL_FLAGS,
			model: (value) => ["--model", value],
		},
	},
	codex: {
		id: "codex",
		command: "codex",
		promptFlag: ["-p"],
		supports: {
			approval: true,
			sandbox: true,
			output: true,
			model: true,
			web: true,
		},
		flags: {
			approval: SHIM_APPROVAL_FLAGS,
			sandbox: SHIM_SANDBOX_FLAGS,
			output: SHIM_OUTPUT_FLAGS,
			model: (value) => ["--model", value],
			web: SHIM_WEB_FLAGS,
		},
	},
	gemini: {
		id: "gemini",
		command: "gemini",
		promptFlag: ["--prompt"],
		supports: {
			approval: true,
			sandbox: false,
			output: false,
			model: true,
			web: true,
		},
		flags: {
			approval: SHIM_APPROVAL_FLAGS,
			model: (value) => ["--model", value],
			web: SHIM_WEB_FLAGS,
		},
	},
	copilot: {
		id: "copilot",
		command: "copilot",
		promptFlag: ["-p"],
		supports: {
			approval: true,
			sandbox: false,
			output: false,
			model: false,
			web: false,
		},
		flags: {
			approval: SHIM_APPROVAL_FLAGS,
		},
	},
};

export function getAgentCapability(id: AgentId): AgentCapability {
	return CAPABILITIES[id];
}

export function listAgentCapabilities(): AgentCapability[] {
	return Object.values(CAPABILITIES);
}
