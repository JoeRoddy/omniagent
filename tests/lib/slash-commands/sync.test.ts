import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	applySlashCommandSync,
	planSlashCommandSync,
} from "../../../src/lib/slash-commands/sync.js";

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-slash-commands-"));
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

async function pathExists(candidate: string): Promise<boolean> {
	try {
		await stat(candidate);
		return true;
	} catch {
		return false;
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
	it("syncs only the selected targets", async () => {
		await withTempRepo(async (root) => {
			await createCanonicalCommand(root);

			const plan = await planSlashCommandSync({
				repoRoot: root,
				targets: ["claude"],
				conflictResolution: "skip",
				removeMissing: true,
			});

			await applySlashCommandSync(plan);

			expect(await pathExists(path.join(root, ".claude", "commands", "example.md"))).toBe(true);
			expect(await pathExists(path.join(root, ".gemini", "commands", "example.toml"))).toBe(false);
			expect(await pathExists(path.join(root, ".github", "skills", "example", "SKILL.md"))).toBe(
				false,
			);
		});
	});

	it("defaults to project scope for Claude and Gemini", async () => {
		await withTempRepo(async (root) => {
			await createCanonicalCommand(root);

			const plan = await planSlashCommandSync({
				repoRoot: root,
				targets: ["claude", "gemini"],
				conflictResolution: "skip",
				removeMissing: true,
			});

			const claudePlan = plan.targetPlans.find((target) => target.targetName === "claude");
			const geminiPlan = plan.targetPlans.find((target) => target.targetName === "gemini");

			expect(claudePlan?.scope).toBe("project");
			expect(geminiPlan?.scope).toBe("project");
		});
	});

	it("defaults Codex command scope to global", async () => {
		await withTempRepo(async (root) => {
			await createCanonicalCommand(root);

			const plan = await planSlashCommandSync({
				repoRoot: root,
				targets: ["codex"],
				conflictResolution: "skip",
				removeMissing: true,
			});

			expect(plan.targetPlans[0]?.scope).toBe("global");
		});
	});

	it("reports per-target command/skill actions in the plan summary", async () => {
		await withTempRepo(async (root) => {
			await createCanonicalCommand(root);

			const plan = await planSlashCommandSync({
				repoRoot: root,
				targets: ["claude", "copilot"],
				conflictResolution: "skip",
				removeMissing: true,
			});

			const claudePlan = plan.targetPlans.find((target) => target.targetName === "claude");
			const copilotPlan = plan.targetPlans.find((target) => target.targetName === "copilot");

			expect(claudePlan?.mode).toBe("commands");
			expect(claudePlan?.summary.create).toBe(1);
			expect(copilotPlan?.mode).toBe("skills");
			expect(copilotPlan?.summary.convert).toBe(1);
		});
	});

	it("converts commands to project skills for unsupported targets", async () => {
		await withTempRepo(async (root) => {
			await createCanonicalCommand(root);

			const plan = await planSlashCommandSync({
				repoRoot: root,
				targets: ["copilot"],
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
				config: {
					targets: [
						{
							id: "codex",
							override: true,
							outputs: {
								commands: {
									userPath: "{homeDir}/.codex/prompts/{itemName}.md",
									fallback: { mode: "convert", targetType: "skills" },
								},
							},
						},
					],
				},
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

	it.each([
		{ resolution: "skip", expectBackup: false, expectOverwrite: false },
		{ resolution: "rename", expectBackup: true, expectOverwrite: true },
		{ resolution: "overwrite", expectBackup: false, expectOverwrite: true },
	] as const)("supports %s conflict resolution for existing commands", async ({
		resolution,
		expectBackup,
		expectOverwrite,
	}) => {
		await withTempRepo(async (root) => {
			await createCanonicalCommand(root, "conflict");
			const destinationDir = path.join(root, ".claude", "commands");
			await mkdir(destinationDir, { recursive: true });
			const existingPath = path.join(destinationDir, "conflict.md");
			await writeFile(existingPath, "Existing command", "utf8");

			const plan = await planSlashCommandSync({
				repoRoot: root,
				targets: ["claude"],
				conflictResolution: resolution,
				removeMissing: true,
			});
			await applySlashCommandSync(plan);

			const output = await readFile(existingPath, "utf8");
			if (expectOverwrite) {
				expect(output).toContain("Say hello.");
			} else {
				expect(output).toBe("Existing command");
			}

			const backupPath = path.join(destinationDir, "conflict-backup.md");
			expect(await pathExists(backupPath)).toBe(expectBackup);
			if (expectBackup) {
				expect(await readFile(backupPath, "utf8")).toBe("Existing command");
			}
		});
	});

	it("removes managed commands missing from the catalog", async () => {
		await withTempRepo(async (root) => {
			await createCanonicalCommand(root, "obsolete");

			const initialPlan = await planSlashCommandSync({
				repoRoot: root,
				targets: ["claude"],
				conflictResolution: "skip",
				removeMissing: true,
			});
			await applySlashCommandSync(initialPlan);

			const destinationDir = path.join(root, ".claude", "commands");
			const obsoletePath = path.join(destinationDir, "obsolete.md");
			await writeFile(path.join(destinationDir, "manual.md"), "Manual file", "utf8");

			expect(await pathExists(obsoletePath)).toBe(true);

			await rm(path.join(root, "agents", "commands", "obsolete.md"));

			const removalPlan = await planSlashCommandSync({
				repoRoot: root,
				targets: ["claude"],
				conflictResolution: "skip",
				removeMissing: true,
			});
			await applySlashCommandSync(removalPlan);

			expect(await pathExists(obsoletePath)).toBe(false);
			expect(await readFile(path.join(destinationDir, "manual.md"), "utf8")).toBe("Manual file");
		});
	});

	it("uses the canonical command definition for other target formats", async () => {
		await withTempRepo(async (root) => {
			const commandsDir = path.join(root, "agents", "commands");
			await mkdir(commandsDir, { recursive: true });
			const contents = [
				"---",
				'description: "Do the thing"',
				"---",
				"Run the canonical prompt.",
			].join("\n");
			await writeFile(path.join(commandsDir, "canonical.md"), contents, "utf8");

			const plan = await planSlashCommandSync({
				repoRoot: root,
				targets: ["gemini", "copilot"],
				conflictResolution: "skip",
				removeMissing: true,
			});
			await applySlashCommandSync(plan);

			const geminiOutput = await readFile(
				path.join(root, ".gemini", "commands", "canonical.toml"),
				"utf8",
			);
			expect(geminiOutput).toContain('description = "Do the thing"');
			expect(geminiOutput).toContain('prompt = "Run the canonical prompt."');

			const copilotOutput = await readFile(
				path.join(root, ".github", "skills", "canonical", "SKILL.md"),
				"utf8",
			);
			expect(copilotOutput).toContain("Run the canonical prompt.");
		});
	});
});
