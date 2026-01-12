import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applySubagentSync, planSubagentSync } from "../../src/lib/subagents/sync.js";

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "agentctrl-subagents-"));
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

describe.sequential("subagent sync", () => {
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
});
