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

async function writeLocalSuffixSubagent(
	root: string,
	fileName: string,
	name: string,
	body: string,
) {
	const dir = path.join(root, "agents", "agents");
	await mkdir(dir, { recursive: true });
	const contents = `---\nname: ${name}\n---\n${body}\n`;
	await writeFile(path.join(dir, `${fileName}.local.md`), contents, "utf8");
}

async function writeInstruction(root: string, relPath: string, body: string): Promise<void> {
	const filePath = path.join(root, relPath);
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, body, "utf8");
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

	it("removes previously synced local-only skills when excluding local sources", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSharedSkill(root, "alpha", "shared alpha");
			await writeLocalPathSkill(root, "beta", "local beta");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes", "--json"]);
			});

			expect(await pathExists(path.join(root, ".claude", "skills", "beta", "SKILL.md"))).toBe(true);

			logSpy.mockClear();

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

			expect(await pathExists(path.join(root, ".claude", "skills", "beta"))).toBe(false);
			const alphaOutput = await readFile(
				path.join(root, ".claude", "skills", "alpha", "SKILL.md"),
				"utf8",
			);
			expect(alphaOutput).toBe("shared alpha");
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

	it("applies path-over-suffix-over-shared precedence across all sync surfaces", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSharedSkill(root, "alpha", "shared skill");
			await writeLocalSuffixSkill(root, "alpha", "suffix skill");
			await writeLocalPathSkill(root, "alpha", "path skill");

			await writeSharedCommand(root, "deploy", "shared command");
			await writeLocalSuffixCommand(root, "deploy", "suffix command");
			await writeLocalPathCommand(root, "deploy", "path command");

			await writeSharedSubagent(root, "assistant", "assistant", "shared subagent");
			await writeLocalSuffixSubagent(root, "assistant", "assistant", "suffix subagent");
			await writeLocalPathSubagent(root, "assistant", "assistant", "path subagent");

			await writeInstruction(root, path.join("agents", "AGENTS.md"), "shared instructions");
			await writeInstruction(root, path.join("agents", "AGENTS.local.md"), "suffix instructions");
			await writeInstruction(root, path.join("agents", ".local", "AGENTS.md"), "path instructions");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes", "--json"]);
			});

			const skillOutput = await readFile(
				path.join(root, ".claude", "skills", "alpha", "SKILL.md"),
				"utf8",
			);
			const commandOutput = await readFile(
				path.join(root, ".claude", "commands", "deploy.md"),
				"utf8",
			);
			const subagentOutput = await readFile(
				path.join(root, ".claude", "agents", "assistant.md"),
				"utf8",
			);
			const instructionOutput = await readFile(path.join(root, "CLAUDE.md"), "utf8");

			expect(skillOutput).toBe("path skill");
			expect(commandOutput).toContain("path command");
			expect(subagentOutput).toContain("path subagent");
			expect(instructionOutput).toBe("path instructions");

			expect(
				await pathExists(path.join(root, ".claude", "skills", "alpha", "SKILL.local.md")),
			).toBe(false);
			expect(await pathExists(path.join(root, ".claude", "commands", "deploy.local.md"))).toBe(
				false,
			);
			expect(await pathExists(path.join(root, ".claude", "agents", "assistant.local.md"))).toBe(
				false,
			);
			expect(await pathExists(path.join(root, "CLAUDE.local.md"))).toBe(false);
		});
	});

	it("normalizes .local suffixes in outputs across all categories", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeLocalSuffixSkill(root, "suffix-skill", "suffix skill output");
			await writeLocalSuffixCommand(root, "suffix-command", "suffix command output");
			await writeLocalSuffixSubagent(root, "suffix-agent", "suffix-agent", "suffix agent output");
			await writeInstruction(
				root,
				path.join("agents", "AGENTS.local.md"),
				"template suffix output",
			);
			await writeInstruction(
				root,
				path.join("docs", "AGENTS.local.md"),
				"repo suffix instructions",
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes", "--json"]);
			});

			expect(
				await pathExists(path.join(root, ".claude", "skills", "suffix-skill", "SKILL.md")),
			).toBe(true);
			expect(await pathExists(path.join(root, ".claude", "commands", "suffix-command.md"))).toBe(
				true,
			);
			expect(await pathExists(path.join(root, ".claude", "agents", "suffix-agent.md"))).toBe(true);
			expect(await pathExists(path.join(root, "CLAUDE.md"))).toBe(true);
			expect(await pathExists(path.join(root, "docs", "CLAUDE.md"))).toBe(true);

			expect(
				await pathExists(path.join(root, ".claude", "skills", "suffix-skill", "SKILL.local.md")),
			).toBe(false);
			expect(
				await pathExists(path.join(root, ".claude", "commands", "suffix-command.local.md")),
			).toBe(false);
			expect(await pathExists(path.join(root, ".claude", "agents", "suffix-agent.local.md"))).toBe(
				false,
			);
			expect(await pathExists(path.join(root, "CLAUDE.local.md"))).toBe(false);
			expect(await pathExists(path.join(root, "docs", "CLAUDE.local.md"))).toBe(false);
		});
	});

	it("prefers colocated SKILL.local content regardless of frontmatter name and overlays local side files", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			const skillDir = path.join(root, "agents", "skills", "new-worktree");
			await mkdir(path.join(skillDir, "scripts"), { recursive: true });

			await writeFile(
				path.join(skillDir, "SKILL.md"),
				["---", "name: new-worktree", "description: shared", "---", "shared body"].join("\n"),
				"utf8",
			);
			await writeFile(
				path.join(skillDir, "SKILL.local.md"),
				["---", "name: joes-thing", "description: local", "---", "local body wins"].join("\n"),
				"utf8",
			);
			await writeFile(path.join(skillDir, "notes.md"), "shared notes", "utf8");
			await writeFile(path.join(skillDir, "notes.local.md"), "local notes", "utf8");
			await writeFile(path.join(skillDir, "scripts", "run.sh"), "shared run", "utf8");
			await writeFile(path.join(skillDir, "scripts", "run.local.sh"), "local run", "utf8");
			await writeFile(path.join(skillDir, "flags.local"), "local flags", "utf8");
			await writeFile(path.join(skillDir, ".env"), "SHARED_ENV=1", "utf8");
			await writeFile(path.join(skillDir, ".env.local"), "LOCAL_ENV=1", "utf8");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "codex", "--yes", "--json"]);
			});

			const outputRoot = path.join(root, ".codex", "skills", "new-worktree");
			const skillOutput = await readFile(path.join(outputRoot, "SKILL.md"), "utf8");
			const notesOutput = await readFile(path.join(outputRoot, "notes.md"), "utf8");
			const runOutput = await readFile(path.join(outputRoot, "scripts", "run.sh"), "utf8");
			const flagsOutput = await readFile(path.join(outputRoot, "flags"), "utf8");
			const envOutput = await readFile(path.join(outputRoot, ".env"), "utf8");
			const envLocalOutput = await readFile(path.join(outputRoot, ".env.local"), "utf8");

			expect(skillOutput).toContain("local body wins");
			expect(skillOutput).toContain("name: joes-thing");
			expect(notesOutput).toBe("local notes");
			expect(runOutput).toBe("local run");
			expect(flagsOutput).toBe("local flags");
			expect(envOutput).toBe("SHARED_ENV=1");
			expect(envLocalOutput).toBe("LOCAL_ENV=1");

			expect(await pathExists(path.join(outputRoot, "notes.local.md"))).toBe(false);
			expect(await pathExists(path.join(outputRoot, "scripts", "run.local.sh"))).toBe(false);
			expect(await pathExists(path.join(outputRoot, "flags.local"))).toBe(false);
		});
	});

	type ExclusionExpectation = {
		skills: "shared" | "local";
		commands: "shared" | "local";
		agents: "shared" | "local";
		instructions: "shared" | "local";
		excluded: {
			skills: boolean;
			commands: boolean;
			agents: boolean;
			instructions: boolean;
		};
	};

	const exclusionCases: Array<{
		name: string;
		flag: string;
		expected: ExclusionExpectation;
	}> = [
		{
			name: "global local exclusion",
			flag: "--exclude-local",
			expected: {
				skills: "shared",
				commands: "shared",
				agents: "shared",
				instructions: "shared",
				excluded: { skills: true, commands: true, agents: true, instructions: true },
			},
		},
		{
			name: "skills local exclusion",
			flag: "--exclude-local=skills",
			expected: {
				skills: "shared",
				commands: "local",
				agents: "local",
				instructions: "local",
				excluded: { skills: true, commands: false, agents: false, instructions: false },
			},
		},
		{
			name: "commands local exclusion",
			flag: "--exclude-local=commands",
			expected: {
				skills: "local",
				commands: "shared",
				agents: "local",
				instructions: "local",
				excluded: { skills: false, commands: true, agents: false, instructions: false },
			},
		},
		{
			name: "agents local exclusion",
			flag: "--exclude-local=agents",
			expected: {
				skills: "local",
				commands: "local",
				agents: "shared",
				instructions: "local",
				excluded: { skills: false, commands: false, agents: true, instructions: false },
			},
		},
		{
			name: "instructions local exclusion",
			flag: "--exclude-local=instructions",
			expected: {
				skills: "local",
				commands: "local",
				agents: "local",
				instructions: "shared",
				excluded: { skills: false, commands: false, agents: false, instructions: true },
			},
		},
		{
			name: "skills and commands local exclusion",
			flag: "--exclude-local=skills,commands",
			expected: {
				skills: "shared",
				commands: "shared",
				agents: "local",
				instructions: "local",
				excluded: { skills: true, commands: true, agents: false, instructions: false },
			},
		},
	];

	for (const exclusionCase of exclusionCases) {
		it(`supports ${exclusionCase.name}`, async () => {
			await withTempRepo(async (root) => {
				await createRepoRoot(root);
				await writeSharedSkill(root, "alpha", "shared skill");
				await writeLocalPathSkill(root, "alpha", "local skill");
				await writeSharedCommand(root, "deploy", "shared command");
				await writeLocalPathCommand(root, "deploy", "local command");
				await writeSharedSubagent(root, "assistant", "assistant", "shared subagent");
				await writeLocalPathSubagent(root, "assistant", "assistant", "local subagent");
				await writeInstruction(root, path.join("agents", "AGENTS.md"), "shared instructions");
				await writeInstruction(
					root,
					path.join("agents", ".local", "AGENTS.md"),
					"local instructions",
				);

				await withCwd(root, async () => {
					await runCli([
						"node",
						"omniagent",
						"sync",
						"--only",
						"claude",
						exclusionCase.flag,
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
				const subagentOutput = await readFile(
					path.join(root, ".claude", "agents", "assistant.md"),
					"utf8",
				);
				const instructionOutput = await readFile(path.join(root, "CLAUDE.md"), "utf8");

				expect(skillOutput).toBe(
					exclusionCase.expected.skills === "local" ? "local skill" : "shared skill",
				);
				expect(commandOutput).toContain(
					exclusionCase.expected.commands === "local" ? "local command" : "shared command",
				);
				expect(subagentOutput).toContain(
					exclusionCase.expected.agents === "local" ? "local subagent" : "shared subagent",
				);
				expect(instructionOutput).toBe(
					exclusionCase.expected.instructions === "local"
						? "local instructions"
						: "shared instructions",
				);

				const summary = parseJsonOutput(logSpy) as {
					skills?: { sourceCounts?: { excludedLocal: boolean } };
					commands?: { sourceCounts?: { excludedLocal: boolean } };
					subagents?: { sourceCounts?: { excludedLocal: boolean } };
					instructions?: { sourceCounts?: { excludedLocal: boolean } };
				};
				expect(summary.skills?.sourceCounts?.excludedLocal).toBe(
					exclusionCase.expected.excluded.skills,
				);
				expect(summary.commands?.sourceCounts?.excludedLocal).toBe(
					exclusionCase.expected.excluded.commands,
				);
				expect(summary.subagents?.sourceCounts?.excludedLocal).toBe(
					exclusionCase.expected.excluded.agents,
				);
				expect(summary.instructions?.sourceCounts?.excludedLocal).toBe(
					exclusionCase.expected.excluded.instructions,
				);
			});
		});
	}

	it("removes previously managed local-only outputs across all categories", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSharedSkill(root, "alpha", "shared alpha");
			await writeLocalPathSkill(root, "beta", "local beta");

			await writeSharedCommand(root, "deploy", "shared deploy");
			await writeLocalPathCommand(root, "cleanup", "local cleanup");

			await writeSharedSubagent(root, "assistant", "assistant", "shared assistant");
			await writeLocalPathSubagent(root, "rover", "rover", "local rover");

			await writeInstruction(root, path.join("agents", "AGENTS.md"), "shared instructions");
			await writeInstruction(
				root,
				path.join("agents", ".local", "ops.AGENTS.md"),
				["---", "outPutPath: ops/", "---", "local ops instructions"].join("\n"),
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes", "--json"]);
			});

			expect(await pathExists(path.join(root, ".claude", "skills", "beta", "SKILL.md"))).toBe(true);
			expect(await pathExists(path.join(root, ".claude", "commands", "cleanup.md"))).toBe(true);
			expect(await pathExists(path.join(root, ".claude", "agents", "rover.md"))).toBe(true);
			expect(await pathExists(path.join(root, "ops", "CLAUDE.md"))).toBe(true);

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

			expect(await pathExists(path.join(root, ".claude", "skills", "beta"))).toBe(false);
			expect(await pathExists(path.join(root, ".claude", "commands", "cleanup.md"))).toBe(false);
			expect(await pathExists(path.join(root, ".claude", "agents", "rover.md"))).toBe(false);
			expect(await pathExists(path.join(root, "ops", "CLAUDE.md"))).toBe(false);

			expect(await pathExists(path.join(root, ".claude", "skills", "alpha", "SKILL.md"))).toBe(
				true,
			);
			expect(await pathExists(path.join(root, ".claude", "commands", "deploy.md"))).toBe(true);
			expect(await pathExists(path.join(root, ".claude", "agents", "assistant.md"))).toBe(true);
			const rootInstructions = await readFile(path.join(root, "CLAUDE.md"), "utf8");
			expect(rootInstructions).toBe("shared instructions");
		});
	});

	it("prefers local repo AGENTS over shared for non-satisfied instruction outputs", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeInstruction(root, path.join("docs", "AGENTS.md"), "shared docs instructions");
			await writeInstruction(root, path.join("docs", "AGENTS.local.md"), "local docs instructions");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes", "--json"]);
			});

			const output = await readFile(path.join(root, "docs", "CLAUDE.md"), "utf8");
			const source = await readFile(path.join(root, "docs", "AGENTS.md"), "utf8");
			expect(output).toBe("local docs instructions");
			expect(source).toBe("shared docs instructions");
		});
	});

	it("keeps satisfied AGENTS sources ahead of local precedence for codex", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeInstruction(root, "AGENTS.md", "shared codex instructions");
			await writeInstruction(root, "AGENTS.local.md", "local codex instructions");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "codex", "--yes", "--json"]);
			});

			const source = await readFile(path.join(root, "AGENTS.md"), "utf8");
			expect(source).toBe("shared codex instructions");

			const summary = parseJsonOutput(logSpy) as {
				instructions?: { results?: Array<{ counts?: { skipped?: number } }> };
			};
			expect(summary.instructions?.results?.[0]?.counts?.skipped).toBeGreaterThan(0);
		});
	});

	it("prefers instruction templates over repo sources for the same output key", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeInstruction(root, "AGENTS.md", "repo root instructions");
			await writeInstruction(root, path.join("agents", "AGENTS.md"), "template root instructions");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes", "--json"]);
			});

			const output = await readFile(path.join(root, "CLAUDE.md"), "utf8");
			const source = await readFile(path.join(root, "AGENTS.md"), "utf8");
			expect(output).toBe("template root instructions");
			expect(source).toBe("repo root instructions");
		});
	});

	it("excludes local instruction templates and repo sources when requested", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeInstruction(root, path.join("agents", "AGENTS.md"), "shared template");
			await writeInstruction(root, path.join("agents", ".local", "AGENTS.md"), "local template");
			await writeInstruction(root, path.join("docs", "AGENTS.md"), "shared docs");
			await writeInstruction(root, path.join("docs", "AGENTS.local.md"), "local docs");

			await withCwd(root, async () => {
				await runCli([
					"node",
					"omniagent",
					"sync",
					"--only",
					"claude",
					"--exclude-local=instructions",
					"--yes",
					"--json",
				]);
			});

			const rootOutput = await readFile(path.join(root, "CLAUDE.md"), "utf8");
			const docsOutput = await readFile(path.join(root, "docs", "CLAUDE.md"), "utf8");
			expect(rootOutput).toBe("shared template");
			expect(docsOutput).toBe("shared docs");

			const summary = parseJsonOutput(logSpy) as {
				instructions?: { sourceCounts?: { excludedLocal: boolean } };
			};
			expect(summary.instructions?.sourceCounts?.excludedLocal).toBe(true);
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

	it("uses generic ignore rules when --agentsDir points outside the repository", async () => {
		const externalAgentsDir = await mkdtemp(path.join(os.tmpdir(), "omniagent-external-agents-"));
		try {
			await withTempRepo(async (root) => {
				await createRepoRoot(root);
				await writeFile(path.join(root, ".gitignore"), "node_modules/\n", "utf8");

				const localSkillDir = path.join(externalAgentsDir, ".local", "skills", "alpha");
				await mkdir(localSkillDir, { recursive: true });
				await writeFile(path.join(localSkillDir, "SKILL.md"), "outside local skill", "utf8");

				promptState.answers.push("yes");

				await withCwd(root, async () => {
					await withTty(true, async () => {
						await runCli([
							"node",
							"omniagent",
							"sync",
							"--only",
							"claude",
							"--agentsDir",
							externalAgentsDir,
						]);
					});
				});

				expect(promptState.prompts.some((prompt) => prompt.includes("Add ignore rules"))).toBe(
					true,
				);
				const ignoreContents = await readFile(path.join(root, ".gitignore"), "utf8");
				expect(ignoreContents).toContain("**/*.local/");
				expect(ignoreContents).toContain("**/*.local.md");
				expect(ignoreContents).not.toContain("agents/.local/");
			});
		} finally {
			await rm(externalAgentsDir, { recursive: true, force: true });
		}
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
