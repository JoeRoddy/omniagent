import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveProfiles } from "../../../src/lib/profiles/index.js";

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-profiles-"));
	try {
		await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function writeProfile(
	root: string,
	relative: string,
	profile: Record<string, unknown>,
): Promise<void> {
	const target = path.join(root, "agents", relative);
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, JSON.stringify(profile), "utf8");
}

describe("resolveProfiles", () => {
	it("returns empty resolution when no profile names provided", async () => {
		await withTempRepo(async (root) => {
			const resolved = await resolveProfiles([], { repoRoot: root });
			expect(resolved.names).toEqual([]);
			expect(resolved.enable.skills).toEqual([]);
		});
	});

	it("resolves a single profile", async () => {
		await withTempRepo(async (root) => {
			await writeProfile(root, "profiles/default.json", {
				description: "default",
				enable: { skills: ["hello"] },
			});
			const resolved = await resolveProfiles(["default"], { repoRoot: root });
			expect(resolved.names).toEqual(["default"]);
			expect(resolved.description).toBe("default");
			expect(resolved.enable.skills).toEqual(["hello"]);
		});
	});

	it("resolves an extends chain, concatenating enable/disable", async () => {
		await withTempRepo(async (root) => {
			await writeProfile(root, "profiles/base.json", {
				description: "base",
				disable: { skills: ["ppt"] },
			});
			await writeProfile(root, "profiles/code-reviewer.json", {
				extends: "base",
				enable: { skills: ["review"] },
			});
			const resolved = await resolveProfiles(["code-reviewer"], { repoRoot: root });
			expect(resolved.enable.skills).toEqual(["review"]);
			expect(resolved.disable.skills).toEqual(["ppt"]);
		});
	});

	it("detects cycles and reports the full chain", async () => {
		await withTempRepo(async (root) => {
			await writeProfile(root, "profiles/a.json", { extends: "b" });
			await writeProfile(root, "profiles/b.json", { extends: "a" });
			await expect(resolveProfiles(["a"], { repoRoot: root })).rejects.toThrow(/cycle/i);
		});
	});

	it("layers .local sibling and dedicated overrides, dedicated wins", async () => {
		await withTempRepo(async (root) => {
			await writeProfile(root, "profiles/default.json", {
				targets: { claude: { enabled: true } },
			});
			await writeProfile(root, "profiles/default.local.json", {
				targets: { claude: { enabled: false } },
			});
			await writeProfile(root, ".local/profiles/default.json", {
				targets: { claude: { enabled: true } },
			});
			const resolved = await resolveProfiles(["default"], { repoRoot: root });
			expect(resolved.targets.claude).toEqual({ enabled: true });
			expect(resolved.notices.length).toBeGreaterThan(0);
		});
	});

	it("merges multiple profiles in CLI order, later wins", async () => {
		await withTempRepo(async (root) => {
			await writeProfile(root, "profiles/base.json", {
				targets: { claude: { enabled: false } },
			});
			await writeProfile(root, "profiles/override.json", {
				targets: { claude: { enabled: true } },
			});
			const resolved = await resolveProfiles(["base", "override"], { repoRoot: root });
			expect(resolved.targets.claude).toEqual({ enabled: true });
			expect(resolved.names).toEqual(["base", "override"]);
		});
	});

	it("throws when the requested profile is missing", async () => {
		await withTempRepo(async (root) => {
			await expect(resolveProfiles(["ghost"], { repoRoot: root })).rejects.toThrow(/not found/);
		});
	});

	it("loads a profile that only exists at the dedicated .local path", async () => {
		await withTempRepo(async (root) => {
			await writeProfile(root, ".local/profiles/personal.json", {
				enable: { skills: ["toy"] },
			});
			const resolved = await resolveProfiles(["personal"], { repoRoot: root });
			expect(resolved.enable.skills).toEqual(["toy"]);
		});
	});

	it("merges variables across extends layers with later-wins semantics", async () => {
		await withTempRepo(async (root) => {
			await writeProfile(root, "profiles/base.json", {
				variables: { REVIEW_STYLE: "terse", LOG_SOURCE: "stdout" },
			});
			await writeProfile(root, "profiles/override.json", {
				extends: "base",
				variables: { REVIEW_STYLE: "thorough" },
			});
			const resolved = await resolveProfiles(["override"], { repoRoot: root });
			expect(resolved.variables).toEqual({
				REVIEW_STYLE: "thorough",
				LOG_SOURCE: "stdout",
			});
		});
	});

	it("merges variables across multiple CLI-order profiles, later wins", async () => {
		await withTempRepo(async (root) => {
			await writeProfile(root, "profiles/a.json", {
				variables: { FOO: "a-foo", BAR: "a-bar" },
			});
			await writeProfile(root, "profiles/b.json", {
				variables: { FOO: "b-foo" },
			});
			const resolved = await resolveProfiles(["a", "b"], { repoRoot: root });
			expect(resolved.variables).toEqual({ FOO: "b-foo", BAR: "a-bar" });
		});
	});
});
