import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli/index.js";

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-sync-"));
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

async function withCwd(dir: string, fn: () => Promise<void>): Promise<void> {
	const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);
	try {
		await fn();
	} finally {
		cwdSpy.mockRestore();
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

async function createCanonicalSkills(root: string): Promise<string> {
	const sourceDir = path.join(root, "agents", "skills");
	const skillDir = path.join(sourceDir, "example");
	await mkdir(skillDir, { recursive: true });
	await writeFile(path.join(skillDir, "SKILL.md"), "hello");
	return await realpath(sourceDir);
}

async function writeCanonicalSkillFile(
	root: string,
	fileName: string,
	contents: string,
): Promise<string> {
	const sourceDir = path.join(root, "agents", "skills");
	const skillName = path.parse(fileName).name;
	const skillDir = path.join(sourceDir, skillName);
	await mkdir(skillDir, { recursive: true });
	const filePath = path.join(skillDir, "SKILL.md");
	await writeFile(filePath, contents, "utf8");
	return filePath;
}

async function createCanonicalCommands(root: string): Promise<string> {
	const sourceDir = path.join(root, "agents", "commands");
	await mkdir(sourceDir, { recursive: true });
	await writeFile(path.join(sourceDir, "example.md"), "Say hello.");
	return await realpath(sourceDir);
}

async function writeCanonicalCommand(
	root: string,
	name: string,
	contents: string,
): Promise<string> {
	const sourceDir = path.join(root, "agents", "commands");
	await mkdir(sourceDir, { recursive: true });
	const filePath = path.join(sourceDir, `${name}.md`);
	await writeFile(filePath, contents, "utf8");
	return filePath;
}

async function writeSubagent(root: string, name: string, body: string): Promise<string> {
	const catalogDir = path.join(root, "agents", "agents");
	await mkdir(catalogDir, { recursive: true });
	const contents = `---\nname: ${name}\n---\n${body}\n`;
	const filePath = path.join(catalogDir, `${name}.md`);
	await writeFile(filePath, contents, "utf8");
	return filePath;
}

async function writeSubagentWithFrontmatter(
	root: string,
	fileName: string,
	frontmatterLines: string[],
	body: string,
): Promise<string> {
	const catalogDir = path.join(root, "agents", "agents");
	await mkdir(catalogDir, { recursive: true });
	const contents = ["---", ...frontmatterLines, "---", body, ""].join("\n");
	const filePath = path.join(catalogDir, `${fileName}.md`);
	await writeFile(filePath, contents, "utf8");
	return filePath;
}

async function writeRepoInstruction(
	root: string,
	relPath: string,
	contents: string,
): Promise<string> {
	const filePath = path.join(root, relPath);
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, contents, "utf8");
	return filePath;
}

describe.sequential("sync command", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let exitSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
		process.exitCode = undefined;
	});

	afterEach(() => {
		logSpy.mockRestore();
		errorSpy.mockRestore();
		exitSpy.mockRestore();
		process.exitCode = undefined;
	});

	it("syncs all targets from the repo root", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);
			await createCanonicalCommands(root);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync"]);
			});

			const codex = await readFile(
				path.join(root, ".codex", "skills", "example", "SKILL.md"),
				"utf8",
			);
			const claude = await readFile(
				path.join(root, ".claude", "skills", "example", "SKILL.md"),
				"utf8",
			);
			const copilot = await readFile(
				path.join(root, ".github", "skills", "example", "SKILL.md"),
				"utf8",
			);
			const gemini = await readFile(
				path.join(root, ".gemini", "skills", "example", "SKILL.md"),
				"utf8",
			);
			const claudeCommand = await readFile(
				path.join(root, ".claude", "commands", "example.md"),
				"utf8",
			);

			expect(codex).toBe("hello");
			expect(claude).toBe("hello");
			expect(copilot).toBe("hello");
			expect(gemini).toBe("hello");
			expect(claudeCommand).toContain("Say hello.");
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("respects --only filters", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);
			await createCanonicalCommands(root);
			await writeRepoInstruction(root, path.join("docs", "AGENTS.md"), "Repo instructions");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude"]);
			});

			expect(await pathExists(path.join(root, ".claude", "skills", "example", "SKILL.md"))).toBe(
				true,
			);
			expect(await pathExists(path.join(root, ".claude", "commands", "example.md"))).toBe(true);
			expect(await pathExists(path.join(root, ".codex", "skills"))).toBe(false);
			expect(await pathExists(path.join(root, ".github", "skills"))).toBe(false);
			expect(await pathExists(path.join(root, ".gemini", "skills"))).toBe(false);
			expect(await pathExists(path.join(root, ".gemini", "commands"))).toBe(false);
			expect(await pathExists(path.join(root, "docs", "CLAUDE.md"))).toBe(true);
			expect(await pathExists(path.join(root, "docs", "GEMINI.md"))).toBe(false);
		});
	});

	it("errors on unknown targets without syncing", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);
			await createCanonicalCommands(root);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--skip", "unknown"]);
			});

			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Error: Unknown target name(s): unknown."),
			);
			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(await pathExists(path.join(root, ".codex", "skills"))).toBe(false);
		});
	});

	it("errors on empty skill targets in frontmatter", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalCommands(root);
			const contents = ["---", "targets:", "---", "Hello"].join("\n");
			await writeCanonicalSkillFile(root, "empty", contents);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes"]);
			});

			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("has empty targets"));
			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(await pathExists(path.join(root, ".claude", "skills"))).toBe(false);
		});
	});

	it("errors on invalid command targets in frontmatter", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);
			await writeCanonicalCommand(
				root,
				"bad-command",
				["---", "targets:", "  - bogus", "---", "Say hello."].join("\n"),
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes"]);
			});

			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("unsupported targets"));
			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(await pathExists(path.join(root, ".claude", "commands"))).toBe(false);
		});
	});

	it("errors on empty subagent targets in frontmatter", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);
			await createCanonicalCommands(root);
			await writeSubagentWithFrontmatter(
				root,
				"helper",
				["name: helper", "targets:"],
				"Subagent body.",
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes"]);
			});

			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("has empty targets"));
			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(await pathExists(path.join(root, ".claude", "agents"))).toBe(false);
		});
	});

	it("applies --only then --skip when both are provided", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);
			await createCanonicalCommands(root);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude,codex", "--skip", "codex"]);
			});

			expect(errorSpy).not.toHaveBeenCalled();
			expect(exitSpy).not.toHaveBeenCalled();
			expect(await pathExists(path.join(root, ".claude", "skills", "example", "SKILL.md"))).toBe(
				true,
			);
			expect(await pathExists(path.join(root, ".codex", "skills"))).toBe(false);
		});
	});

	it("reports missing source paths as skipped without exiting", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await mkdir(path.join(root, "subdir"), { recursive: true });
			const skillsPath = path.join(root, "agents", "skills");
			const commandsPath = path.join(root, "agents", "commands");
			const localCommandsPath = path.join(root, "agents", ".local", "commands");

			await withCwd(path.join(root, "subdir"), async () => {
				await runCli(["node", "omniagent", "sync"]);
			});

			const loggedMessages = logSpy.mock.calls
				.map(([message]) => (typeof message === "string" ? message : ""))
				.join("\n");

			expect(loggedMessages).toContain(`Canonical config source not found at ${skillsPath}.`);
			expect(loggedMessages).toContain(
				`Command catalog directory not found at ${commandsPath} or ${localCommandsPath}.`,
			);
			expect(errorSpy).not.toHaveBeenCalled();
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("allows subagent-only sync when the catalog is missing", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "codex", "--yes"]);
			});

			expect(errorSpy).not.toHaveBeenCalled();
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("emits JSON summaries when --json is provided", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			const skillsPath = await createCanonicalSkills(root);
			const commandsPath = await createCanonicalCommands(root);
			await writeRepoInstruction(root, path.join("docs", "AGENTS.md"), "Instruction content");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--json"]);
			});

			expect(logSpy).toHaveBeenCalled();
			const output = logSpy.mock.calls[0]?.[0];
			const parsed = JSON.parse(output);
			expect(await realpath(parsed.skills.sourcePath)).toBe(skillsPath);
			expect(await realpath(parsed.commands.sourcePath)).toBe(commandsPath);
			expect(await realpath(parsed.instructions.sourcePath)).toBe(await realpath(root));
			expect(parsed.skills.results).toHaveLength(4);
			expect(parsed.commands.results).toHaveLength(4);
			expect(parsed.instructions.results).toHaveLength(4);
			expect(parsed.instructions.sourceCounts).toEqual({
				shared: 1,
				local: 0,
				excludedLocal: false,
			});
			expect(parsed.hadFailures).toBe(false);
		});
	});

	it("prints a plan summary in non-interactive runs", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);
			await createCanonicalCommands(root);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--yes"]);
			});

			const planned = logSpy.mock.calls.find(
				([message]) => typeof message === "string" && message.includes("Planned actions:"),
			);
			expect(planned).toBeTruthy();
		});
	});

	it("surfaces Codex scope limitations in non-interactive runs", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);
			await createCanonicalCommands(root);

			await withCwd(root, async () => {
				await runCli(["node", "kek", "sync", "--only", "codex", "--yes"]);
			});

			const warning = logSpy.mock.calls.find(
				([message]) => typeof message === "string" && message.includes("commands are user-only"),
			);
			expect(warning).toBeTruthy();
		});
	});

	it("surfaces command support and conversion notices in non-interactive runs", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalCommands(root);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude,copilot", "--yes"]);
			});

			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain(
				"Claude Code commands will be written to project and user locations.",
			);
			expect(output).toContain("GitHub Copilot CLI commands are configured to convert to skills.");
		});
	});

	it("applies templating consistently across skills, commands, and subagents", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeCanonicalSkillFile(
				root,
				"example.txt",
				"Skill<agents claude> OK</agents><agents not:claude> NO</agents>",
			);
			await writeCanonicalCommand(
				root,
				"example",
				"Command<agents claude> OK</agents><agents not:claude> NO</agents>",
			);
			await writeSubagent(
				root,
				"helper",
				"Subagent<agents claude> OK</agents><agents not:claude> NO</agents>",
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes"]);
			});

			const skillOutput = await readFile(
				path.join(root, ".claude", "skills", "example", "SKILL.md"),
				"utf8",
			);
			const commandOutput = await readFile(
				path.join(root, ".claude", "commands", "example.md"),
				"utf8",
			);
			const subagentOutput = await readFile(
				path.join(root, ".claude", "agents", "helper.md"),
				"utf8",
			);

			expect(skillOutput).toContain("OK");
			expect(skillOutput).not.toContain("NO");
			expect(commandOutput).toContain("OK");
			expect(commandOutput).not.toContain("NO");
			expect(subagentOutput).toContain("OK");
			expect(subagentOutput).not.toContain("NO");
		});
	});

	it("fails before writing outputs when templating is invalid in commands", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeCanonicalCommand(root, "broken", "Hi<agents bogus> invalid</agents>");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes"]);
			});

			expect(errorSpy).toHaveBeenCalled();
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Valid agents: codex, claude, gemini, copilot."),
			);
			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(await pathExists(path.join(root, ".claude", "commands"))).toBe(false);
		});
	});

	it("fails before writing outputs when templating is invalid in skills files", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeCanonicalSkillFile(
				root,
				"bad.txt",
				"Hi<agents claude,not:claude> broken</agents>",
			);
			await writeCanonicalCommand(root, "ok", "Say hello.");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes"]);
			});

			expect(errorSpy).toHaveBeenCalled();
			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(await pathExists(path.join(root, ".claude", "commands"))).toBe(false);
			expect(await pathExists(path.join(root, ".claude", "skills"))).toBe(false);
		});
	});

	it("skips targets listed in --skip", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--skip", "claude"]);
			});

			expect(await pathExists(path.join(root, ".claude", "skills"))).toBe(false);
			expect(await pathExists(path.join(root, ".codex", "skills", "example", "SKILL.md"))).toBe(
				true,
			);
			expect(await pathExists(path.join(root, ".gemini", "skills", "example", "SKILL.md"))).toBe(
				true,
			);
		});
	});

	it("errors when no targets remain after filtering", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--skip", "claude"]);
			});

			expect(errorSpy).toHaveBeenCalledWith("Error: No targets selected after applying filters.");
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	it("includes supported targets in sync help output", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--help"]);
			});

			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain("omniagent sync");
			expect(output).toContain("Options");
			expect(output).toContain("Supported targets:");
			expect(output).toContain("claude");
			expect(output).toContain("codex");
			expect(output).toContain("gemini");
			expect(output).toContain("copilot");
		});
	});

	it("prints per-target sync outcomes", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude,codex"]);
			});

			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain("Synced agents/skills for Claude Code.");
			expect(output).toContain("Synced agents/skills for OpenAI Codex.");
		});
	});

	it("preserves extra destination files during sync", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude"]);
			});

			const extraPath = path.join(root, ".claude", "skills", "example", "extra.txt");
			await writeFile(extraPath, "extra file", "utf8");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude"]);
			});

			expect(await readFile(extraPath, "utf8")).toBe("extra file");
		});
	});

	it("syncs from a repo subdirectory", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);
			await createCanonicalCommands(root);
			const subdir = path.join(root, "nested");
			await mkdir(subdir, { recursive: true });

			await withCwd(subdir, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude"]);
			});

			expect(await pathExists(path.join(root, ".claude", "skills", "example", "SKILL.md"))).toBe(
				true,
			);
			expect(await pathExists(path.join(root, ".claude", "commands", "example.md"))).toBe(true);
		});
	});

	it("does not rely on external sync tools", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);
			const originalPath = process.env.PATH;
			process.env.PATH = "";

			try {
				await withCwd(root, async () => {
					await runCli(["node", "omniagent", "sync", "--only", "claude"]);
				});
			} finally {
				process.env.PATH = originalPath;
			}

			expect(await pathExists(path.join(root, ".claude", "skills", "example", "SKILL.md"))).toBe(
				true,
			);
		});
	});

	it("continues after a per-target failure and exits non-zero", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);
			await writeFile(path.join(root, ".claude"), "not a directory", "utf8");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude,codex", "--yes"]);
			});

			expect(await pathExists(path.join(root, ".codex", "skills", "example", "SKILL.md"))).toBe(
				true,
			);
			expect(process.exitCode).toBe(1);
		});
	});

	it("honors frontmatter targets and strips target metadata in outputs", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeCanonicalSkillFile(
				root,
				"targeted.txt",
				["---", "targets:", "  - ClAuDe", "  - codex", "  - CLAUDE", "---", "Skill body"].join(
					"\n",
				),
			);
			await writeSubagentWithFrontmatter(
				root,
				"router",
				["name: router", "targetAgents: gemini"],
				"Route the request.",
			);
			await writeSubagentWithFrontmatter(
				root,
				"generalist",
				["name: generalist"],
				"Handle general tasks.",
			);
			await writeCanonicalCommand(
				root,
				"targeted",
				["---", "targets:", "  - claude", "  - gemini", "---", "Run it."].join("\n"),
			);
			await writeCanonicalCommand(root, "global", "Run everywhere.");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--yes"]);
			});

			const claudeSkill = path.join(root, ".claude", "skills", "targeted", "SKILL.md");
			const codexSkill = path.join(root, ".codex", "skills", "targeted", "SKILL.md");
			const geminiSkill = path.join(root, ".gemini", "skills", "targeted", "SKILL.md");
			const copilotSkill = path.join(root, ".github", "skills", "targeted", "SKILL.md");

			expect(await pathExists(claudeSkill)).toBe(true);
			expect(await pathExists(codexSkill)).toBe(true);
			expect(await pathExists(geminiSkill)).toBe(false);
			expect(await pathExists(copilotSkill)).toBe(false);

			const skillOutput = await readFile(claudeSkill, "utf8");
			expect(skillOutput).not.toContain("targets:");
			expect(skillOutput).not.toContain("targetAgents");

			const geminiSubagent = path.join(root, ".gemini", "skills", "router", "SKILL.md");
			expect(await pathExists(geminiSubagent)).toBe(true);
			expect(await pathExists(path.join(root, ".claude", "agents", "router.md"))).toBe(false);
			const subagentOutput = await readFile(geminiSubagent, "utf8");
			expect(subagentOutput).not.toContain("targets:");
			expect(subagentOutput).not.toContain("targetAgents");

			expect(await pathExists(path.join(root, ".claude", "agents", "generalist.md"))).toBe(true);
			expect(await pathExists(path.join(root, ".codex", "skills", "generalist", "SKILL.md"))).toBe(
				true,
			);

			const claudeCommand = path.join(root, ".claude", "commands", "targeted.md");
			const geminiCommand = path.join(root, ".gemini", "commands", "targeted.toml");
			const codexCommand = path.join(root, "home", ".codex", "prompts", "targeted.md");
			const copilotCommand = path.join(root, ".github", "skills", "targeted", "SKILL.md");
			expect(await pathExists(claudeCommand)).toBe(true);
			expect(await pathExists(geminiCommand)).toBe(true);
			expect(await pathExists(codexCommand)).toBe(false);
			expect(await pathExists(copilotCommand)).toBe(false);

			const claudeCommandOutput = await readFile(claudeCommand, "utf8");
			expect(claudeCommandOutput).not.toContain("targets:");
			expect(claudeCommandOutput).not.toContain("targetAgents");

			const globalClaude = path.join(root, ".claude", "commands", "global.md");
			const globalGemini = path.join(root, ".gemini", "commands", "global.toml");
			const globalCodex = path.join(root, "home", ".codex", "prompts", "global.md");
			const globalCopilot = path.join(root, ".github", "skills", "global", "SKILL.md");

			expect(await pathExists(globalClaude)).toBe(true);
			expect(await pathExists(globalGemini)).toBe(true);
			expect(await pathExists(globalCodex)).toBe(true);
			expect(await pathExists(globalCopilot)).toBe(true);
		});
	});
});
