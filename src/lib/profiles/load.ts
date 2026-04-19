import { readdir, readFile } from "node:fs/promises";
import {
	profileLocalDedicatedPath,
	profileLocalSiblingPath,
	profileSharedPath,
	resolveLocalProfilesDir,
	resolveProfilesDir,
} from "./paths.js";
import type { Profile, ProfileFileRecord, ProfileLoadResult, ProfileSourceKind } from "./types.js";
import { assertValidProfile } from "./validate.js";

const PROFILE_EXTENSION = ".json";
const LOCAL_SUFFIX = ".local";

async function readJsonFile(filePath: string): Promise<unknown | null> {
	let contents: string;
	try {
		contents = await readFile(filePath, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return null;
		}
		throw error;
	}
	try {
		return JSON.parse(contents);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid JSON in profile at ${filePath}: ${message}`);
	}
}

async function readProfileFile(
	filePath: string,
	name: string,
	kind: ProfileSourceKind,
): Promise<ProfileFileRecord | null> {
	const raw = await readJsonFile(filePath);
	if (raw === null) {
		return null;
	}
	const profile = assertValidProfile(raw, name);
	return {
		name,
		filePath,
		kind,
		profile,
	};
}

export async function loadProfileFiles(
	repoRoot: string,
	name: string,
	agentsDir?: string | null,
): Promise<ProfileLoadResult> {
	const [shared, localSibling, localDedicated] = await Promise.all([
		readProfileFile(profileSharedPath(repoRoot, name, agentsDir), name, "shared"),
		readProfileFile(profileLocalSiblingPath(repoRoot, name, agentsDir), name, "local-sibling"),
		readProfileFile(profileLocalDedicatedPath(repoRoot, name, agentsDir), name, "local-dedicated"),
	]);

	return { shared, localSibling, localDedicated };
}

export function profileExists(result: ProfileLoadResult): boolean {
	return result.shared !== null || result.localSibling !== null || result.localDedicated !== null;
}

export type ProfileDirectoryListing = {
	name: string;
	hasShared: boolean;
	hasLocalSibling: boolean;
	hasLocalDedicated: boolean;
};

function parseProfileFilename(
	fileName: string,
): { name: string; kind: "shared" | "local-sibling" } | null {
	if (!fileName.toLowerCase().endsWith(PROFILE_EXTENSION)) {
		return null;
	}
	const base = fileName.slice(0, -PROFILE_EXTENSION.length);
	if (!base) {
		return null;
	}
	if (base.endsWith(LOCAL_SUFFIX)) {
		const stripped = base.slice(0, -LOCAL_SUFFIX.length);
		if (!stripped) {
			return null;
		}
		return { name: stripped, kind: "local-sibling" };
	}
	return { name: base, kind: "shared" };
}

async function readProfileNamesFromDir(
	dirPath: string,
): Promise<Array<{ name: string; kind: "shared" | "local-sibling" | "local-dedicated" }>> {
	let entries: string[] = [];
	try {
		entries = await readdir(dirPath);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return [];
		}
		throw error;
	}
	const out: Array<{
		name: string;
		kind: "shared" | "local-sibling" | "local-dedicated";
	}> = [];
	for (const entry of entries) {
		const parsed = parseProfileFilename(entry);
		if (!parsed) {
			continue;
		}
		out.push({ name: parsed.name, kind: parsed.kind });
	}
	return out;
}

export async function listProfileDirectory(
	repoRoot: string,
	agentsDir?: string | null,
): Promise<ProfileDirectoryListing[]> {
	const sharedDir = resolveProfilesDir(repoRoot, agentsDir);
	const dedicatedDir = resolveLocalProfilesDir(repoRoot, agentsDir);

	const [sharedEntries, dedicatedEntries] = await Promise.all([
		readProfileNamesFromDir(sharedDir),
		readProfileNamesFromDir(dedicatedDir).then((list) =>
			list
				.filter((entry) => entry.kind === "shared")
				.map((entry) => ({ name: entry.name, kind: "local-dedicated" as const })),
		),
	]);

	const index = new Map<string, ProfileDirectoryListing>();
	const get = (name: string): ProfileDirectoryListing => {
		const existing = index.get(name);
		if (existing) {
			return existing;
		}
		const created: ProfileDirectoryListing = {
			name,
			hasShared: false,
			hasLocalSibling: false,
			hasLocalDedicated: false,
		};
		index.set(name, created);
		return created;
	};

	for (const entry of sharedEntries) {
		const record = get(entry.name);
		if (entry.kind === "shared") {
			record.hasShared = true;
		} else {
			record.hasLocalSibling = true;
		}
	}
	for (const entry of dedicatedEntries) {
		const record = get(entry.name);
		record.hasLocalDedicated = true;
	}

	return [...index.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function toProfile(record: ProfileFileRecord): Profile {
	return record.profile;
}

export { profileSharedPath, profileLocalSiblingPath, profileLocalDedicatedPath };
export { resolveProfilesDir, resolveLocalProfilesDir };
