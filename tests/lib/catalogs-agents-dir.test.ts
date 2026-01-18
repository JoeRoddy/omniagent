import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSkillCatalog } from "../../src/lib/skills/catalog.js";
import { loadCommandCatalog } from "../../src/lib/slash-commands/catalog.js";
import { loadSubagentCatalog } from "../../src/lib/subagents/catalog.js";

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-catalog-override-"));
	try {
		await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function writeSkill(root: string, baseDir: string, name: string): Promise<void> {
	const dir = path.join(root, baseDir, name);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "SKILL.md"), `Skill ${name}`, "utf8");
}

async function writeCommand(root: string, baseDir: string, name: string): Promise<void> {
	const dir = path.join(root, baseDir);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, `${name}.md`), `Command ${name}`, "utf8");
}

async function writeSubagent(
	root: string,
	baseDir: string,
	fileName: string,
	name: string,
): Promise<void> {
	const dir = path.join(root, baseDir);
	await mkdir(dir, { recursive: true });
	const contents = `---\nname: ${name}\n---\nBody\n`;
	await writeFile(path.join(dir, `${fileName}.md`), contents, "utf8");
}

describe("catalogs honor agentsDir overrides", () => {
	it("loads skills from the override directory", async () => {
		await withTempRepo(async (root) => {
			await writeSkill(root, path.join("agents", "skills"), "default-skill");
			await writeSkill(root, path.join("custom-agents", "skills"), "custom-skill");

			const catalog = await loadSkillCatalog(root, { agentsDir: "custom-agents" });
			const names = catalog.skills.map((skill) => skill.name).sort();

			expect(names).toEqual(["custom-skill"]);
			expect(catalog.skillsRoot).toBe(path.join(root, "custom-agents", "skills"));
		});
	});

	it("loads commands from the override directory", async () => {
		await withTempRepo(async (root) => {
			await writeCommand(root, path.join("agents", "commands"), "default-command");
			await writeCommand(root, path.join("custom-agents", "commands"), "custom-command");

			const catalog = await loadCommandCatalog(root, { agentsDir: "custom-agents" });
			const names = catalog.commands.map((command) => command.name).sort();

			expect(names).toEqual(["custom-command"]);
			expect(catalog.commandsPath).toBe(path.join(root, "custom-agents", "commands"));
		});
	});

	it("loads subagents from the override directory", async () => {
		await withTempRepo(async (root) => {
			await writeSubagent(root, path.join("agents", "agents"), "default", "Default");
			await writeSubagent(root, path.join("custom-agents", "agents"), "custom", "Custom");

			const catalog = await loadSubagentCatalog(root, { agentsDir: "custom-agents" });
			const names = catalog.subagents.map((subagent) => subagent.resolvedName).sort();

			expect(names).toEqual(["Custom"]);
			expect(catalog.catalogPath).toBe(path.join(root, "custom-agents", "agents"));
		});
	});
});
