import { loadProfileFiles, profileExists } from "./load.js";
import {
	PROFILE_CATEGORIES,
	type Profile,
	type ProfileCategory,
	type ProfileFileRecord,
	type ProfileLoadResult,
	type ProfileTargetSetting,
	type ResolvedProfile,
	emptyResolvedProfile,
} from "./types.js";

type LoadOptions = {
	repoRoot: string;
	agentsDir?: string | null;
};

async function ensureProfile(
	name: string,
	options: LoadOptions,
	cache: Map<string, ProfileLoadResult>,
): Promise<ProfileLoadResult> {
	const existing = cache.get(name);
	if (existing) {
		return existing;
	}
	const loaded = await loadProfileFiles(options.repoRoot, name, options.agentsDir);
	cache.set(name, loaded);
	return loaded;
}

async function resolveExtendsChain(
	name: string,
	options: LoadOptions,
	cache: Map<string, ProfileLoadResult>,
	stack: string[] = [],
): Promise<ProfileFileRecord[]> {
	if (stack.includes(name)) {
		const cycle = [...stack, name].join(" -> ");
		throw new Error(`Profile extends cycle detected: ${cycle}.`);
	}
	const loaded = await ensureProfile(name, options, cache);
	if (!profileExists(loaded)) {
		if (stack.length === 0) {
			throw new Error(`Profile "${name}" not found.`);
		}
		throw new Error(`Profile "${name}" references missing parent "${name}".`);
	}
	const primary = pickPrimaryRecord(loaded);
	if (!primary) {
		throw new Error(`Profile "${name}" has no readable source.`);
	}
	const parentName = primary.profile.extends;
	if (!parentName) {
		return [primary];
	}
	const parentChain = await resolveExtendsChain(parentName, options, cache, [...stack, name]);
	return [...parentChain, primary];
}

function pickPrimaryRecord(result: ProfileLoadResult): ProfileFileRecord | null {
	return result.shared ?? result.localSibling ?? result.localDedicated ?? null;
}

function mergeTargets(
	into: Record<string, ProfileTargetSetting>,
	from: Record<string, ProfileTargetSetting> | undefined,
): void {
	if (!from) {
		return;
	}
	for (const [name, setting] of Object.entries(from)) {
		const existing = into[name] ?? {};
		into[name] = { ...existing, ...setting };
	}
}

function mergePatternMap(
	into: Record<ProfileCategory, string[]>,
	from: Partial<Record<ProfileCategory, string[]>> | undefined,
): void {
	if (!from) {
		return;
	}
	for (const category of PROFILE_CATEGORIES) {
		const patterns = from[category];
		if (!patterns || patterns.length === 0) {
			continue;
		}
		into[category].push(...patterns);
	}
}

function applyProfileLayer(accumulator: ResolvedProfile, profile: Profile): void {
	if (profile.description !== undefined) {
		accumulator.description = profile.description;
	}
	mergeTargets(accumulator.targets, profile.targets);
	mergePatternMap(accumulator.enable, profile.enable);
	mergePatternMap(accumulator.disable, profile.disable);
}

async function buildSingleProfileLayers(
	name: string,
	options: LoadOptions,
	cache: Map<string, ProfileLoadResult>,
	notices: string[],
): Promise<Profile[]> {
	const chain = await resolveExtendsChain(name, options, cache);
	const layers: Profile[] = [];
	for (const record of chain) {
		const loaded = cache.get(record.name);
		if (!loaded) {
			layers.push(record.profile);
			continue;
		}
		// Canonical order: shared (base) → local sibling → local dedicated.
		// Each layer wins over the previous on conflict.
		if (loaded.shared) {
			layers.push(loaded.shared.profile);
		}
		if (loaded.localSibling) {
			layers.push(loaded.localSibling.profile);
		}
		if (loaded.localDedicated) {
			layers.push(loaded.localDedicated.profile);
		}
		if (loaded.localSibling && loaded.localDedicated) {
			notices.push(
				`profile "${record.name}" has both .local forms — ` +
					`agents/.local/profiles/${record.name}.json overrides agents/profiles/${record.name}.local.json`,
			);
		}
	}
	return layers;
}

export async function resolveProfiles(
	profileNames: string[],
	options: LoadOptions,
): Promise<ResolvedProfile> {
	const accumulator = emptyResolvedProfile();
	if (profileNames.length === 0) {
		return accumulator;
	}
	const cache = new Map<string, ProfileLoadResult>();
	for (const name of profileNames) {
		const layers = await buildSingleProfileLayers(name, options, cache, accumulator.notices);
		for (const layer of layers) {
			applyProfileLayer(accumulator, layer);
		}
		accumulator.names.push(name);
	}
	return accumulator;
}

export async function resolveSingleProfileRaw(
	name: string,
	options: LoadOptions,
): Promise<ResolvedProfile> {
	return resolveProfiles([name], options);
}
