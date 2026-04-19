import { listProfileDirectory, loadProfileFiles } from "./load.js";
import type { Profile, ProfileFileRecord, ProfileLoadResult } from "./types.js";

export const DEFAULT_PROFILE_NAME = "default";

export type ProfileListEntry = {
	name: string;
	description: string | null;
	hasShared: boolean;
	hasLocalSibling: boolean;
	hasLocalDedicated: boolean;
	isDefault: boolean;
	isLocalOnly: boolean;
	isBothLocalForms: boolean;
};

function pickPrimary(result: ProfileLoadResult): ProfileFileRecord | null {
	return result.localDedicated ?? result.localSibling ?? result.shared ?? null;
}

function descriptionOf(profile: Profile): string | null {
	const raw = profile.description;
	if (typeof raw !== "string") {
		return null;
	}
	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export async function listProfiles(
	repoRoot: string,
	agentsDir?: string | null,
): Promise<ProfileListEntry[]> {
	const directory = await listProfileDirectory(repoRoot, agentsDir);
	const entries: ProfileListEntry[] = [];
	for (const item of directory) {
		const loaded = await loadProfileFiles(repoRoot, item.name, agentsDir);
		const primary = pickPrimary(loaded);
		entries.push({
			name: item.name,
			description: primary ? descriptionOf(primary.profile) : null,
			hasShared: item.hasShared,
			hasLocalSibling: item.hasLocalSibling,
			hasLocalDedicated: item.hasLocalDedicated,
			isDefault: item.name === DEFAULT_PROFILE_NAME,
			isLocalOnly: !item.hasShared,
			isBothLocalForms: item.hasLocalSibling && item.hasLocalDedicated,
		});
	}
	return entries;
}
