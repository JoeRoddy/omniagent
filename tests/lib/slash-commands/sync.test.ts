import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	applySlashCommandSync,
	planSlashCommandSync,
} from "../../../src/lib/slash-commands/sync.js";

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "agentctrl-slash-commands-"));
	const homeDir = path.join(root, "home");
	await mkdir(homeDir, { recursive: true });
	const homeSpy = vi.spyOn(os, "homedir").mockReturnValue(homeDir);
	try {
		await fn(root);
	} finally {
		homeSpy.mockRestore();
		await rm(root, { recursive: true, force: true });
	}
}

async function createCanonicalCommand(root: string, name = "example"): Promise<void> {
	const commandsDir = path.join(root, "agents", "commands");
	await mkdir(commandsDir, { recursive: true });
	await writeFile(path.join(commandsDir, `${name}.md`), "Say hello.");
}

async function createCanonicalCommandWithFrontmatter(
	root: string,
	name = "example",
): Promise<void> {
	const commandsDir = path.join(root, "agents", "commands");
	await mkdir(commandsDir, { recursive: true });
	const contents = [
		"---",
		'description: "Say hello from a skill"',
		"tags:",
		'  - "testing"',
		"---",
		"Say hello.",
	].join("\n");
	await writeFile(path.join(commandsDir, `${name}.md`), contents);
}

async function createCanonicalCommandWithCustomName(
	root: string,
	fileName: string,
	customName: string,
): Promise<void> {
	const commandsDir = path.join(root, "agents", "commands");
	await mkdir(commandsDir, { recursive: true });
	const contents = ["---", `name: "${customName}"`, "---", "Say hello."].join("\n");
	await writeFile(path.join(commandsDir, `${fileName}.md`), contents);
}

async function createCanonicalCommandWithOrderedFrontmatter(
	root: string,
	name = "frontmatter-ordered",
): Promise<void> {
	const commandsDir = path.join(root, "agents", "commands");
	await mkdir(commandsDir, { recursive: true });
	const contents = [
		"---",
		"tags:",
		'  - "first"',
		'description: "Ordered frontmatter"',
		"---",
		"Say hello.",
	].join("\n");
	await writeFile(path.join(commandsDir, `${name}.md`), contents);
}

async function createTemplatedCommand(root: string, name = "templated"): Promise<void> {
	const commandsDir = path.join(root, "agents", "commands");
	await mkdir(commandsDir, { recursive: true });
	const contents = [
		"---",
		'description: "<agents claude> Hello Claude</agents><agents not:claude> Hello Gemini</agents>"',
		"---",
		"Start<agents claude> CLAUDE</agents><agents not:claude> GEMINI</agents>End",
	].join("\n");
	await writeFile(path.join(commandsDir, `${name}.md`), contents);
}

describe("slash command sync planning", () => {
	it("converts commands to project skills for unsupported targets", async () => {
		await withTempRepo(async (root) => {
			await createCanonicalCommand(root);

			const plan = await planSlashCommandSync({
				repoRoot: root,
				targets: ["copilot"],
				unsupportedFallback: "convert_to_skills",
				conflictResolution: "skip",
				removeMissing: true,
			});

			const targetPlan = plan.targetPlans[0];
			expect(targetPlan?.mode).toBe("skills");
			expect(targetPlan?.scope).toBe("project");

			await applySlashCommandSync(plan);

			const output = await readFile(
				path.join(root, ".github", "skills", "example", "SKILL.md"),
				"utf8",
			);
			expect(output).toContain("# example");
			expect(output).toContain("Say hello.");
		});
	});

	it("includes frontmatter when converting commands to skills", async () => {
		await withTempRepo(async (root) => {
			await createCanonicalCommandWithFrontmatter(root, "frontmatter-test");

			const plan = await planSlashCommandSync({
				repoRoot: root,
				targets: ["copilot"],
				unsupportedFallback: "convert_to_skills",
				conflictResolution: "skip",
				removeMissing: true,
			});

			await applySlashCommandSync(plan);

			const output = await readFile(
				path.join(root, ".github", "skills", "frontmatter-test", "SKILL.md"),
				"utf8",
			);
			expect(output).toContain("---");
			expect(output).toContain('name: "frontmatter-test"');
			expect(output).toContain('description: "Say hello from a skill"');
			expect(output).toContain('  - "testing"');
			expect(output.indexOf('name: "frontmatter-test"')).toBeLessThan(
				output.indexOf('description: "Say hello from a skill"'),
			);
		});
	});

	it("respects an explicit frontmatter name when converting commands to skills", async () => {
		await withTempRepo(async (root) => {
			await createCanonicalCommandWithCustomName(root, "named-command", "custom-skill-name");

			const plan = await planSlashCommandSync({
				repoRoot: root,
				targets: ["copilot"],
				unsupportedFallback: "convert_to_skills",
				conflictResolution: "skip",
				removeMissing: true,
			});

			await applySlashCommandSync(plan);

			const output = await readFile(
				path.join(root, ".github", "skills", "named-command", "SKILL.md"),
				"utf8",
			);
			expect(output).toContain('name: "custom-skill-name"');
			expect(output).not.toContain('name: "named-command"');
		});
	});

	it("keeps frontmatter for markdown command targets", async () => {
		await withTempRepo(async (root) => {
			await createCanonicalCommandWithOrderedFrontmatter(root, "frontmatter-ordered");

			const plan = await planSlashCommandSync({
				repoRoot: root,
				targets: ["claude"],
				conflictResolution: "skip",
				removeMissing: true,
			});

			await applySlashCommandSync(plan);

			const output = await readFile(
				path.join(root, ".claude", "commands", "frontmatter-ordered.md"),
				"utf8",
			);
			expect(output).toContain("---");
			expect(output).toContain('  - "first"');
			expect(output).toContain('description: "Ordered frontmatter"');
			expect(output.indexOf("tags:")).toBeLessThan(
				output.indexOf('description: "Ordered frontmatter"'),
			);
		});
	});

	it("allows Codex project-scope skill conversion", async () => {
		await withTempRepo(async (root) => {
			await createCanonicalCommand(root);

			const plan = await planSlashCommandSync({
				repoRoot: root,
				targets: ["codex"],
				codexOption: "convert_to_skills",
				codexConversionScope: "project",
				conflictResolution: "skip",
				removeMissing: true,
			});

			const targetPlan = plan.targetPlans[0];
			expect(targetPlan?.mode).toBe("skills");
			expect(targetPlan?.scope).toBe("project");

			await applySlashCommandSync(plan);

			const output = await readFile(
				path.join(root, ".codex", "skills", "example", "SKILL.md"),
				"utf8",
			);
			expect(output).toContain("# example");
			expect(output).toContain("Say hello.");
		});
	});

	it("keeps manifest stable and reports no changes on a repeat sync", async () => {
		await withTempRepo(async (root) => {
			await createCanonicalCommand(root);

			const firstPlan = await planSlashCommandSync({
				repoRoot: root,
				targets: ["claude"],
				conflictResolution: "skip",
				removeMissing: true,
			});
			await applySlashCommandSync(firstPlan);

			const manifestPath = firstPlan.targetPlans[0]?.manifestPath;
			expect(manifestPath).toBeTruthy();
			const firstManifest = await readFile(manifestPath ?? "", "utf8");

			const secondPlan = await planSlashCommandSync({
				repoRoot: root,
				targets: ["claude"],
				conflictResolution: "skip",
				removeMissing: true,
			});
			const secondSummary = await applySlashCommandSync(secondPlan);
			const secondManifest = await readFile(manifestPath ?? "", "utf8");

			expect(secondManifest).toBe(firstManifest);
			expect(secondSummary.results[0]?.message).toContain("No changes");
		});
	});

	it("applies agent templating per target when rendering commands", async () => {
		await withTempRepo(async (root) => {
			await createTemplatedCommand(root);

			const plan = await planSlashCommandSync({
				repoRoot: root,
				targets: ["claude", "gemini"],
				conflictResolution: "skip",
				removeMissing: true,
			});

			await applySlashCommandSync(plan);

			const claudeOutput = await readFile(
				path.join(root, ".claude", "commands", "templated.md"),
				"utf8",
			);
			const geminiOutput = await readFile(
				path.join(root, ".gemini", "commands", "templated.toml"),
				"utf8",
			);

			expect(claudeOutput).toContain("Hello Claude");
			expect(claudeOutput).toContain("CLAUDE");
			expect(claudeOutput).not.toContain("Hello Gemini");
			expect(claudeOutput).not.toContain("GEMINI");

			expect(geminiOutput).toContain("Hello Gemini");
			expect(geminiOutput).toContain("GEMINI");
			expect(geminiOutput).not.toContain("Hello Claude");
			expect(geminiOutput).not.toContain("CLAUDE");
		});
	});

	it("fails planning when templating is invalid", async () => {
		await withTempRepo(async (root) => {
			const commandsDir = path.join(root, "agents", "commands");
			await mkdir(commandsDir, { recursive: true });
			await writeFile(
				path.join(commandsDir, "broken.md"),
				"Hi<agents claude,not:claude> invalid</agents>",
			);

			await expect(
				planSlashCommandSync({
					repoRoot: root,
					targets: ["claude"],
					conflictResolution: "skip",
					removeMissing: true,
				}),
			).rejects.toThrow(/Agent templating error/);
		});
	});
});
