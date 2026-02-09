import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli/index.js";

const DEFAULT_CLI_COMMANDS = ["codex", "claude", "gemini", "copilot"];

async function createFakeCliBin(
	root: string,
	commands: string[] = DEFAULT_CLI_COMMANDS,
	binDirName = "bin",
): Promise<string> {
	const binDir = path.join(root, binDirName);
	await mkdir(binDir, { recursive: true });
	const isWindows = process.platform === "win32";
	for (const command of commands) {
		const basePath = path.join(binDir, command);
		const contents = isWindows ? "@echo off\r\n" : "#!/usr/bin/env sh\nexit 0\n";
		await writeFile(basePath, contents, "utf8");
		await chmod(basePath, 0o755);
		if (isWindows) {
			const cmdPath = path.join(binDir, `${command}.cmd`);
			await writeFile(cmdPath, "@echo off\r\n", "utf8");
		}
	}
	return binDir;
}

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-sync-"));
	const homeDir = path.join(root, "home");
	await mkdir(homeDir, { recursive: true });
	const homeSpy = vi.spyOn(os, "homedir").mockReturnValue(homeDir);
	const originalPath = process.env.PATH;
	try {
		const binDir = await createFakeCliBin(root);
		process.env.PATH = [binDir, originalPath].filter(Boolean).join(path.delimiter);
		await fn(root);
	} finally {
		process.env.PATH = originalPath;
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

async function writeScriptedCommand(
	root: string,
	name: string,
	scriptBody: string,
	tag: "nodejs" | "shell" = "nodejs",
): Promise<string> {
	const contents = ["Before", `<${tag}>`, scriptBody, `</${tag}>`, "After"].join("\n");
	return writeCanonicalCommand(root, name, contents);
}

function shellFailureScript(): string {
	if (process.platform === "win32") {
		return ["echo boom 1>&2", "exit /b 1"].join("\n");
	}
	return ["echo boom >&2", "exit 1"].join("\n");
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

	it("syncs only targets with CLIs on PATH and reports skip reasons", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);
			await createCanonicalCommands(root);

			const binDir = await createFakeCliBin(root, ["claude"], "bin-claude");
			const originalPath = process.env.PATH;
			process.env.PATH = binDir;
			try {
				await withCwd(root, async () => {
					await runCli(["node", "omniagent", "sync"]);
				});
			} finally {
				process.env.PATH = originalPath;
			}

			expect(await pathExists(path.join(root, ".claude", "skills", "example", "SKILL.md"))).toBe(
				true,
			);
			expect(await pathExists(path.join(root, ".codex", "skills"))).toBe(false);
			expect(await pathExists(path.join(root, ".github", "skills"))).toBe(false);
			expect(await pathExists(path.join(root, ".gemini", "skills"))).toBe(false);

			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain("Skipped OpenAI Codex: CLI not found on PATH.");
			expect(output).toContain("CLI not found on PATH.");
		});
	});

	it("warns when CLI availability checks are inconclusive", async () => {
		if (process.platform === "win32") {
			return;
		}

		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);

			const binDir = path.join(root, "blocked-bin");
			await mkdir(binDir, { recursive: true });
			const cliPath = path.join(binDir, "claude");
			await writeFile(cliPath, "#!/usr/bin/env sh\nexit 0\n", "utf8");
			await chmod(cliPath, 0o644);

			const originalPath = process.env.PATH;
			process.env.PATH = binDir;
			try {
				await withCwd(root, async () => {
					await runCli(["node", "omniagent", "sync"]);
				});
			} finally {
				process.env.PATH = originalPath;
			}

			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain("CLI availability could not be confirmed.");
			expect(output).toContain("Unable to verify claude on PATH");
			expect(await pathExists(path.join(root, ".claude", "skills"))).toBe(false);
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

	it("exits successfully with guidance when no targets are available", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);

			const originalPath = process.env.PATH;
			process.env.PATH = "";
			try {
				await withCwd(root, async () => {
					await runCli(["node", "omniagent", "sync"]);
				});
			} finally {
				process.env.PATH = originalPath;
			}

			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain("No available targets detected.");
			expect(errorSpy).not.toHaveBeenCalled();
			expect(exitSpy).not.toHaveBeenCalled();
			expect(await pathExists(path.join(root, ".codex", "skills"))).toBe(false);
		});
	});

	it("retains outputs when a previously synced target becomes unavailable", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);
			await createCanonicalCommands(root);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync"]);
			});

			const claudeSkillPath = path.join(root, ".claude", "skills", "example", "SKILL.md");
			const originalContents = await readFile(claudeSkillPath, "utf8");
			const updatedContents = `${originalContents}\nlocal edit`;
			await writeFile(claudeSkillPath, updatedContents, "utf8");

			logSpy.mockClear();
			const originalPath = process.env.PATH;
			process.env.PATH = "";
			try {
				await withCwd(root, async () => {
					await runCli(["node", "omniagent", "sync"]);
				});
			} finally {
				process.env.PATH = originalPath;
			}

			expect(await readFile(claudeSkillPath, "utf8")).toBe(updatedContents);
			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain("No available targets detected.");
			expect(output).toContain("Skipped Claude Code");
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

	it("renders nodejs blocks in synced command outputs", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeScriptedCommand(root, "scripted", "return ' dynamic content ';");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes"]);
			});

			const output = await readFile(path.join(root, ".claude", "commands", "scripted.md"), "utf8");
			expect(output).toContain("Before");
			expect(output).toContain("dynamic content");
			expect(output).toContain("After");
			expect(output).not.toContain("<nodejs>");
		});
	});

	it("renders shell blocks in synced command outputs", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeScriptedCommand(root, "shell-scripted", "echo dynamic-shell-content", "shell");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes"]);
			});

			const output = await readFile(
				path.join(root, ".claude", "commands", "shell-scripted.md"),
				"utf8",
			);
			expect(output).toContain("Before");
			expect(output).toContain("dynamic-shell-content");
			expect(output).toContain("After");
			expect(output).not.toContain("<shell>");
		});
	});

	it("updates script output when repository content changes between sync runs", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await mkdir(path.join(root, "docs"), { recursive: true });
			await writeFile(path.join(root, "docs", "alpha.md"), "# alpha", "utf8");
			await writeScriptedCommand(
				root,
				"docs-index",
				[
					'const fs = require("node:fs/promises");',
					"const entries = await fs.readdir('docs');",
					"return entries",
					"  .filter((entry) => entry.endsWith('.md'))",
					"  .sort()",
					"  .map((entry) => '- ' + entry)",
					"  .join('\\n');",
				].join("\n"),
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes"]);
			});

			const firstOutput = await readFile(
				path.join(root, ".claude", "commands", "docs-index.md"),
				"utf8",
			);
			expect(firstOutput).toContain("- alpha.md");
			expect(firstOutput).not.toContain("- beta.md");

			await writeFile(path.join(root, "docs", "beta.md"), "# beta", "utf8");
			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes"]);
			});

			const secondOutput = await readFile(
				path.join(root, ".claude", "commands", "docs-index.md"),
				"utf8",
			);
			expect(secondOutput).toContain("- alpha.md");
			expect(secondOutput).toContain("- beta.md");
		});
	});

	it("evaluates script paths relative to the repository root when run from a subdirectory", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await mkdir(path.join(root, "docs"), { recursive: true });
			await writeFile(path.join(root, "docs", "alpha.md"), "# alpha", "utf8");
			await writeScriptedCommand(
				root,
				"subdir-cwd",
				[
					'const fs = await import("node:fs/promises");',
					"const entries = await fs.readdir('docs');",
					"return entries.filter((entry) => entry.endsWith('.md')).sort().join('\\n');",
				].join("\n"),
			);
			const subdir = path.join(root, "nested");
			await mkdir(subdir, { recursive: true });

			await withCwd(subdir, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes"]);
			});

			const output = await readFile(
				path.join(root, ".claude", "commands", "subdir-cwd.md"),
				"utf8",
			);
			expect(output).toContain("alpha.md");
		});
	});

	it("renders nodejs blocks for skill and subagent templates", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeCanonicalSkillFile(
				root,
				"dynamic-skill",
				[
					"Skill before",
					"<nodejs>",
					'const fs = require("node:fs");',
					'const path = require("node:path");',
					'return fs.readFileSync(path.join(__dirname, "fragment.txt"), "utf8").trim();',
					"</nodejs>",
					"Skill after",
				].join("\n"),
			);
			await writeFile(
				path.join(root, "agents", "skills", "dynamic-skill", "fragment.txt"),
				"skill content",
				"utf8",
			);
			await writeSubagent(
				root,
				"dynamic-helper",
				[
					"Subagent before",
					"<nodejs>",
					"return ' helper content ';",
					"</nodejs>",
					"Subagent after",
				].join("\n"),
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes"]);
			});

			const skillOutput = await readFile(
				path.join(root, ".claude", "skills", "dynamic-skill", "SKILL.md"),
				"utf8",
			);
			expect(skillOutput).toContain("Skill before");
			expect(skillOutput).toContain("skill content");
			expect(skillOutput).toContain("Skill after");
			expect(skillOutput).not.toContain("<nodejs>");

			const subagentOutput = await readFile(
				path.join(root, ".claude", "agents", "dynamic-helper.md"),
				"utf8",
			);
			expect(subagentOutput).toContain("Subagent before");
			expect(subagentOutput).toContain("helper content");
			expect(subagentOutput).toContain("Subagent after");
			expect(subagentOutput).not.toContain("<nodejs>");
		});
	});

	it("evaluates each script block once per template and reuses result across targets", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeFile(path.join(root, "counter.txt"), "0", "utf8");
			await writeScriptedCommand(
				root,
				"counter",
				[
					'const fs = await import("node:fs/promises");',
					'const marker = "counter.txt";',
					"const current = Number(await fs.readFile(marker, 'utf8'));",
					"const next = current + 1;",
					"await fs.writeFile(marker, String(next), 'utf8');",
					"return String(next);",
				].join("\n"),
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude,gemini", "--yes"]);
			});

			expect(await readFile(path.join(root, "counter.txt"), "utf8")).toBe("1");
			const claudeOutput = await readFile(
				path.join(root, ".claude", "commands", "counter.md"),
				"utf8",
			);
			const geminiOutput = await readFile(
				path.join(root, ".gemini", "commands", "counter.toml"),
				"utf8",
			);
			expect(claudeOutput).toContain("1");
			expect(geminiOutput).toContain("1");
		});
	});

	it("keeps renderer output authoritative over script side effects on managed outputs", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeScriptedCommand(
				root,
				"authoritative",
				[
					'const fs = await import("node:fs/promises");',
					'await fs.mkdir(".claude/commands", { recursive: true });',
					'await fs.writeFile(".claude/commands/authoritative.md", "side effect", "utf8");',
					"return 'renderer output';",
				].join("\n"),
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes"]);
			});

			const output = await readFile(
				path.join(root, ".claude", "commands", "authoritative.md"),
				"utf8",
			);
			expect(output).toContain("Before");
			expect(output).toContain("renderer output");
			expect(output).toContain("After");
			expect(output.trim()).not.toBe("side effect");
		});
	});

	it("fails before writing managed outputs when a template script errors", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeCanonicalCommand(root, "static", "safe command");
			const failingPath = await writeScriptedCommand(root, "failing", "throw new Error('boom');");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--json", "--yes"]);
			});

			expect(await pathExists(path.join(root, ".claude", "commands", "static.md"))).toBe(false);
			expect(await pathExists(path.join(root, ".claude", "commands", "failing.md"))).toBe(false);

			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			const parsed = JSON.parse(output);
			expect(parsed.status).toBe("failed");
			expect(parsed.failedTemplatePath).toBe(failingPath);
			expect(parsed.failedBlockId).toContain("#0");
			expect(parsed.partialOutputsWritten).toBe(false);
			expect(Array.isArray(parsed.warnings)).toBe(true);
			expect(parsed.warnings.length).toBeGreaterThan(0);
			expect(
				parsed.scriptExecutions.some((entry: { status: string }) => entry.status === "failed"),
			).toBe(true);
		});
	});

	it("fails before writing managed outputs when a shell template script errors", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeCanonicalCommand(root, "static", "safe command");
			await writeCanonicalSkillFile(
				root,
				"failing-shell-skill",
				["before", "<shell>", shellFailureScript(), "</shell>", "after"].join("\n"),
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--json", "--yes"]);
			});

			expect(await pathExists(path.join(root, ".claude", "commands", "static.md"))).toBe(false);
			expect(
				await pathExists(path.join(root, ".claude", "skills", "failing-shell-skill", "SKILL.md")),
			).toBe(false);

			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			const parsed = JSON.parse(output);
			expect(parsed.status).toBe("failed");
			expect(parsed.failedBlockId).toContain("#0");
			expect(parsed.partialOutputsWritten).toBe(false);
		});
	});

	it("retains unmanaged side effects when script evaluation fails", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeScriptedCommand(
				root,
				"failing-side-effect",
				[
					'const fs = await import("node:fs/promises");',
					'await fs.writeFile("outside-managed.txt", "persisted", "utf8");',
					"throw new Error('boom');",
				].join("\n"),
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes"]);
			});

			expect(await readFile(path.join(root, "outside-managed.txt"), "utf8")).toBe("persisted");
			expect(
				await pathExists(path.join(root, ".claude", "commands", "failing-side-effect.md")),
			).toBe(false);
		});
	});

	it("emits per-script telemetry only when --verbose is enabled", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeScriptedCommand(root, "telemetry", "return 'ok';");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes"]);
			});
			const defaultOutput = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(defaultOutput).not.toContain("Evaluating template script");

			logSpy.mockClear();
			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "claude", "--yes", "--verbose"]);
			});
			const verboseOutput = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(verboseOutput).toContain("Evaluating template script");
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

	it("writes Codex command conversions to project skills even when configured globally", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalCommands(root);

			const configDir = path.join(root, "agents");
			await mkdir(configDir, { recursive: true });
			await writeFile(
				path.join(configDir, "omniagent.config.cjs"),
				[
					"module.exports = {",
					"  targets: [",
					"    {",
					'      id: "codex",',
					'      inherits: "codex",',
					"      outputs: {",
					'        skills: "{homeDir}/.codex/skills/{itemName}",',
					"        commands: {",
					'          userPath: "{homeDir}/.codex/prompts/{itemName}.md",',
					'          fallback: { mode: "convert", targetType: "skills" },',
					"        },",
					"      },",
					"    },",
					"  ],",
					"};",
					"",
				].join("\n"),
				"utf8",
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "codex", "--yes"]);
			});

			const localSkill = path.join(root, ".codex", "skills", "example", "SKILL.md");
			const globalSkill = path.join(root, "home", ".codex", "skills", "example", "SKILL.md");
			expect(await pathExists(localSkill)).toBe(true);
			expect(await pathExists(globalSkill)).toBe(false);
		});
	});

	it("writes Codex command conversions to project skills for any global skill template", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalCommands(root);

			const configDir = path.join(root, "agents");
			await mkdir(configDir, { recursive: true });
			await writeFile(
				path.join(configDir, "omniagent.config.cjs"),
				[
					"module.exports = {",
					"  targets: [",
					"    {",
					'      id: "codex",',
					'      inherits: "codex",',
					"      outputs: {",
					'        skills: "{homeDir}/.config/codex/skills/{itemName}",',
					"        commands: {",
					'          userPath: "{homeDir}/.codex/prompts/{itemName}.md",',
					'          fallback: { mode: "convert", targetType: "skills" },',
					"        },",
					"      },",
					"    },",
					"  ],",
					"};",
					"",
				].join("\n"),
				"utf8",
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "codex", "--yes"]);
			});

			const localSkill = path.join(root, ".codex", "skills", "example", "SKILL.md");
			const globalSkill = path.join(
				root,
				"home",
				".config",
				"codex",
				"skills",
				"example",
				"SKILL.md",
			);
			expect(await pathExists(localSkill)).toBe(true);
			expect(await pathExists(globalSkill)).toBe(false);
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
				"Claude Code commands prefer the project location (user path is fallback-only).",
			);
			expect(output).not.toContain(
				"GitHub Copilot CLI commands are configured to convert to skills.",
			);
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
			const copilotCommand = path.join(root, ".github", "agents", "targeted.agent.md");
			const copilotPrompt = path.join(root, ".github", "prompts", "targeted.prompt.md");
			expect(await pathExists(claudeCommand)).toBe(true);
			expect(await pathExists(geminiCommand)).toBe(true);
			expect(await pathExists(codexCommand)).toBe(false);
			expect(await pathExists(copilotCommand)).toBe(false);
			expect(await pathExists(copilotPrompt)).toBe(false);

			const claudeCommandOutput = await readFile(claudeCommand, "utf8");
			expect(claudeCommandOutput).not.toContain("targets:");
			expect(claudeCommandOutput).not.toContain("targetAgents");

			const globalClaude = path.join(root, ".claude", "commands", "global.md");
			const globalGemini = path.join(root, ".gemini", "commands", "global.toml");
			const globalCodex = path.join(root, "home", ".codex", "prompts", "global.md");
			const globalCopilot = path.join(root, ".github", "agents", "global.agent.md");
			const globalCopilotPrompt = path.join(root, ".github", "prompts", "global.prompt.md");

			expect(await pathExists(globalClaude)).toBe(true);
			expect(await pathExists(globalGemini)).toBe(true);
			expect(await pathExists(globalCodex)).toBe(true);
			expect(await pathExists(globalCopilot)).toBe(true);
			expect(await pathExists(globalCopilotPrompt)).toBe(true);
			expect(await readFile(globalCopilotPrompt, "utf8")).toContain('agent: "global"');
		});
	});
});
