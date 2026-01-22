import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applySubagentSync, planSubagentSync } from "../../src/lib/subagents/sync.js";

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-subagents-"));
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

async function createRepoRoot(root: string): Promise<void> {
	await writeFile(path.join(root, "package.json"), "{}");
}

async function writeSubagent(root: string, name: string, body: string): Promise<string> {
	const catalogDir = path.join(root, "agents", "agents");
	await mkdir(catalogDir, { recursive: true });
	const contents = `---\nname: ${name}\n---\n${body}\n`;
	const filePath = path.join(catalogDir, `${name}.md`);
	await writeFile(filePath, contents, "utf8");
	return filePath;
}

async function writeCanonicalSkill(root: string, name: string, body: string): Promise<string> {
	const skillDir = path.join(root, "agents", "skills", name);
	await mkdir(skillDir, { recursive: true });
	const skillPath = path.join(skillDir, "SKILL.md");
	await writeFile(skillPath, body, "utf8");
	return skillPath;
}

async function writeLocalSkill(root: string, name: string, body: string): Promise<string> {
	const skillDir = path.join(root, "agents", ".local", "skills", name);
	await mkdir(skillDir, { recursive: true });
	const skillPath = path.join(skillDir, "SKILL.md");
	await writeFile(skillPath, body, "utf8");
	return skillPath;
}

describe.sequential("subagent sync", () => {
	it("syncs subagents to Claude output paths", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSubagent(root, "helper", "Subagent body");

			const plan = await planSubagentSync({
				repoRoot: root,
				targets: ["claude"],
				removeMissing: true,
			});
			await applySubagentSync(plan);

			const destination = path.join(root, ".claude", "agents", "helper.md");
			expect(await pathExists(destination)).toBe(true);
			const output = await readFile(destination, "utf8");
			expect(output).toContain("Subagent body");
		});
	});

	it("includes subagent counts in sync summaries", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSubagent(root, "reporter", "Subagent body");

			const plan = await planSubagentSync({
				repoRoot: root,
				targets: ["claude"],
				removeMissing: true,
			});
			const summary = await applySubagentSync(plan);

			expect(summary.results[0]?.message).toContain("created 1");
		});
	});

	it("respects override filters when planning subagent sync", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSubagent(root, "filter", "Subagent body");

			const plan = await planSubagentSync({
				repoRoot: root,
				targets: ["claude", "codex"],
				overrideOnly: ["claude"],
				removeMissing: true,
			});

			const claudePlan = plan.targetPlans.find((target) => target.targetName === "claude");
			const codexPlan = plan.targetPlans.find((target) => target.targetName === "codex");

			expect(claudePlan?.summary.created).toBe(1);
			expect(codexPlan?.summary.created).toBe(0);
			expect(codexPlan?.summary.converted).toBe(0);
		});
	});

	it("warns when converting subagents for unsupported targets", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSubagent(root, "converter", "Subagent body");

			const plan = await planSubagentSync({
				repoRoot: root,
				targets: ["codex"],
				removeMissing: true,
			});

			const warning = plan.targetPlans[0]?.warnings.find((entry) =>
				entry.includes("does not support native subagents"),
			);
			expect(warning).toBeTruthy();
		});
	});

	it("skips conflicting unmanaged subagent outputs with a warning", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSubagent(root, "conflict", "Subagent body");
			const destinationDir = path.join(root, ".claude", "agents");
			await mkdir(destinationDir, { recursive: true });
			const existingPath = path.join(destinationDir, "conflict.md");
			await writeFile(existingPath, "Existing content", "utf8");

			const plan = await planSubagentSync({
				repoRoot: root,
				targets: ["claude"],
				removeMissing: true,
			});
			const summary = await applySubagentSync(plan);

			expect(await readFile(existingPath, "utf8")).toBe("Existing content");
			expect(summary.warnings.some((warning) => warning.includes("unmanaged file exists"))).toBe(
				true,
			);
		});
	});

	it("removes managed subagent outputs when the catalog entry is removed", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSubagent(root, "obsolete", "Subagent body");

			const initialPlan = await planSubagentSync({
				repoRoot: root,
				targets: ["claude"],
				removeMissing: true,
			});
			await applySubagentSync(initialPlan);

			const destination = path.join(root, ".claude", "agents", "obsolete.md");
			expect(await pathExists(destination)).toBe(true);

			await rm(path.join(root, "agents", "agents", "obsolete.md"));

			const removalPlan = await planSubagentSync({
				repoRoot: root,
				targets: ["claude"],
				removeMissing: true,
			});
			await applySubagentSync(removalPlan);

			expect(await pathExists(destination)).toBe(false);
		});
	});

	it("treats a missing catalog as empty and removes managed outputs", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSubagent(root, "orphan", "Subagent body");

			const initialPlan = await planSubagentSync({
				repoRoot: root,
				targets: ["claude"],
				removeMissing: true,
			});
			await applySubagentSync(initialPlan);

			const destination = path.join(root, ".claude", "agents", "orphan.md");
			expect(await pathExists(destination)).toBe(true);

			await rm(path.join(root, "agents", "agents"), { recursive: true, force: true });

			const removalPlan = await planSubagentSync({
				repoRoot: root,
				targets: ["claude"],
				removeMissing: true,
			});
			await applySubagentSync(removalPlan);

			expect(await pathExists(destination)).toBe(false);
		});
	});
	it("skips conversion when a canonical skill exists", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeCanonicalSkill(root, "planner", "canonical skill");
			await writeSubagent(root, "planner", "subagent body");

			const plan = await planSubagentSync({
				repoRoot: root,
				targets: ["codex"],
				removeMissing: true,
			});

			expect(plan.plan.actions).toHaveLength(1);
			const action = plan.plan.actions[0];
			expect(action.action).toBe("skip");
			expect(action.conflict).toBe(true);

			const summary = await applySubagentSync(plan);
			expect(summary.warnings.some((warning) => warning.includes("canonical skill"))).toBe(true);

			const destination = path.join(root, ".codex", "skills", "planner", "SKILL.md");
			expect(await pathExists(destination)).toBe(false);
		});
	});

	it("skips conversion when a local skill exists", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeLocalSkill(root, "planner", "local skill");
			await writeSubagent(root, "planner", "subagent body");

			const plan = await planSubagentSync({
				repoRoot: root,
				targets: ["codex"],
				removeMissing: true,
				includeLocalSkills: true,
			});

			expect(plan.plan.actions).toHaveLength(1);
			const action = plan.plan.actions[0];
			expect(action.action).toBe("skip");
			expect(action.conflict).toBe(true);

			const summary = await applySubagentSync(plan);
			expect(summary.warnings.some((warning) => warning.includes("agents/.local/skills"))).toBe(
				true,
			);

			const destination = path.join(root, ".codex", "skills", "planner", "SKILL.md");
			expect(await pathExists(destination)).toBe(false);
		});
	});

	it("does not remove a managed conversion when a canonical skill appears", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSubagent(root, "planner", "subagent body");

			const initialPlan = await planSubagentSync({
				repoRoot: root,
				targets: ["codex"],
				removeMissing: true,
			});
			await applySubagentSync(initialPlan);

			const destination = path.join(root, ".codex", "skills", "planner", "SKILL.md");
			expect(await pathExists(destination)).toBe(true);

			await rm(path.join(root, "agents", "agents", "planner.md"));
			await writeCanonicalSkill(root, "planner", "canonical skill");

			const removalPlan = await planSubagentSync({
				repoRoot: root,
				targets: ["codex"],
				removeMissing: true,
			});

			const removalAction = removalPlan.plan.actions.find(
				(action) => action.subagentName === "planner" && action.action === "skip",
			);
			expect(removalAction).toBeTruthy();

			const summary = await applySubagentSync(removalPlan);
			expect(summary.warnings.some((warning) => warning.includes("Skipped removing"))).toBe(true);
			expect(await pathExists(destination)).toBe(true);
		});
	});

	it("removes tools, model, and color when converting to skills", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			const catalogDir = path.join(root, "agents", "agents");
			await mkdir(catalogDir, { recursive: true });
			const contents = [
				"---",
				"name: planner",
				"model: gpt-4",
				"tools:",
				"  - read",
				"color: blue",
				"description: keep me",
				"---",
				"Body text.",
				"",
			].join("\n");
			await writeFile(path.join(catalogDir, "planner.md"), contents, "utf8");

			const plan = await planSubagentSync({
				repoRoot: root,
				targets: ["codex"],
				removeMissing: true,
			});
			await applySubagentSync(plan);

			const destination = path.join(root, ".codex", "skills", "planner", "SKILL.md");
			const output = await readFile(destination, "utf8");
			expect(output).toContain("name: planner");
			expect(output).toContain("description: keep me");
			expect(output).toContain("Body text.");
			expect(output).not.toContain("model:");
			expect(output).not.toContain("tools:");
			expect(output).not.toContain("color:");
		});
	});

	it("applies templating to subagent outputs", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSubagent(
				root,
				"templated",
				"Hello<agents claude> CLAUDE</agents><agents not:claude> OTHER</agents>",
			);

			const plan = await planSubagentSync({
				repoRoot: root,
				targets: ["claude"],
				removeMissing: true,
			});

			await applySubagentSync(plan);

			const destination = path.join(root, ".claude", "agents", "templated.md");
			const output = await readFile(destination, "utf8");
			expect(output).toContain("CLAUDE");
			expect(output).not.toContain("OTHER");
		});
	});

	it("applies templating when converting subagents to skills", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSubagent(
				root,
				"templated-skill",
				"Hello<agents codex> CODEX</agents><agents not:codex> OTHER</agents>",
			);

			const plan = await planSubagentSync({
				repoRoot: root,
				targets: ["codex"],
				removeMissing: true,
				validAgents: ["codex"],
			});

			await applySubagentSync(plan);

			const destination = path.join(root, ".codex", "skills", "templated-skill", "SKILL.md");
			const output = await readFile(destination, "utf8");
			expect(output).toContain("CODEX");
			expect(output).not.toContain("OTHER");
		});
	});
});
