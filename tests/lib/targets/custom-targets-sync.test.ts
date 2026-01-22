import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncInstructions } from "../../../src/lib/instructions/sync.js";
import { syncSkills } from "../../../src/lib/skills/sync.js";
import { syncSlashCommands } from "../../../src/lib/slash-commands/sync.js";
import { syncSubagents } from "../../../src/lib/subagents/sync.js";
import { createTargetNameResolver } from "../../../src/lib/sync-targets.js";
import type {
	OutputWriter,
	ResolvedTarget,
	TargetOutputs,
} from "../../../src/lib/targets/config-types.js";
import { readManagedOutputs } from "../../../src/lib/targets/managed-outputs.js";

const VALID_AGENTS = ["acme", "beta", "gamma"];

async function withTempRepo(fn: (root: string, homeDir: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-custom-targets-"));
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

async function createRepoRoot(root: string): Promise<void> {
	await writeFile(path.join(root, "package.json"), "{}", "utf8");
}

async function writeSkill(root: string, name: string, body: string): Promise<void> {
	const dir = path.join(root, "agents", "skills", name);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "SKILL.md"), body, "utf8");
}

async function writeCommand(root: string, name: string, body: string): Promise<void> {
	const dir = path.join(root, "agents", "commands");
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, `${name}.md`), body, "utf8");
}

async function writeSubagent(root: string, name: string, body: string): Promise<void> {
	const dir = path.join(root, "agents", "agents");
	await mkdir(dir, { recursive: true });
	const contents = `---\nname: ${name}\n---\n${body}\n`;
	await writeFile(path.join(dir, `${name}.md`), contents, "utf8");
}

async function writeInstructionTemplate(
	root: string,
	relPath: string,
	contents: string,
): Promise<void> {
	const filePath = path.join(root, relPath);
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, contents, "utf8");
}

function createTarget(id: string, outputs: TargetOutputs, overrides?: Partial<ResolvedTarget>) {
	return {
		id,
		displayName: overrides?.displayName ?? id,
		aliases: overrides?.aliases ?? [],
		outputs,
		hooks: overrides?.hooks,
		isBuiltIn: overrides?.isBuiltIn ?? false,
		isCustomized: overrides?.isCustomized ?? true,
	};
}

describe("custom target sync", () => {
	it("writes custom target outputs for skills, subagents, commands, and instructions", async () => {
		await withTempRepo(async (root, homeDir) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha", "Alpha skill");
			await writeCommand(root, "hello", "Say hello.");
			await writeSubagent(root, "helper", "Helper body");
			await writeInstructionTemplate(root, path.join("agents", "AGENTS.md"), "Root instructions");
			await writeInstructionTemplate(
				root,
				path.join("agents", "docs.AGENTS.md"),
				["---", "outPutPath: docs", "---", "Docs instructions"].join("\n"),
			);

			const target = createTarget("acme", {
				skills: "{repoRoot}/.acme/skills/{itemName}",
				subagents: "{repoRoot}/.acme/agents/{itemName}.md",
				commands: {
					projectPath: "{repoRoot}/.acme/commands/{itemName}.md",
					userPath: "{homeDir}/.acme/commands/{itemName}.md",
				},
				instructions: "ACME.md",
			});

			await syncSkills({
				repoRoot: root,
				targets: [target],
				validAgents: VALID_AGENTS,
				removeMissing: true,
			});
			await syncSubagents({
				repoRoot: root,
				targets: [target],
				validAgents: VALID_AGENTS,
				removeMissing: true,
			});
			await syncSlashCommands({
				repoRoot: root,
				targets: [target],
				validAgents: VALID_AGENTS,
				removeMissing: true,
			});
			await syncInstructions({
				repoRoot: root,
				targets: [target],
				validAgents: VALID_AGENTS,
				nonInteractive: true,
			});

			const skillOutput = await readFile(
				path.join(root, ".acme", "skills", "alpha", "SKILL.md"),
				"utf8",
			);
			const subagentOutput = await readFile(
				path.join(root, ".acme", "agents", "helper.md"),
				"utf8",
			);
			const commandProject = await readFile(
				path.join(root, ".acme", "commands", "hello.md"),
				"utf8",
			);
			const commandUser = await readFile(
				path.join(homeDir, ".acme", "commands", "hello.md"),
				"utf8",
			);
			const rootInstructions = await readFile(path.join(root, "ACME.md"), "utf8");
			const docsInstructions = await readFile(path.join(root, "docs", "ACME.md"), "utf8");

			expect(skillOutput).toBe("Alpha skill");
			expect(subagentOutput).toContain("Helper body");
			expect(commandProject).toContain("Say hello.");
			expect(commandUser).toContain("Say hello.");
			expect(rootInstructions).toBe("Root instructions");
			expect(docsInstructions).toBe("Docs instructions");
		});
	});

	it("skips sync when an output type is not configured", async () => {
		await withTempRepo(async (root) => {
			await writeSkill(root, "alpha", "Alpha skill");

			const target = createTarget("acme", {
				instructions: "ACME.md",
			});

			const summary = await syncSkills({
				repoRoot: root,
				targets: [target],
				validAgents: VALID_AGENTS,
				removeMissing: true,
			});

			expect(summary.results).toHaveLength(0);
			expect(summary.hadFailures).toBe(false);
			expect(await pathExists(path.join(root, ".acme"))).toBe(false);
		});
	});

	it("applies fallback conversions for subagents and commands", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSubagent(root, "helper", "Helper body");
			await writeCommand(root, "hello", "Say hello.");

			const target = createTarget("acme", {
				skills: "{repoRoot}/.acme/skills/{itemName}",
				subagents: {
					path: "{repoRoot}/.acme/agents/{itemName}.md",
					fallback: { mode: "convert", targetType: "skills" },
				},
				commands: {
					projectPath: "{repoRoot}/.acme/commands/{itemName}.md",
					fallback: { mode: "convert", targetType: "skills" },
				},
			});

			await syncSubagents({
				repoRoot: root,
				targets: [target],
				validAgents: VALID_AGENTS,
				removeMissing: true,
			});
			await syncSlashCommands({
				repoRoot: root,
				targets: [target],
				validAgents: VALID_AGENTS,
				removeMissing: true,
			});

			const subagentSkill = await readFile(
				path.join(root, ".acme", "skills", "helper", "SKILL.md"),
				"utf8",
			);
			const commandSkill = await readFile(
				path.join(root, ".acme", "skills", "hello", "SKILL.md"),
				"utf8",
			);

			expect(subagentSkill).toContain("Helper body");
			expect(commandSkill).toContain("# hello");
		});
	});

	it("summarizes subagent converter errors with item names", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSubagent(root, "helper", "Helper body");
			await writeSubagent(root, "runner", "Runner body");
			const outputDir = path.join(root, "converted-subagents");

			const target = createTarget("acme", {
				subagents: {
					path: "{repoRoot}/.acme/agents/{itemName}.md",
					converter: {
						convert: (item) => {
							const name = (item as { resolvedName?: string }).resolvedName ?? "";
							if (name === "helper") {
								return { error: "bad helper" };
							}
							return {
								output: {
									outputPath: path.join(outputDir, `${name}.md`),
									content: "ok",
								},
							};
						},
					},
				},
			});

			const summary = await syncSubagents({
				repoRoot: root,
				targets: [target],
				validAgents: VALID_AGENTS,
				removeMissing: true,
			});

			expect(summary.hadFailures).toBe(true);
			expect(await readFile(path.join(outputDir, "runner.md"), "utf8")).toBe("ok");
			expect(
				summary.warnings.some(
					(warning) =>
						warning.includes("Converter errors in subagents") && warning.includes("helper"),
				),
			).toBe(true);
		});
	});

	it("summarizes command converter errors with item names", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeCommand(root, "hello", "Say hello.");
			await writeCommand(root, "goodbye", "Say goodbye.");
			const outputDir = path.join(root, "converted-commands");

			const target = createTarget("acme", {
				commands: {
					projectPath: "{repoRoot}/.acme/commands/{itemName}.md",
					converter: {
						convert: (item) => {
							const name = (item as { name?: string }).name ?? "";
							if (name === "hello") {
								return { error: "bad hello" };
							}
							return {
								output: {
									outputPath: path.join(outputDir, `${name}.md`),
									content: "ok",
								},
							};
						},
					},
				},
			});

			const summary = await syncSlashCommands({
				repoRoot: root,
				targets: [target],
				validAgents: VALID_AGENTS,
				removeMissing: true,
			});

			expect(summary.hadFailures).toBe(true);
			expect(await readFile(path.join(outputDir, "goodbye.md"), "utf8")).toBe("ok");
			expect(
				summary.warnings.some(
					(warning) =>
						warning.includes("Converter errors in commands") && warning.includes("hello"),
				),
			).toBe(true);
		});
	});

	it("supports converter outputs and skip decisions", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha", "Alpha skill");
			await writeSkill(root, "beta", "Beta skill");
			const outputDir = path.join(root, "converted");

			const target = createTarget("acme", {
				skills: {
					path: "{repoRoot}/.acme/skills/{itemName}",
					converter: {
						convert: (item) => {
							const name = (item as { name?: string }).name ?? "";
							if (name === "alpha") {
								return {
									outputs: [
										{
											outputPath: path.join(outputDir, "alpha-1.txt"),
											content: "first",
										},
										{
											outputPath: path.join(outputDir, "alpha-2.txt"),
											content: "second",
										},
									],
								};
							}
							return { skip: true };
						},
					},
				},
			});

			const summary = await syncSkills({
				repoRoot: root,
				targets: [target],
				validAgents: VALID_AGENTS,
				removeMissing: true,
			});

			expect(summary.hadFailures).toBe(false);
			expect(await readFile(path.join(outputDir, "alpha-1.txt"), "utf8")).toBe("first");
			expect(await readFile(path.join(outputDir, "alpha-2.txt"), "utf8")).toBe("second");
			expect(await pathExists(path.join(root, ".acme", "skills"))).toBe(false);
		});
	});

	it("continues after converter errors and reports failure", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha", "Alpha skill");
			await writeSkill(root, "gamma", "Gamma skill");
			const outputPath = path.join(root, "converted", "gamma.txt");

			const target = createTarget("acme", {
				skills: {
					path: "{repoRoot}/.acme/skills/{itemName}",
					converter: {
						convert: (item) => {
							const name = (item as { name?: string }).name ?? "";
							if (name === "alpha") {
								return { error: "bad alpha" };
							}
							return {
								output: {
									outputPath,
									content: "gamma",
								},
							};
						},
					},
				},
			});

			const summary = await syncSkills({
				repoRoot: root,
				targets: [target],
				validAgents: VALID_AGENTS,
				removeMissing: true,
			});

			expect(summary.hadFailures).toBe(true);
			expect(await readFile(outputPath, "utf8")).toBe("gamma");
			expect(
				summary.warnings.some(
					(warning) => warning.includes("Converter errors in skills") && warning.includes("alpha"),
				),
			).toBe(true);
			const result = summary.results.find((entry) => entry.targetName === "acme");
			expect(result?.status).toBe("failed");
		});
	});

	it("uses default writers for skill output collisions", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha", "Alpha skill");

			const customWriter: OutputWriter = {
				id: "custom-writer",
				write: async ({ outputPath }) => {
					await mkdir(outputPath, { recursive: true });
					await writeFile(path.join(outputPath, "SKILL.md"), "CUSTOM", "utf8");
					return { status: "created" };
				},
			};

			const targetA = createTarget("alpha", {
				skills: {
					path: "{repoRoot}/.shared/skills/{itemName}",
					writer: customWriter,
				},
			});
			const targetB = createTarget("beta", {
				skills: "{repoRoot}/.shared/skills/{itemName}",
			});

			await syncSkills({
				repoRoot: root,
				targets: [targetA, targetB],
				validAgents: VALID_AGENTS,
				removeMissing: true,
			});

			const output = await readFile(
				path.join(root, ".shared", "skills", "alpha", "SKILL.md"),
				"utf8",
			);
			expect(output).toBe("Alpha skill");
		});
	});

	it("errors when multiple targets collide on command outputs", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeCommand(root, "hello", "Say hello.");

			const targetA = createTarget("alpha", {
				commands: {
					projectPath: "{repoRoot}/.shared/commands/{itemName}.md",
				},
			});
			const targetB = createTarget("beta", {
				commands: {
					projectPath: "{repoRoot}/.shared/commands/{itemName}.md",
				},
			});

			const summary = await syncSlashCommands({
				repoRoot: root,
				targets: [targetA, targetB],
				validAgents: VALID_AGENTS,
				removeMissing: true,
			});

			expect(summary.hadFailures).toBe(true);
			const alpha = summary.results.find((entry) => entry.targetName === "alpha");
			const beta = summary.results.find((entry) => entry.targetName === "beta");
			expect(alpha?.status).toBe("failed");
			expect(beta?.status).toBe("failed");
			expect(alpha?.error).toContain("collision");
			expect(await pathExists(path.join(root, ".shared", "commands", "hello.md"))).toBe(false);
		});
	});

	it("groups instruction outputs across targets", async () => {
		await withTempRepo(async (root) => {
			await writeInstructionTemplate(root, path.join("agents", "AGENTS.md"), "Shared instructions");

			const targetA = createTarget("alpha", {
				instructions: {
					filename: "AGENTS.md",
					group: "shared",
				},
			});
			const targetB = createTarget("beta", {
				instructions: {
					filename: "AGENTS.md",
					group: "shared",
				},
			});

			const summary = await syncInstructions({
				repoRoot: root,
				targets: [targetA, targetB],
				validAgents: VALID_AGENTS,
				nonInteractive: true,
			});

			const output = await readFile(path.join(root, "AGENTS.md"), "utf8");
			expect(output).toBe("Shared instructions");

			const alphaResult = summary.results.find((entry) => entry.targetName === "alpha");
			const betaResult = summary.results.find((entry) => entry.targetName === "beta");
			expect(alphaResult?.counts.created).toBe(1);
			expect(betaResult?.counts.total).toBe(0);
			expect(betaResult?.message).toContain("Shared AGENTS.md output with alpha");
		});
	});

	it("uses default instruction writer when outputs collide across groups", async () => {
		await withTempRepo(async (root) => {
			await writeInstructionTemplate(root, path.join("agents", "AGENTS.md"), "Shared instructions");

			const customWriter: OutputWriter = {
				id: "custom-instruction-writer",
				write: async ({ outputPath }) => {
					await mkdir(path.dirname(outputPath), { recursive: true });
					await writeFile(outputPath, "CUSTOM", "utf8");
					return { status: "created" };
				},
			};

			const targetA = createTarget("alpha", {
				instructions: {
					filename: "AGENTS.md",
					writer: customWriter,
				},
			});
			const targetB = createTarget("beta", {
				instructions: {
					filename: "AGENTS.md",
					writer: customWriter,
				},
			});

			await syncInstructions({
				repoRoot: root,
				targets: [targetA, targetB],
				validAgents: VALID_AGENTS,
				nonInteractive: true,
			});

			const output = await readFile(path.join(root, "AGENTS.md"), "utf8");
			expect(output).toBe("Shared instructions");
		});
	});

	it("honors instruction targets and output directories", async () => {
		await withTempRepo(async (root) => {
			await writeInstructionTemplate(
				root,
				path.join("agents", "team.AGENTS.md"),
				["---", "targets:", "  - acme", "outPutPath: docs/team", "---", "Team"].join("\n"),
			);
			await writeInstructionTemplate(
				root,
				path.join("agents", "ops.AGENTS.md"),
				["---", "targets:", "  - beta", "outPutPath: docs/ops", "---", "Ops"].join("\n"),
			);

			const targetA = createTarget("acme", {
				instructions: "{targetId}.md",
			});
			const targetB = createTarget("beta", {
				instructions: "{targetId}.md",
			});
			const resolver = createTargetNameResolver([targetA, targetB]);

			await syncInstructions({
				repoRoot: root,
				targets: [targetA, targetB],
				resolveTargetName: resolver.resolveTargetName,
				validAgents: VALID_AGENTS,
				nonInteractive: true,
			});

			expect(await readFile(path.join(root, "docs", "team", "acme.md"), "utf8")).toBe("Team");
			expect(await readFile(path.join(root, "docs", "ops", "beta.md"), "utf8")).toBe("Ops");
			expect(await pathExists(path.join(root, "docs", "team", "beta.md"))).toBe(false);
		});
	});

	it("defaults repo instruction outputs to the source directory", async () => {
		await withTempRepo(async (root) => {
			await writeInstructionTemplate(root, path.join("docs", "AGENTS.md"), "Repo instructions");

			const target = createTarget("acme", {
				instructions: "ACME.md",
			});

			await syncInstructions({
				repoRoot: root,
				targets: [target],
				validAgents: VALID_AGENTS,
				nonInteractive: true,
			});

			expect(await readFile(path.join(root, "docs", "ACME.md"), "utf8")).toBe("Repo instructions");
		});
	});

	it("tracks and removes managed outputs when sources are missing", async () => {
		await withTempRepo(async (root, homeDir) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha", "Alpha skill");

			const target = createTarget("acme", {
				skills: "{repoRoot}/.acme/skills/{itemName}",
			});

			await syncSkills({
				repoRoot: root,
				targets: [target],
				validAgents: VALID_AGENTS,
				removeMissing: true,
			});

			const outputPath = path.join(root, ".acme", "skills", "alpha");
			expect(await pathExists(outputPath)).toBe(true);

			const manifest = await readManagedOutputs(root, homeDir);
			expect(manifest?.entries.length).toBe(1);

			await rm(path.join(root, "agents", "skills", "alpha"), { recursive: true, force: true });

			await syncSkills({
				repoRoot: root,
				targets: [target],
				validAgents: VALID_AGENTS,
				removeMissing: true,
			});

			expect(await pathExists(outputPath)).toBe(false);
		});
	});

	it("skips removal when managed outputs are modified", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha", "Alpha skill");

			const target = createTarget("acme", {
				skills: "{repoRoot}/.acme/skills/{itemName}",
			});

			await syncSkills({
				repoRoot: root,
				targets: [target],
				validAgents: VALID_AGENTS,
				removeMissing: true,
			});

			const outputFile = path.join(root, ".acme", "skills", "alpha", "SKILL.md");
			await writeFile(outputFile, "Modified", "utf8");
			await rm(path.join(root, "agents", "skills", "alpha"), { recursive: true, force: true });

			await syncSkills({
				repoRoot: root,
				targets: [target],
				validAgents: VALID_AGENTS,
				removeMissing: true,
			});

			expect(await readFile(outputFile, "utf8")).toBe("Modified");
		});
	});

	it("runs global and target hooks for sync and conversion", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha", "Alpha skill");

			const calls: string[] = [];
			const target = createTarget(
				"acme",
				{
					skills: {
						path: "{repoRoot}/.acme/skills/{itemName}",
						converter: {
							convert: () => {
								calls.push("convert");
								return {
									output: {
										outputPath: path.join(root, "hooked.txt"),
										content: "hooked",
									},
								};
							},
						},
					},
				},
				{
					hooks: {
						preSync: () => calls.push("target-preSync"),
						postSync: () => calls.push("target-postSync"),
						preConvert: () => calls.push("target-preConvert"),
						postConvert: () => calls.push("target-postConvert"),
					},
				},
			);

			await syncSkills({
				repoRoot: root,
				targets: [target],
				validAgents: VALID_AGENTS,
				removeMissing: true,
				hooks: {
					preSync: () => calls.push("global-preSync"),
					postSync: () => calls.push("global-postSync"),
					preConvert: () => calls.push("global-preConvert"),
					postConvert: () => calls.push("global-postConvert"),
				},
			});

			expect(calls).toEqual([
				"global-preSync",
				"target-preSync",
				"global-preConvert",
				"target-preConvert",
				"convert",
				"global-postConvert",
				"target-postConvert",
				"global-postSync",
				"target-postSync",
			]);
			expect(await readFile(path.join(root, "hooked.txt"), "utf8")).toBe("hooked");
		});
	});
});
