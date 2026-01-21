import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveTargets } from "../../../src/lib/custom-targets/resolve-targets.js";
import { syncCustomTargets } from "../../../src/lib/custom-targets/sync.js";
import type { OmniagentConfig } from "../../../src/lib/custom-targets/types.js";
import { resolveSupportedAgentNames } from "../../../src/lib/supported-targets.js";
import { setCustomTargetNames } from "../../../src/lib/sync-targets.js";

async function withTempRepo(fn: (root: string, homeDir: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-custom-sync-"));
	const homeDir = path.join(root, "home");
	await mkdir(homeDir, { recursive: true });
	const homeSpy = vi.spyOn(os, "homedir").mockReturnValue(homeDir);
	try {
		await fn(root, homeDir);
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

async function writeSkill(root: string, name: string, contents = "skill"): Promise<void> {
	const skillDir = path.join(root, "agents", "skills", name);
	await mkdir(skillDir, { recursive: true });
	await writeFile(path.join(skillDir, "SKILL.md"), contents, "utf8");
}

async function writeCommand(root: string, name: string, contents = "Say hello."): Promise<void> {
	const commandsDir = path.join(root, "agents", "commands");
	await mkdir(commandsDir, { recursive: true });
	await writeFile(path.join(commandsDir, `${name}.md`), contents, "utf8");
}

async function writeSubagent(root: string, name: string, body = "Assist."): Promise<void> {
	const agentsDir = path.join(root, "agents", "agents");
	await mkdir(agentsDir, { recursive: true });
	const contents = [`---`, `name: ${name}`, `---`, body, ""].join("\n");
	await writeFile(path.join(agentsDir, `${name}.md`), contents, "utf8");
}

async function writeInstructionTemplate(
	root: string,
	relativePath: string,
	frontmatterLines: string[],
	body: string,
): Promise<void> {
	const filePath = path.join(root, "agents", relativePath);
	await mkdir(path.dirname(filePath), { recursive: true });
	const contents =
		frontmatterLines.length > 0 ? ["---", ...frontmatterLines, "---", body, ""].join("\n") : body;
	await writeFile(filePath, contents, "utf8");
}

async function syncWithConfig(root: string, config: OmniagentConfig) {
	const registry = resolveTargets(config);
	const targets = registry.resolved.filter((target) => target.source !== "built-in");
	setCustomTargetNames(registry.resolved.map((target) => target.id));
	return await syncCustomTargets({
		repoRoot: root,
		targets,
		validAgents: resolveSupportedAgentNames(registry.resolved.map((target) => target.id)),
	});
}

afterEach(() => {
	setCustomTargetNames([]);
});

describe.sequential("custom target sync", () => {
	it("syncs only configured categories and defaults instructions", async () => {
		await withTempRepo(async (root) => {
			await writeSkill(root, "alpha", "alpha skill");
			await writeCommand(root, "hello", "Say hello.");
			await writeSubagent(root, "helper", "Assist.");
			await writeInstructionTemplate(root, "AGENTS.md", [], "Repo instructions");

			await syncWithConfig(root, {
				targets: [{ id: "custom", outputs: { skills: "custom/skills" } }],
			});

			expect(await pathExists(path.join(root, "custom", "skills", "alpha", "SKILL.md"))).toBe(true);
			expect(await pathExists(path.join(root, "custom", "skills", "hello", "SKILL.md"))).toBe(
				false,
			);
			expect(await pathExists(path.join(root, "custom", "agents", "helper.md"))).toBe(false);
			expect(await pathExists(path.join(root, "AGENTS.md"))).toBe(true);
		});
	});

	it("supports short-form and expanded output config", async () => {
		await withTempRepo(async (root) => {
			await writeSkill(root, "alpha", "alpha skill");
			await writeCommand(root, "hello", "Say hello.");

			await syncWithConfig(root, {
				targets: [
					{
						id: "dual",
						outputs: {
							skills: "out/skills",
							commands: { path: "out/commands", format: "toml" },
						},
					},
				],
			});

			expect(await pathExists(path.join(root, "out", "skills", "alpha", "SKILL.md"))).toBe(true);
			const commandPath = path.join(root, "out", "commands", "hello.toml");
			expect(await pathExists(commandPath)).toBe(true);
			const commandContents = await readFile(commandPath, "utf8");
			expect(commandContents).toContain("prompt");
		});
	});

	it("supports callback values across output settings", async () => {
		await withTempRepo(async (root) => {
			await writeSkill(root, "alpha", "alpha skill");
			await writeCommand(root, "ping", "Ping the service.");
			await writeSubagent(root, "helper", "Assist.");
			await writeInstructionTemplate(
				root,
				"alpha.agents.md",
				["outputPath: docs/alpha", "group: alpha"],
				"Alpha instructions",
			);
			await writeInstructionTemplate(
				root,
				"beta.agents.md",
				["outputPath: docs/beta", "group: beta"],
				"Beta instructions",
			);

			await syncWithConfig(root, {
				targets: [
					{
						id: "callback",
						outputs: {
							skills: {
								path: ({ item, context }) => path.join(context.repo, "out", "skills", item.name),
							},
							commands: {
								path: ({ context }) =>
									path.join(context.repo, "out", "commands", context.target.id),
								format: () => "toml",
								scopes: () => ["project", "global"],
								globalPath: ({ context }) =>
									path.join(context.repo, "out", "global-commands", context.target.id),
							},
							subagents: {
								path: ({ context }) => path.join(context.repo, "out", "agents", context.target.id),
							},
							instructions: {
								fileName: ({ item, context }) =>
									`${context.target.id}-${item.name.replace(/\\.md$/, "")}.md`,
								group: () => "alpha",
							},
						},
					},
				],
			});

			expect(await pathExists(path.join(root, "out", "skills", "alpha", "alpha", "SKILL.md"))).toBe(
				true,
			);
			expect(await pathExists(path.join(root, "out", "commands", "callback", "ping.toml"))).toBe(
				true,
			);
			expect(
				await pathExists(path.join(root, "out", "global-commands", "callback", "ping.toml")),
			).toBe(true);
			expect(await pathExists(path.join(root, "out", "agents", "callback", "helper.md"))).toBe(
				true,
			);
			const alphaDir = path.join(root, "docs", "alpha");
			const alphaList = (await pathExists(alphaDir)) ? await readdir(alphaDir) : [];
			expect(alphaList.some((entry) => entry.startsWith("callback-alpha.agents"))).toBe(true);

			const betaDir = path.join(root, "docs", "beta");
			if (await pathExists(betaDir)) {
				const betaList = await readdir(betaDir);
				expect(betaList.some((entry) => entry.startsWith("callback-beta.agents"))).toBe(false);
			} else {
				expect(true).toBe(true);
			}
		});
	});

	it("honors converter outcomes for outputs, skips, satisfies, and errors", async () => {
		await withTempRepo(async (root) => {
			await writeSkill(root, "string-output", "string");
			await writeSkill(root, "single-output", "single");
			await writeSkill(root, "multi-output", "multi");
			await writeSkill(root, "skip-output", "skip");
			await writeSkill(root, "satisfy-output", "satisfy");
			await writeSkill(root, "error-output", "error");

			const summary = await syncWithConfig(root, {
				targets: [
					{
						id: "converter",
						outputs: {
							skills: {
								path: "out/skills",
								convert: ({ item }) => {
									switch (item.name) {
										case "string-output":
											return "string content";
										case "single-output":
											return { path: "out/custom/single.md", content: "single content" };
										case "multi-output":
											return [
												{ path: "out/custom/multi-a.md", content: "multi a" },
												{ path: "out/custom/multi-b.md", content: "multi b" },
											];
										case "skip-output":
											return { skip: true };
										case "satisfy-output":
											return { satisfy: true };
										case "error-output":
											return { error: "boom" };
										default:
											return null;
									}
								},
							},
						},
					},
				],
			});

			expect(
				await readFile(path.join(root, "out", "skills", "string-output", "SKILL.md"), "utf8"),
			).toBe("string content");
			expect(await pathExists(path.join(root, "out", "custom", "single.md"))).toBe(true);
			expect(await pathExists(path.join(root, "out", "custom", "multi-a.md"))).toBe(true);
			expect(await pathExists(path.join(root, "out", "custom", "multi-b.md"))).toBe(true);
			expect(await pathExists(path.join(root, "out", "skills", "skip-output", "SKILL.md"))).toBe(
				false,
			);
			expect(await pathExists(path.join(root, "out", "skills", "satisfy-output", "SKILL.md"))).toBe(
				false,
			);

			const result = summary.results.find((entry) => entry.targetId === "converter");
			expect(result?.counts.failed).toBe(1);
			expect(result?.errors.some((error) => error.includes("error-output"))).toBe(true);
		});
	});

	it("writes instruction outputs per output directory with configured file name", async () => {
		await withTempRepo(async (root) => {
			await writeInstructionTemplate(
				root,
				"alpha.agents.md",
				["outputPath: docs/alpha"],
				"Alpha instructions",
			);
			await writeInstructionTemplate(
				root,
				"beta.agents.md",
				["outputPath: docs/beta"],
				"Beta instructions",
			);

			await syncWithConfig(root, {
				targets: [
					{
						id: "custom",
						outputs: {
							instructions: { fileName: "TEAM.md" },
						},
					},
				],
			});

			expect(await pathExists(path.join(root, "docs", "alpha", "TEAM.md"))).toBe(true);
			expect(await pathExists(path.join(root, "docs", "beta", "TEAM.md"))).toBe(true);
		});
	});

	it("writes commands to project and global scopes with configurable global path", async () => {
		await withTempRepo(async (root) => {
			await writeCommand(root, "deploy", "Deploy service.");

			await syncWithConfig(root, {
				targets: [
					{
						id: "scoped",
						outputs: {
							commands: {
								path: ({ context }) => path.join(context.repo, "out", "commands"),
								scopes: () => ["project", "global"],
								globalPath: ({ context }) => path.join(context.repo, "out", "global-commands"),
								format: () => "markdown",
							},
						},
					},
				],
			});

			expect(await pathExists(path.join(root, "out", "commands", "deploy.md"))).toBe(true);
			expect(await pathExists(path.join(root, "out", "global-commands", "deploy.md"))).toBe(true);
		});
	});

	it("falls back to skills when commands are unsupported and fallback is skills", async () => {
		await withTempRepo(async (root) => {
			await writeCommand(root, "assist", "Assist users.");

			await syncWithConfig(root, {
				targets: [
					{
						id: "copilot",
						outputs: {
							skills: { path: "out/skills" },
							commands: {
								path: "out/commands",
								fallback: () => "skills",
							},
						},
					},
				],
			});

			expect(await pathExists(path.join(root, "out", "skills", "assist", "SKILL.md"))).toBe(true);
			expect(await pathExists(path.join(root, "out", "commands", "assist.md"))).toBe(false);
		});
	});

	it("runs before/after sync and convert hooks", async () => {
		await withTempRepo(async (root) => {
			await writeSkill(root, "alpha", "alpha skill");
			await writeCommand(root, "hello", "Say hello.");
			await writeSubagent(root, "helper", "Assist.");
			await writeInstructionTemplate(root, "AGENTS.md", [], "Repo instructions");

			const syncEvents: string[] = [];
			const beforeConvert: string[] = [];
			const afterConvert: string[] = [];

			await syncWithConfig(root, {
				targets: [
					{
						id: "hooked",
						outputs: {
							skills: "out/skills",
							commands: { path: "out/commands" },
							subagents: { path: "out/agents" },
						},
						hooks: {
							beforeSync: ({ context }) => syncEvents.push(`before:${context.target.id}`),
							afterSync: ({ context }) => syncEvents.push(`after:${context.target.id}`),
							beforeConvert: ({ item }) => beforeConvert.push(`${item.itemType}:${item.name}`),
							afterConvert: ({ item }) => afterConvert.push(`${item.itemType}:${item.name}`),
						},
					},
				],
			});

			expect(syncEvents).toEqual(["before:hooked", "after:hooked"]);
			expect(beforeConvert).toHaveLength(4);
			expect(afterConvert).toHaveLength(4);
		});
	});

	it("reports collisions when non-instruction outputs share the same path", async () => {
		await withTempRepo(async (root) => {
			await writeSkill(root, "alpha", "alpha skill");
			await writeSkill(root, "beta", "beta skill");

			const summary = await syncWithConfig(root, {
				targets: [
					{
						id: "collision",
						outputs: {
							skills: {
								path: "out/skills",
								convert: ({ item }) => ({
									path: "out/collision.md",
									content: item.name,
								}),
							},
						},
					},
				],
			});

			const result = summary.results.find((entry) => entry.targetId === "collision");
			expect(result?.errors.some((error) => error.includes("Output collision detected"))).toBe(
				true,
			);
			expect(await pathExists(path.join(root, "out", "collision.md"))).toBe(false);
		});
	});

	it("allows multiple AGENTS outputs and keeps a single canonical file", async () => {
		await withTempRepo(async (root) => {
			await writeInstructionTemplate(
				root,
				"first.agents.md",
				["outputPath: docs/shared"],
				"First instructions",
			);
			await writeInstructionTemplate(
				root,
				"second.agents.md",
				["outputPath: docs/shared"],
				"Second instructions",
			);

			const summary = await syncWithConfig(root, {
				targets: [{ id: "canonical", outputs: {} }],
			});

			const outputPath = path.join(root, "docs", "shared", "AGENTS.md");
			expect(await pathExists(outputPath)).toBe(true);
			const contents = (await readFile(outputPath, "utf8")).trim();
			expect(["First instructions", "Second instructions"]).toContain(contents);
			const result = summary.results.find((entry) => entry.targetId === "canonical");
			expect(result?.errors.length ?? 0).toBe(0);
		});
	});

	it("continues syncing other targets when one target fails", async () => {
		await withTempRepo(async (root) => {
			await writeSkill(root, "alpha", "alpha skill");

			const summary = await syncWithConfig(root, {
				targets: [
					{
						id: "broken",
						outputs: {
							skills: {
								path: "out/broken",
								convert: () => ({ error: "boom" }),
							},
						},
					},
					{
						id: "healthy",
						outputs: { skills: "out/healthy" },
					},
				],
			});

			const broken = summary.results.find((entry) => entry.targetId === "broken");
			const healthy = summary.results.find((entry) => entry.targetId === "healthy");
			expect(broken?.status).toBe("failed");
			expect(healthy?.status).toBe("synced");
			expect(await pathExists(path.join(root, "out", "healthy", "alpha", "SKILL.md"))).toBe(true);
		});
	});

	it("skips instruction outputs only for targets that disable them", async () => {
		await withTempRepo(async (root) => {
			await writeInstructionTemplate(
				root,
				"AGENTS.md",
				[],
				"<agents alpha>Alpha</agents><agents beta>Beta</agents>",
			);

			await syncWithConfig(root, {
				targets: [
					{ id: "alpha", outputs: { skills: "out/alpha", instructions: false } },
					{ id: "beta", outputs: { skills: "out/beta" } },
				],
			});

			const outputPath = path.join(root, "AGENTS.md");
			expect(await pathExists(outputPath)).toBe(true);
			const contents = await readFile(outputPath, "utf8");
			expect(contents).toContain("Beta");
			expect(contents).not.toContain("Alpha");
		});
	});

	it("warns and skips colliding non-canonical AGENTS outputs", async () => {
		await withTempRepo(async (root) => {
			await writeInstructionTemplate(
				root,
				"AGENTS.md",
				[],
				"<agents primary>Primary</agents><agents secondary>Secondary</agents>",
			);

			const summary = await syncWithConfig(root, {
				targets: [
					{ id: "primary", outputs: { skills: "out/primary" } },
					{ id: "secondary", outputs: { skills: "out/secondary", instructions: "AGENTS.md" } },
				],
			});

			const outputPath = path.join(root, "AGENTS.md");
			expect(await pathExists(outputPath)).toBe(true);
			const contents = await readFile(outputPath, "utf8");
			expect(contents).toContain("Primary");
			expect(contents).not.toContain("Secondary");

			const secondary = summary.results.find((entry) => entry.targetId === "secondary");
			expect(
				secondary?.warnings.some((warning) => warning.includes("Skipped AGENTS.md collision")),
			).toBe(true);
		});
	});
});
