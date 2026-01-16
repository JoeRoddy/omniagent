import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveIgnorePreferencePath } from "../../src/lib/ignore-preferences.js";

const promptState = vi.hoisted(() => ({
	answers: [] as string[],
	prompts: [] as string[],
}));

vi.mock("node:readline/promises", () => ({
	createInterface: () => ({
		question: async (prompt: string) => {
			promptState.prompts.push(prompt);
			return promptState.answers.shift() ?? "";
		},
		close: () => {},
	}),
}));

import { runCli } from "../../src/cli/index.js";

async function withTempRepo(fn: (root: string, homeDir: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-sync-local-"));
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

async function withCwd(dir: string, fn: () => Promise<void>): Promise<void> {
	const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);
	try {
		await fn();
	} finally {
		cwdSpy.mockRestore();
	}
}

async function withTty(value: boolean, fn: () => Promise<void>): Promise<void> {
	const original = process.stdin.isTTY;
	process.stdin.isTTY = value;
	try {
		await fn();
	} finally {
		process.stdin.isTTY = original;
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

async function writeSharedSkill(root: string, name: string, body: string): Promise<void> {
	const dir = path.join(root, "agents", "skills", name);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "SKILL.md"), body, "utf8");
}

async function writeLocalPathSkill(root: string, name: string, body: string): Promise<void> {
	const dir = path.join(root, "agents", ".local", "skills", name);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "SKILL.md"), body, "utf8");
}

async function writeLocalSuffixSkill(root: string, name: string, body: string): Promise<void> {
	const dir = path.join(root, "agents", "skills", name);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "SKILL.local.md"), body, "utf8");
}

async function writeSharedCommand(root: string, name: string, body: string): Promise<void> {
	const dir = path.join(root, "agents", "commands");
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, `${name}.md`), body, "utf8");
}

async function writeLocalPathCommand(root: string, name: string, body: string): Promise<void> {
	const dir = path.join(root, "agents", ".local", "commands");
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, `${name}.md`), body, "utf8");
}

async function writeLocalSuffixCommand(root: string, name: string, body: string): Promise<void> {
	const dir = path.join(root, "agents", "commands");
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, `${name}.local.md`), body, "utf8");
}

async function writeSharedSubagent(root: string, fileName: string, name: string, body: string) {
	const dir = path.join(root, "agents", "agents");
	await mkdir(dir, { recursive: true });
	const contents = `---\nname: ${name}\n---\n${body}\n`;
	await writeFile(path.join(dir, `${fileName}.md`), contents, "utf8");
}

async function writeLocalPathSubagent(root: string, fileName: string, name: string, body: string) {
	const dir = path.join(root, "agents", ".local", "agents");
	await mkdir(dir, { recursive: true });
	const contents = `---\nname: ${name}\n---\n${body}\n`;
	await writeFile(path.join(dir, `${fileName}.md`), contents, "utf8");
}

function parseJsonOutput(logSpy: ReturnType<typeof vi.spyOn>) {
	const entry = logSpy.mock.calls
		.map((call) => call[0])
		.find((value) => typeof value === "string" && value.trim().startsWith("{"));
	if (!entry || typeof entry !== "string") {
		throw new Error("JSON output not found in console.log calls.");
	}
	return JSON.parse(entry) as Record<string, unknown>;
}

describe.sequential("sync command local config", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let exitSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		promptState.answers.length = 0;
		promptState.prompts.length = 0;
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
	});

	afterEach(() => {
		logSpy.mockRestore();
		errorSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it("syncs shared + local by default and strips .local outputs", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSharedSkill(root, "alpha", "shared alpha");
			await writeLocalSuffixSkill(root, "alpha", "local suffix alpha");
			await writeLocalPathSkill(root, "alpha", "local path alpha");
			await writeSharedSkill(root, "beta", "shared beta");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes", "--json"]);
			});

			const alphaOutput = await readFile(
				path.join(root, ".claude", "skills", "alpha", "SKILL.md"),
				"utf8",
			);
			const betaOutput = await readFile(
				path.join(root, ".claude", "skills", "beta", "SKILL.md"),
				"utf8",
			);
			expect(alphaOutput).toBe("local path alpha");
			expect(betaOutput).toBe("shared beta");
			expect(
				await pathExists(path.join(root, ".claude", "skills", "alpha", "SKILL.local.md")),
			).toBe(false);

			const summary = parseJsonOutput(logSpy) as {
				skills?: { sourceCounts?: { shared: number; local: number; excludedLocal: boolean } };
			};
			expect(summary.skills?.sourceCounts).toEqual({
				shared: 1,
				local: 1,
				excludedLocal: false,
			});
		});
	});

	it("excludes all local sources when --exclude-local is set", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSharedSkill(root, "alpha", "shared alpha");
			await writeLocalPathSkill(root, "alpha", "local alpha");
			await writeSharedSkill(root, "beta", "shared beta");

			await withCwd(root, async () => {
				await runCli([
					"node",
					"omniagent",
					"sync",
					"--only",
					"claude",
					"--exclude-local",
					"--yes",
					"--json",
				]);
			});

			const alphaOutput = await readFile(
				path.join(root, ".claude", "skills", "alpha", "SKILL.md"),
				"utf8",
			);
			expect(alphaOutput).toBe("shared alpha");

			const summary = parseJsonOutput(logSpy) as {
				skills?: { sourceCounts?: { shared: number; local: number; excludedLocal: boolean } };
			};
			expect(summary.skills?.sourceCounts).toEqual({
				shared: 2,
				local: 0,
				excludedLocal: true,
			});
		});
	});

	it("skips .local templating validation when local sources are excluded", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSharedSkill(root, "alpha", "shared alpha");
			await writeLocalSuffixSkill(root, "alpha", "<agents bogus>bad</agents>");

			await withCwd(root, async () => {
				await runCli([
					"node",
					"omniagent",
					"sync",
					"--only",
					"claude",
					"--exclude-local",
					"--yes",
					"--json",
				]);
			});

			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("does not parse local catalogs when local sources are excluded", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSharedSkill(root, "alpha", "shared alpha");
			const dir = path.join(root, "agents", ".local", "skills", "broken");
			await mkdir(dir, { recursive: true });
			await writeFile(
				path.join(dir, "SKILL.md"),
				"---\ntargets:\n  - unknown-target\n---\nbody\n",
				"utf8",
			);

			await withCwd(root, async () => {
				await runCli([
					"node",
					"omniagent",
					"sync",
					"--only",
					"claude",
					"--exclude-local",
					"--yes",
					"--json",
				]);
			});

			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("excludes local skills and commands while keeping local agents", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSharedSkill(root, "alpha", "shared skill");
			await writeLocalPathSkill(root, "alpha", "local skill");
			await writeSharedCommand(root, "deploy", "shared command");
			await writeLocalPathCommand(root, "deploy", "local command");
			await writeSharedSubagent(root, "assistant", "assistant", "shared agent");
			await writeLocalPathSubagent(root, "assistant", "assistant", "local agent");

			await withCwd(root, async () => {
				await runCli([
					"node",
					"omniagent",
					"sync",
					"--only",
					"claude",
					"--exclude-local=skills,commands",
					"--yes",
					"--json",
				]);
			});

			const skillOutput = await readFile(
				path.join(root, ".claude", "skills", "alpha", "SKILL.md"),
				"utf8",
			);
			const commandOutput = await readFile(
				path.join(root, ".claude", "commands", "deploy.md"),
				"utf8",
			);
			const agentOutput = await readFile(
				path.join(root, ".claude", "agents", "assistant.md"),
				"utf8",
			);

			expect(skillOutput).toBe("shared skill");
			expect(commandOutput).toBe("shared command");
			expect(agentOutput).toContain("local agent");

			const summary = parseJsonOutput(logSpy) as {
				skills?: { sourceCounts?: { excludedLocal: boolean } };
				commands?: { sourceCounts?: { excludedLocal: boolean } };
				subagents?: { sourceCounts?: { excludedLocal: boolean } };
			};
			expect(summary.skills?.sourceCounts?.excludedLocal).toBe(true);
			expect(summary.commands?.sourceCounts?.excludedLocal).toBe(true);
			expect(summary.subagents?.sourceCounts?.excludedLocal).toBe(false);
		});
	});

	it("rejects unknown local exclusion categories", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);

			await withCwd(root, async () => {
				await runCli([
					"node",
					"omniagent",
					"sync",
					"--only",
					"claude",
					"--exclude-local=skills,unknown",
				]);
			});

			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Unknown local category(s): unknown"),
			);
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	it("lists local items by category with their source paths", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeLocalPathSkill(root, "zeta", "local skill");
			await writeLocalSuffixCommand(root, "deploy", "local command");
			await writeLocalPathSubagent(root, "helper", "helper", "local agent");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--list-local"]);
			});

			const output = logSpy.mock.calls.map((call) => call[0]).join("\n");
			expect(output).toContain("Local skills (1):");
			expect(output).toContain("- zeta (path: agents/.local/skills/zeta/SKILL.md)");
			expect(output).toContain("Local commands (1):");
			expect(output).toContain("- deploy (suffix: agents/commands/deploy.local.md)");
			expect(output).toContain("Local agents (1):");
			expect(output).toContain("- helper (path: agents/.local/agents/helper.md)");
			expect(promptState.prompts).toHaveLength(0);
		});
	});

	it("prompts to add ignore rules and applies them after confirmation", async () => {
		await withTempRepo(async (root, homeDir) => {
			await createRepoRoot(root);
			await writeLocalPathSkill(root, "alpha", "local skill");
			await writeFile(path.join(root, ".gitignore"), "node_modules/\n", "utf8");

			promptState.answers.push("yes");

			await withCwd(root, async () => {
				await withTty(true, async () => {
					await runCli(["node", "omniagent", "sync", "--only", "claude"]);
				});
			});

			expect(promptState.prompts.some((prompt) => prompt.includes("Add ignore rules"))).toBe(true);
			const ignoreContents = await readFile(path.join(root, ".gitignore"), "utf8");
			expect(ignoreContents).toContain("agents/.local/");
			expect(ignoreContents).toContain("**/*.local/");
			expect(ignoreContents).toContain("**/*.local.md");

			const preferencePath = resolveIgnorePreferencePath(root, homeDir);
			expect(await pathExists(preferencePath)).toBe(false);
		});
	});

	it("records decline preferences and suppresses future prompts", async () => {
		await withTempRepo(async (root, homeDir) => {
			await createRepoRoot(root);
			await writeLocalPathSkill(root, "alpha", "local skill");
			await writeFile(path.join(root, ".gitignore"), "node_modules/\n", "utf8");

			promptState.answers.push("no");

			await withCwd(root, async () => {
				await withTty(true, async () => {
					await runCli(["node", "omniagent", "sync", "--only", "claude"]);
				});
			});

			const preferencePath = resolveIgnorePreferencePath(root, homeDir);
			expect(await pathExists(preferencePath)).toBe(true);
			const ignoreContents = await readFile(path.join(root, ".gitignore"), "utf8");
			expect(ignoreContents).not.toContain("omniagent local overrides");

			promptState.answers.push("yes");
			await withCwd(root, async () => {
				await withTty(true, async () => {
					await runCli(["node", "omniagent", "sync", "--only", "claude"]);
				});
			});

			expect(
				promptState.prompts.filter((prompt) => prompt.includes("Add ignore rules")),
			).toHaveLength(1);
		});
	});

	it("reports missing ignore rules in non-interactive runs", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeLocalPathSkill(root, "alpha", "local skill");
			await writeFile(path.join(root, ".gitignore"), "node_modules/\n", "utf8");

			await withCwd(root, async () => {
				await withTty(false, async () => {
					await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes", "--json"]);
				});
			});

			const summary = parseJsonOutput(logSpy) as { missingIgnoreRules?: boolean };
			expect(summary.missingIgnoreRules).toBe(true);
			expect(promptState.prompts).toHaveLength(0);
		});
	});
});
