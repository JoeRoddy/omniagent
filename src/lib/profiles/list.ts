import { listProfileDirectory } from "./load.js";
import { resolveProfiles } from "./resolve.js";

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

function descriptionOf(raw: string | null): string | null {
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
		const resolved = await resolveProfiles([item.name], { repoRoot, agentsDir });
		entries.push({
			name: item.name,
			description: descriptionOf(resolved.description),
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
