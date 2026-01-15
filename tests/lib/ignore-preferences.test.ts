import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	readIgnorePreference,
	recordIgnorePromptDeclined,
	resolveIgnorePreferencePath,
} from "../../src/lib/ignore-preferences.js";

async function withTempRepo(fn: (root: string, homeDir: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-ignore-prefs-"));
	const homeDir = path.join(root, "home");
	await mkdir(homeDir, { recursive: true });
	try {
		await fn(root, homeDir);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("ignore prompt preferences", () => {
	it("records decline preferences using the repo hash", async () => {
		await withTempRepo(async (root, homeDir) => {
			const repoRoot = path.join(root, "repo");
			await mkdir(repoRoot, { recursive: true });

			const expectedHash = createHash("sha256").update(repoRoot).digest("hex");
			const expectedPath = resolveIgnorePreferencePath(repoRoot, homeDir);

			const preference = await recordIgnorePromptDeclined(repoRoot, homeDir);
			expect(preference.projectId).toBe(expectedHash);
			expect(preference.ignorePromptDeclined).toBe(true);
			expect(preference.updatedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);

			const raw = await readFile(expectedPath, "utf8");
			const parsed = JSON.parse(raw) as { projectId: string; ignorePromptDeclined: boolean };
			expect(parsed.projectId).toBe(expectedHash);
			expect(parsed.ignorePromptDeclined).toBe(true);

			const loaded = await readIgnorePreference(repoRoot, homeDir);
			expect(loaded?.projectId).toBe(expectedHash);
			expect(loaded?.ignorePromptDeclined).toBe(true);
		});
	});

	it("returns null when no preference file exists", async () => {
		await withTempRepo(async (root, homeDir) => {
			const repoRoot = path.join(root, "repo");
			await mkdir(repoRoot, { recursive: true });

			const loaded = await readIgnorePreference(repoRoot, homeDir);
			expect(loaded).toBeNull();
		});
	});
});
