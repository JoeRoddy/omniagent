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
	hooks?: TargetHooks;
};

export type OmniagentConfig = {
	targets?: TargetDefinition[];
	disableTargets?: string[];
	hooks?: SyncHooks;
};

export type ResolvedTarget = {
	id: string;
	displayName: string;
	aliases: string[];
	outputs: TargetOutputs;
	hooks?: TargetHooks;
	isBuiltIn: boolean;
	isCustomized: boolean;
};
