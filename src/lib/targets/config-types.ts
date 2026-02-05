export const AGENT_IDS = ["claude", "codex", "gemini", "copilot"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const APPROVAL_POLICIES = ["prompt", "auto-edit", "yolo"] as const;
export type ApprovalPolicy = (typeof APPROVAL_POLICIES)[number];

export const SANDBOX_MODES = ["workspace-write", "off"] as const;
export type SandboxMode = (typeof SANDBOX_MODES)[number];

export const OUTPUT_FORMATS = ["text", "json", "stream-json"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export type InvocationMode = "interactive" | "one-shot";

export type CommandLocation = "project" | "user";
export type OutputType = "skills" | "commands" | "subagents" | "instructions";

export type OutputTemplateContext = {
	repoRoot: string;
	agentsDir: string;
	homeDir: string;
	targetId: string;
	commandLocation?: CommandLocation;
	itemName?: string;
};

export type OutputTemplateValue =
	| string
	| ((item: unknown, context: OutputTemplateContext) => string);

export type GeneratedOutput = {
	outputPath: string;
	content: string | Buffer;
};

export type ConverterDecision =
	| { output: GeneratedOutput }
	| { outputs: GeneratedOutput[] }
	| { skip: true }
	| { error: string };

export type ConverterContext = {
	repoRoot: string;
	agentsDir: string;
	homeDir: string;
	targetId: string;
	outputType: OutputType;
	commandLocation?: CommandLocation;
	validAgents: string[];
};

export type ConverterRule = {
	id?: string;
	convert: (
		item: unknown,
		context: ConverterContext,
	) => ConverterDecision | Promise<ConverterDecision>;
};

export type WriterContext = {
	repoRoot: string;
	agentsDir: string;
	homeDir: string;
	targetId: string;
	outputType: OutputType;
	commandLocation?: CommandLocation;
	validAgents: string[];
};

export type WriterResult = {
	status: "created" | "updated" | "skipped";
	contentHash?: string;
};

export type OutputWriter = {
	id: string;
	write: (options: {
		outputPath: string;
		content: string | Buffer;
		item?: unknown;
		context: WriterContext;
	}) => Promise<WriterResult>;
};

export type OutputWriterRef = OutputWriter | { id: string };
export type ConverterRef = ConverterRule | { id: string };

export type FallbackRule = {
	mode: "skip" | "convert";
	targetType?: OutputType;
};

export type OutputDefinition =
	| OutputTemplateValue
	| {
			path: OutputTemplateValue;
			writer?: OutputWriterRef;
			converter?: ConverterRef;
			fallback?: FallbackRule;
	  };

export type CommandOutputDefinition =
	| OutputTemplateValue
	| {
			projectPath?: OutputTemplateValue;
			userPath?: OutputTemplateValue;
			writer?: OutputWriterRef;
			converter?: ConverterRef;
			fallback?: FallbackRule;
	  };

export type InstructionOutputDefinition =
	| OutputTemplateValue
	| {
			filename: OutputTemplateValue;
			group?: string;
			writer?: OutputWriterRef;
			converter?: ConverterRef;
	  };

export type TargetOutputs = {
	skills?: OutputDefinition;
	commands?: CommandOutputDefinition;
	subagents?: OutputDefinition;
	instructions?: InstructionOutputDefinition;
};

export type ModeCommand = {
	command: string;
	args?: string[];
};

export type PromptSpec =
	| { type: "flag"; flag: string[] }
	| { type: "positional"; position?: "last" | "first" };

export type FlagMap<T extends string> = {
	values?: Partial<Record<T, string[] | null>>;
	byMode?: Partial<Record<InvocationMode, Partial<Record<T, string[] | null>>>>;
};

export type TargetCliDefinition = {
	modes: {
		interactive: ModeCommand;
		oneShot: ModeCommand;
	};
	prompt?: PromptSpec;
	flags?: {
		approval?: FlagMap<ApprovalPolicy>;
		sandbox?: FlagMap<SandboxMode>;
		output?: FlagMap<OutputFormat>;
		model?: { flag: string[]; modes?: InvocationMode[] };
		web?: { on?: string[] | null; off?: string[] | null; modes?: InvocationMode[] };
	};
	passthrough?: { position?: "after" | "before-prompt" };
	translate?: (invocation: TranslationInvocation) => TranslationResult;
};

export type TranslationInvocation = {
	mode: InvocationMode;
	prompt: string | null;
	usesPipedStdin: boolean;
	agent: {
		id: string;
		source: "flag" | "config";
		configPath: string | null;
	};
	session: {
		approvalPolicy: ApprovalPolicy;
		sandbox: SandboxMode;
		outputFormat: OutputFormat;
		model: string | null;
		webEnabled: boolean;
		sandboxExplicit: boolean;
	};
	requests: {
		approval?: ApprovalPolicy;
		sandbox?: SandboxMode;
		output?: OutputFormat;
		model?: string;
		web?: boolean;
	};
	passthrough: {
		hasDelimiter: boolean;
		args: string[];
	};
};

export type TranslationResult = {
	command: string;
	args: string[];
	warnings: string[];
};

export type HookContext = {
	repoRoot: string;
	agentsDir: string;
	targetId?: string;
	outputType?: OutputType;
};

export type HookHandler = (context: HookContext) => void | Promise<void>;

export type SyncHooks = {
	preSync?: HookHandler;
	postSync?: HookHandler;
	preConvert?: HookHandler;
	postConvert?: HookHandler;
};

export type TargetHooks = SyncHooks;

export type TargetDefinition = {
	id: string;
	displayName?: string;
	aliases?: string[];
	inherits?: string;
	override?: boolean;
	outputs?: TargetOutputs;
	cli?: TargetCliDefinition;
	hooks?: TargetHooks;
};

export type OmniagentConfig = {
	defaultAgent?: string;
	targets?: TargetDefinition[];
	disableTargets?: string[];
	hooks?: SyncHooks;
};

export type ResolvedTarget = {
	id: string;
	displayName: string;
	aliases: string[];
	outputs: TargetOutputs;
	cli?: TargetCliDefinition;
	hooks?: TargetHooks;
	isBuiltIn: boolean;
	isCustomized: boolean;
};
