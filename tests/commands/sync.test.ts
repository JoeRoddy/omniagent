import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli/index.js";

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "agentctrl-sync-"));
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
	await mkdir(sourceDir, { recursive: true });
	await writeFile(path.join(sourceDir, "example.txt"), "hello");
	return await realpath(sourceDir);
}

async function writeCanonicalSkillFile(
	root: string,
	fileName: string,
	contents: string,
): Promise<string> {
	const sourceDir = path.join(root, "agents", "skills");
	await mkdir(sourceDir, { recursive: true });
	const filePath = path.join(sourceDir, fileName);
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

describe.sequential("sync command", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let exitSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
	});

	afterEach(() => {
		logSpy.mockRestore();
		errorSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it("syncs all targets from the repo root", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);
			await createCanonicalCommands(root);

			await withCwd(root, async () => {
				await runCli(["node", "agentctrl", "sync"]);
			});

			const codex = await readFile(path.join(root, ".codex", "skills", "example.txt"), "utf8");
			const claude = await readFile(path.join(root, ".claude", "skills", "example.txt"), "utf8");
			const copilot = await readFile(path.join(root, ".github", "skills", "example.txt"), "utf8");
			const gemini = await readFile(path.join(root, ".gemini", "skills", "example.txt"), "utf8");
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

			await withCwd(root, async () => {
				await runCli(["node", "agentctrl", "sync", "--only", "claude"]);
			});

			expect(await pathExists(path.join(root, ".claude", "skills", "example.txt"))).toBe(true);
			expect(await pathExists(path.join(root, ".claude", "commands", "example.md"))).toBe(true);
			expect(await pathExists(path.join(root, ".codex", "skills"))).toBe(false);
			expect(await pathExists(path.join(root, ".github", "skills"))).toBe(false);
			expect(await pathExists(path.join(root, ".gemini", "skills"))).toBe(false);
			expect(await pathExists(path.join(root, ".gemini", "commands"))).toBe(false);
		});
	});

	it("errors on unknown targets without syncing", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);
			await createCanonicalCommands(root);

			await withCwd(root, async () => {
				await runCli(["node", "agentctrl", "sync", "--skip", "unknown"]);
			});

			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Error: Unknown target name(s): unknown."),
			);
			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(await pathExists(path.join(root, ".codex", "skills"))).toBe(false);
		});
	});

	it("errors when --skip and --only are both provided", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);
			await createCanonicalCommands(root);

			await withCwd(root, async () => {
				await runCli(["node", "agentctrl", "sync", "--skip", "codex", "--only", "claude"]);
			});

			expect(errorSpy).toHaveBeenCalledWith("Error: Use either --skip or --only, not both.");
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	it("reports missing source paths as skipped without exiting", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await mkdir(path.join(root, "subdir"), { recursive: true });
			const skillsPath = path.join(root, "agents", "skills");
			const commandsPath = path.join(root, "agents", "commands");

			await withCwd(path.join(root, "subdir"), async () => {
				await runCli(["node", "agentctrl", "sync"]);
			});

			const loggedMessages = logSpy.mock.calls
				.map(([message]) => (typeof message === "string" ? message : ""))
				.join("\n");

			expect(loggedMessages).toContain(`Canonical config source not found at ${skillsPath}.`);
			expect(loggedMessages).toContain(`Command catalog directory not found at ${commandsPath}.`);
			expect(errorSpy).not.toHaveBeenCalled();
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("allows subagent-only sync when the catalog is missing", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);

			await withCwd(root, async () => {
				await runCli(["node", "agentctrl", "sync", "--only", "codex", "--yes"]);
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

			await withCwd(root, async () => {
				await runCli(["node", "agentctrl", "sync", "--json"]);
			});

			expect(logSpy).toHaveBeenCalled();
			const output = logSpy.mock.calls[0]?.[0];
			const parsed = JSON.parse(output);
			expect(await realpath(parsed.skills.sourcePath)).toBe(skillsPath);
			expect(await realpath(parsed.commands.sourcePath)).toBe(commandsPath);
			expect(parsed.skills.results).toHaveLength(4);
			expect(parsed.commands.results).toHaveLength(4);
			expect(parsed.hadFailures).toBe(false);
		});
	});

	it("prints a plan summary in non-interactive runs", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalSkills(root);
			await createCanonicalCommands(root);

			await withCwd(root, async () => {
				await runCli(["node", "agentctrl", "sync", "--yes"]);
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
				await runCli(["node", "agentctrl", "sync", "--only", "codex", "--yes"]);
			});

			const warning = logSpy.mock.calls.find(
				([message]) =>
					typeof message === "string" && message.includes("Codex only supports global prompts"),
			);
			expect(warning).toBeTruthy();
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
				await runCli(["node", "agentctrl", "sync", "--only", "claude", "--yes"]);
			});

			const skillOutput = await readFile(
				path.join(root, ".claude", "skills", "example.txt"),
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
				await runCli(["node", "agentctrl", "sync", "--only", "claude", "--yes"]);
			});

			expect(errorSpy).toHaveBeenCalled();
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Valid agents: codex, claude, copilot, gemini."),
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
				await runCli(["node", "agentctrl", "sync", "--only", "claude", "--yes"]);
			});

			expect(errorSpy).toHaveBeenCalled();
			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(await pathExists(path.join(root, ".claude", "commands"))).toBe(false);
			expect(await pathExists(path.join(root, ".claude", "skills"))).toBe(false);
		});
	});
});
