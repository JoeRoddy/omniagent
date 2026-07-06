export type UsageWindow = string;

export type UsageLaunchDefinition = {
	command?: string;
	args?: string[];
	timeoutMs?: number;
	cheapModel?: string;
};

export type UsageDebugRequest = {
	enabled: boolean;
	includeRawOutput?: boolean;
	includeScreenSnapshots?: boolean;
};

export type UsageExtractionContext = {
	targetId: string;
	displayName: string;
	command?: string;
	window: UsageWindow;
	windows: UsageWindow[];
	now: Date;
	repoRoot: string;
	agentsDir: string;
	homeDir: string;
	launch?: UsageLaunchDefinition;
	signal: AbortSignal;
	debug: UsageDebugRequest;
};

export type NormalizedUsageLimit = {
	id: string;
	targetId: string;
	agent: string;
	scope?: string;
	window: UsageWindow;
	label?: string;
	modelId?: string;
	modelLabel?: string;
	percentUsed: number | null;
	percentRemaining: number | null;
	remainingText?: string;
	resetAt: string | null;
	resetText: string | null;
	raw: string;
};

export type NormalizedUsageError = {
	targetId: string;
	displayName: string;
	code: string;
	message: string;
};

export type NormalizedUsageDebugArtifact =
	| {
			type: "raw-output";
			label: string;
			content: string;
			command?: string;
			targetId?: string;
			displayName?: string;
	  }
	| {
			type: "screen-snapshot";
			label: string;
			path?: string;
			content?: string;
			mimeType?: string;
			targetId?: string;
			displayName?: string;
	  };

export type NormalizedUsageTargetResult = {
	targetId: string;
	displayName: string;
	command?: string;
	limits: NormalizedUsageLimit[];
	errors?: NormalizedUsageError[];
	debug?: NormalizedUsageDebugArtifact[];
};

export type NormalizedUsageEnvelope = {
	schemaVersion: 1;
	generatedAt: string;
	targets: NormalizedUsageTargetResult[];
	errors: NormalizedUsageError[];
	notes: string[];
	debug?: NormalizedUsageDebugArtifact[];
};

export type NormalizedUsageGeneration = {
	schemaVersion: 1;
	generatedAt: string;
};

export type UsageExtractionResult = NormalizedUsageTargetResult;

export type TargetUsageDefinition = {
	windows: UsageWindow[];
	launch?: UsageLaunchDefinition;
	extract: (context: UsageExtractionContext) => Promise<UsageExtractionResult>;
};
