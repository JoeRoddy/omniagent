export type TargetName = string;

export type TargetIdentity = {
	id: string;
	aliases?: string[];
};

export class InvalidFrontmatterTargetsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidFrontmatterTargetsError";
	}
}

function normalizeTargetName(value: string): string {
	return value.trim().toLowerCase();
}

export function createTargetNameResolver(targets: TargetIdentity[]): {
	isTargetName: (value: string) => boolean;
	resolveTargetName: (value: string) => string | null;
	allTargets: string[];
} {
	const aliasToId = new Map<string, string>();
	const allTargets: string[] = [];
	for (const target of targets) {
		const idKey = normalizeTargetName(target.id);
		aliasToId.set(idKey, target.id);
		allTargets.push(target.id);
		for (const alias of target.aliases ?? []) {
			aliasToId.set(normalizeTargetName(alias), target.id);
		}
	}

	const isTargetName = (value: string): boolean => aliasToId.has(normalizeTargetName(value));
	const resolveTargetName = (value: string): string | null =>
		aliasToId.get(normalizeTargetName(value)) ?? null;

	return { isTargetName, resolveTargetName, allTargets };
}

export type RawTargetValue = string | string[] | null | undefined;

function normalizeTargetInputs(rawValues: RawTargetValue[]): string[] {
	const values: string[] = [];
	for (const raw of rawValues) {
		if (!raw) {
			continue;
		}
		if (Array.isArray(raw)) {
			values.push(...raw);
		} else if (typeof raw === "string") {
			values.push(raw);
		}
	}

	return values.map((value) => value.trim()).filter(Boolean);
}

function dedupeTargets<T extends string>(values: T[]): T[] {
	const seen = new Set<string>();
	const output: T[] = [];
	for (const value of values) {
		const key = value.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		output.push(value);
	}
	return output;
}

export function resolveFrontmatterTargets(
	rawValues: RawTargetValue[],
	resolveTargetName: (value: string) => string | null,
): { targets: TargetName[] | null; invalidTargets: string[] } {
	const normalized = normalizeTargetInputs(rawValues);
	if (normalized.length === 0) {
		return { targets: null, invalidTargets: [] };
	}

	const targets: TargetName[] = [];
	const invalidTargets: string[] = [];

	for (const value of normalized) {
		const resolved = resolveTargetName(value);
		if (resolved) {
			targets.push(resolved);
		} else {
			invalidTargets.push(value);
		}
	}

	const dedupedTargets = dedupeTargets(targets);
	const dedupedInvalids = dedupeTargets(invalidTargets);
	return {
		targets: dedupedTargets.length > 0 ? dedupedTargets : null,
		invalidTargets: dedupedInvalids,
	};
}

export function hasRawTargetValues(rawValues: RawTargetValue[]): boolean {
	return rawValues.some((value) => value !== undefined && value !== null);
}

export function resolveEffectiveTargets<T extends string>(options: {
	defaultTargets: T[] | null;
	overrideOnly?: T[] | null;
	overrideSkip?: T[] | null;
	allTargets: T[];
}): T[] {
	const overrideOnly = options.overrideOnly ?? [];
	const overrideSkip = options.overrideSkip ?? [];
	let base: T[] = [];
	if (overrideOnly.length > 0) {
		base = overrideOnly;
	} else if (options.defaultTargets && options.defaultTargets.length > 0) {
		base = options.defaultTargets;
	} else {
		base = options.allTargets;
	}

	const skipSet = new Set(overrideSkip.map((target) => normalizeTargetName(target)));
	return dedupeTargets(base.filter((target) => !skipSet.has(normalizeTargetName(target))));
}
