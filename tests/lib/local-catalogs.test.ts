import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSkillCatalog } from "../../src/lib/skills/catalog.js";
import { loadCommandCatalog } from "../../src/lib/slash-commands/catalog.js";
import { loadSubagentCatalog } from "../../src/lib/subagents/catalog.js";

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-local-catalogs-"));
	try {
		await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function writeSkill(root: string, baseDir: string, name: string, fileName: string) {
	const dir = path.join(root, baseDir, name);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, fileName), `Content for ${name}`, "utf8");
}

async function writeCommand(root: string, baseDir: string, fileName: string, body: string) {
	const dir = path.join(root, baseDir);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, fileName), body, "utf8");
}

async function writeSubagent(
	root: string,
	baseDir: string,
	fileName: string,
	name: string,
	body: string,
) {
	const dir = path.join(root, baseDir);
	await mkdir(dir, { recursive: true });
	const contents = `---\nname: ${name}\n---\n${body}\n`;
	await writeFile(path.join(dir, fileName), contents, "utf8");
}

describe("local catalog detection", () => {
	it("classifies shared and local skills and prefers local path over suffix", async () => {
		await withTempRepo(async (root) => {
			await writeSkill(root, path.join("agents", "skills"), "alpha", "SKILL.md");
			await writeSkill(root, path.join("agents", "skills"), "alpha", "SKILL.local.md");
			await writeSkill(root, path.join("agents", ".local", "skills"), "alpha", "SKILL.md");
			await writeSkill(root, path.join("agents", "skills"), "beta", "SKILL.md");

			const catalog = await loadSkillCatalog(root);
			const sharedAlpha = catalog.sharedSkills.find((skill) => skill.name === "alpha");
			const sharedBeta = catalog.sharedSkills.find((skill) => skill.name === "beta");
			expect(sharedAlpha?.sourceType).toBe("shared");
			expect(sharedBeta?.sourceType).toBe("shared");

			const localPath = catalog.localSkills.find(
				(skill) => skill.name === "alpha" && skill.markerType === "path",
			);
			const localSuffix = catalog.localSkills.find(
				(skill) => skill.name === "alpha" && skill.markerType === "suffix",
			);
			expect(localPath?.sourceType).toBe("local");
			expect(localPath?.isLocalFallback).toBe(false);
			expect(localSuffix?.sourceType).toBe("local");
			expect(localSuffix?.isLocalFallback).toBe(true);

			const effectiveAlpha = catalog.localEffectiveSkills.filter((skill) => skill.name === "alpha");
			expect(effectiveAlpha).toHaveLength(1);
			expect(effectiveAlpha[0]?.markerType).toBe("path");

			const combinedAlpha = catalog.skills.filter((skill) => skill.name === "alpha");
			expect(combinedAlpha).toHaveLength(1);
			expect(combinedAlpha[0]?.sourceType).toBe("local");
		});
	});

	it("treats .local skill directories as local suffix overrides", async () => {
		await withTempRepo(async (root) => {
			await writeSkill(root, path.join("agents", "skills"), "alpha", "SKILL.md");
			await writeSkill(root, path.join("agents", "skills"), "alpha.local", "SKILL.md");

			const catalog = await loadSkillCatalog(root);
			const localDir = catalog.localSkills.find(
				(skill) => skill.name === "alpha" && skill.markerType === "suffix",
			);

			expect(localDir?.sourceType).toBe("local");
			expect(localDir?.relativePath).toBe("alpha");

			const combinedAlpha = catalog.skills.filter((skill) => skill.name === "alpha");
			expect(combinedAlpha).toHaveLength(1);
			expect(combinedAlpha[0]?.sourceType).toBe("local");
		});
	});

	it("strips .local suffixes from local path skill directories", async () => {
		await withTempRepo(async (root) => {
			await writeSkill(root, path.join("agents", ".local", "skills"), "gamma.local", "SKILL.md");

			const catalog = await loadSkillCatalog(root);
			const localGamma = catalog.localSkills.find((skill) => skill.name === "gamma");

			expect(localGamma?.relativePath).toBe("gamma");
			expect(catalog.localSkills.some((skill) => skill.name === "gamma.local")).toBe(false);
		});
	});

	it("classifies shared and local commands and prefers local path over suffix", async () => {
		await withTempRepo(async (root) => {
			await writeCommand(root, path.join("agents", "commands"), "deploy.md", "shared deploy");
			await writeCommand(root, path.join("agents", "commands"), "deploy.local.md", "local suffix");
			await writeCommand(
				root,
				path.join("agents", ".local", "commands"),
				"deploy.md",
				"local path",
			);
			await writeCommand(root, path.join("agents", "commands"), "backup.md", "shared backup");

			const catalog = await loadCommandCatalog(root);
			const sharedDeploy = catalog.sharedCommands.find((command) => command.name === "deploy");
			const sharedBackup = catalog.sharedCommands.find((command) => command.name === "backup");
			expect(sharedDeploy?.sourceType).toBe("shared");
			expect(sharedBackup?.sourceType).toBe("shared");

			const localPath = catalog.localCommands.find(
				(command) => command.name === "deploy" && command.markerType === "path",
			);
			const localSuffix = catalog.localCommands.find(
				(command) => command.name === "deploy" && command.markerType === "suffix",
			);
			expect(localPath?.sourceType).toBe("local");
			expect(localPath?.isLocalFallback).toBe(false);
			expect(localSuffix?.sourceType).toBe("local");
			expect(localSuffix?.isLocalFallback).toBe(true);

			const effectiveDeploy = catalog.localEffectiveCommands.filter(
				(command) => command.name === "deploy",
			);
			expect(effectiveDeploy).toHaveLength(1);
			expect(effectiveDeploy[0]?.markerType).toBe("path");

			const combinedDeploy = catalog.commands.filter((command) => command.name === "deploy");
			expect(combinedDeploy).toHaveLength(1);
			expect(combinedDeploy[0]?.sourceType).toBe("local");
		});
	});

	it("classifies shared and local subagents and prefers local path over suffix", async () => {
		await withTempRepo(async (root) => {
			await writeSubagent(
				root,
				path.join("agents", "agents"),
				"helper.md",
				"Helper",
				"shared helper",
			);
			await writeSubagent(
				root,
				path.join("agents", "agents"),
				"helper.local.md",
				"Helper",
				"local suffix",
			);
			await writeSubagent(
				root,
				path.join("agents", ".local", "agents"),
				"helper.md",
				"Helper",
				"local path",
			);
			await writeSubagent(root, path.join("agents", "agents"), "extra.md", "Extra", "shared extra");

			const catalog = await loadSubagentCatalog(root);
			const sharedHelper = catalog.sharedSubagents.find(
				(subagent) => subagent.resolvedName === "Helper",
			);
			const sharedExtra = catalog.sharedSubagents.find(
				(subagent) => subagent.resolvedName === "Extra",
			);
			expect(sharedHelper?.sourceType).toBe("shared");
			expect(sharedExtra?.sourceType).toBe("shared");

			const localPath = catalog.localSubagents.find(
				(subagent) => subagent.resolvedName === "Helper" && subagent.markerType === "path",
			);
			const localSuffix = catalog.localSubagents.find(
				(subagent) => subagent.resolvedName === "Helper" && subagent.markerType === "suffix",
			);
			expect(localPath?.sourceType).toBe("local");
			expect(localPath?.isLocalFallback).toBe(false);
			expect(localSuffix?.sourceType).toBe("local");
			expect(localSuffix?.isLocalFallback).toBe(true);

			const effectiveHelper = catalog.localEffectiveSubagents.filter(
				(subagent) => subagent.resolvedName === "Helper",
			);
			expect(effectiveHelper).toHaveLength(1);
			expect(effectiveHelper[0]?.markerType).toBe("path");

			const combinedHelper = catalog.subagents.filter(
				(subagent) => subagent.resolvedName === "Helper",
			);
			expect(combinedHelper).toHaveLength(1);
			expect(combinedHelper[0]?.sourceType).toBe("local");
		});
	});
});
