import type { LocalMarkerType, SourceType } from "../local-sources.js";
import type { FrontmatterValue } from "../slash-commands/frontmatter.js";
export type InstructionSourceKind = "template" | "repo";

export type InstructionSourceBase = {
	sourcePath: string;
	sourceType: SourceType;
	markerType?: LocalMarkerType;
	isLocalFallback: boolean;
	rawContents: string;
};

export type InstructionTemplateSource = InstructionSourceBase & {
	kind: "template";
	frontmatter: Record<string, FrontmatterValue>;
	body: string;
	targets: string[] | null;
	invalidTargets: string[];
	outPutPath: string | null;
	resolvedOutputDir: string | null;
	group: string | null;
};

export type InstructionRepoSource = InstructionSourceBase & {
	kind: "repo";
	body: string;
	resolvedOutputDir: string;
	group?: string | null;
};

export type InstructionSource = InstructionTemplateSource | InstructionRepoSource;

export type InstructionOutputStatus = "created" | "updated" | "removed" | "skipped";

export type InstructionOutput = {
	outputPath: string;
	targetName: InstructionTargetName;
	sourcePath: string;
	status: InstructionOutputStatus;
	contentHash?: string;
	reason?: string;
};
