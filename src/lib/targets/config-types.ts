import type { TargetHistoryDefinition } from "../history/types.js";
import type { TemplateScriptRuntime } from "../template-scripts.js";
import type { TargetUsageDefinition } from "../usage/types.js";

export type { TargetHistoryDefinition } from "../history/types.js";
export type { TargetUsageDefinition } from "../usage/types.js";

export const APPROVAL_POLICIES = ["prompt", "auto-edit", "yolo"] as const;
export type ApprovalPolicy = (typeof APPROVAL_POLICIES)[number];

export const SANDBOX_MODES = ["workspace-write", "off"] as const;
export type SandboxMode = (typeof SANDBOX_MODES)[number];

export const OUTPUT_FORMATS = ["text", "json", "stream-json"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

// Canonical effort ladder. Targets map these onto their own reasoning-effort surface and declare
// which levels they support; unset means "emit nothing" so agent-side defaults keep applying.
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export type InvocationMode = "interactive" | "one-shot";

export const PASSTHROUGH_COLLISION_SOURCES = [
	"mode",
	"prompt",
	"approval",
	"sandbox",
	"output",
	"model",
	"web",
	"effort",
	"structuredOutput",
] as const;
export type PassthroughCollisionSource = (typeof PASSTHROUGH_COLLISION_SOURCES)[number];

export type PassthroughCollisionRule = {
	option: string;
	value?: string;
	valuePrefix?: string;
	allowAttachedValue?: boolean;
	sources: PassthroughCollisionSource[];
	modes?: InvocationMode[];
};

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
	targetAliases?: string[];
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
	targetAliases?: string[];
	outputType: OutputType;
	commandLocation?: CommandLocation;
	validAgents: string[];
	templateScriptRuntime?: TemplateScriptRuntime;
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

export type StructuredOutputExtraction =
	| { type: "json-envelope"; field: string }
	| { type: "last-message-file"; flag: string[] };

export type StructuredOutputSpec = {
	delivery: "inline" | "file";
	flag: string[];
	companionArgs?: string[];
	extraction: StructuredOutputExtraction;
};

export type StructuredOutputFallbackExtraction =
	| { type: "text" }
	| { type: "json-envelope"; field: string };

export type StructuredOutputFallbackSpec = {
	args?: string[];
	extraction?: StructuredOutputFallbackExtraction;
};

export type StructuredOutputCapture =
	| { type: "json-envelope"; field: string }
	| { type: "last-message-file"; path: string }
	| { type: "fallback"; extraction: StructuredOutputFallbackExtraction; maxAttempts: number };

export type StructuredOutputValidator = (data: unknown) => { valid: boolean; errors: string[] };

export type StructuredOutputPlan = {
	schemaJson: string;
	args: string[];
	capture: StructuredOutputCapture;
	tempPaths: string[];
	validate?: StructuredOutputValidator;
	notices?: string[];
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
		// `aliases` maps a memorable nickname to the model id this target's CLI actually accepts, so
		// `--model sol` can resolve to `gpt-5.6-sol`. Any target may declare its own table; a value with
		// no matching entry is forwarded verbatim, so an id released after the table was written still
		// reaches the agent. A key does shadow a model whose real id is that same string, so prefer keys
		// that are unlikely to become real ids.
		model?: { flag: string[]; modes?: InvocationMode[]; aliases?: Record<string, string> };
		web?: { on?: string[] | null; off?: string[] | null; modes?: InvocationMode[] };
		effort?: FlagMap<EffortLevel>;
		structuredOutput?: StructuredOutputSpec;
		structuredOutputFallback?: StructuredOutputFallbackSpec;
	};
	passthrough?: {
		position?: "after" | "before-prompt";
		collisions?: PassthroughCollisionRule[];
	};
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
		effort: EffortLevel | null;
		approvalExplicit: boolean;
		sandboxExplicit: boolean;
		outputExplicit: boolean;
		modelExplicit: boolean;
		webExplicit: boolean;
		effortExplicit: boolean;
	};
	requests: {
		approval: ApprovalPolicy;
		sandbox: SandboxMode;
		output: OutputFormat;
		model?: string;
		web: boolean;
		effort?: EffortLevel;
	};
	passthrough: {
		hasDelimiter: boolean;
		args: string[];
	};
	structuredOutput: StructuredOutputPlan | null;
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
	usage?: TargetUsageDefinition;
	history?: TargetHistoryDefinition;
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
	usage?: TargetUsageDefinition;
	history?: TargetHistoryDefinition;
	hooks?: TargetHooks;
	isBuiltIn: boolean;
	isCustomized: boolean;
};
