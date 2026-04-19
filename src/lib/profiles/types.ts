export const PROFILE_CATEGORIES = ["skills", "subagents", "commands"] as const;
export type ProfileCategory = (typeof PROFILE_CATEGORIES)[number];

export type ProfileTargetSetting = {
	enabled?: boolean;
};

export type ProfilePatternMap = Partial<Record<ProfileCategory, string[]>>;

export type ProfileVariables = Record<string, string>;

export type Profile = {
	$schema?: string;
	description?: string;
	extends?: string;
	targets?: Record<string, ProfileTargetSetting>;
	enable?: ProfilePatternMap;
	disable?: ProfilePatternMap;
	variables?: ProfileVariables;
};

export type ProfileSourceKind = "shared" | "local-sibling" | "local-dedicated";

export type ProfileFileRecord = {
	name: string;
	filePath: string;
	kind: ProfileSourceKind;
	profile: Profile;
};

export type ProfileLoadResult = {
	shared: ProfileFileRecord | null;
	localSibling: ProfileFileRecord | null;
	localDedicated: ProfileFileRecord | null;
};

export type ResolvedProfile = {
	names: string[];
	description: string | null;
	targets: Record<string, ProfileTargetSetting>;
	enable: Record<ProfileCategory, string[]>;
	disable: Record<ProfileCategory, string[]>;
	variables: ProfileVariables;
	/**
	 * Notices produced during resolution (e.g. both .local forms present for a profile).
	 * Printed under `--verbose` in the sync command.
	 */
	notices: string[];
};

export type ProfileValidationIssue = {
	path: string;
	message: string;
};

export type ProfileValidationResult = {
	valid: boolean;
	errors: ProfileValidationIssue[];
};

export function emptyResolvedProfile(): ResolvedProfile {
	return {
		names: [],
		description: null,
		targets: {},
		enable: { skills: [], subagents: [], commands: [] },
		disable: { skills: [], subagents: [], commands: [] },
		variables: {},
		notices: [],
	};
}

export const VARIABLE_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export function isValidVariableName(name: string): boolean {
	return VARIABLE_NAME_PATTERN.test(name);
}
