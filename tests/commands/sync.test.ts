import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli/index.js";

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "agentctl-sync-"));
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

async function createCanonicalCommands(root: string): Promise<string> {
	const sourceDir = path.join(root, "agents", "commands");
	await mkdir(sourceDir, { recursive: true });
	await writeFile(path.join(sourceDir, "example.md"), "Say hello.");
	return await realpath(sourceDir);
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
				await runCli(["node", "agentctl", "sync"]);
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
				await runCli(["node", "agentctl", "sync", "--only", "claude"]);
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
				await runCli(["node", "agentctl", "sync", "--skip", "unknown"]);
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
				await runCli(["node", "agentctl", "sync", "--skip", "codex", "--only", "claude"]);
			});

			expect(errorSpy).toHaveBeenCalledWith("Error: Use either --skip or --only, not both.");
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	it("reports missing source paths using the repo root", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await mkdir(path.join(root, "subdir"), { recursive: true });
			const skillsPath = path.join(root, "agents", "skills");
			const commandsPath = path.join(root, "agents", "commands");

			await withCwd(path.join(root, "subdir"), async () => {
				await runCli(["node", "agentctl", "sync"]);
			});

			expect(errorSpy).toHaveBeenCalledWith(
				`Error: Canonical config source not found at ${skillsPath}. ` +
					`Command catalog directory not found at ${commandsPath}.`,
			);
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	it("emits JSON summaries when --json is provided", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			const skillsPath = await createCanonicalSkills(root);
			const commandsPath = await createCanonicalCommands(root);

			await withCwd(root, async () => {
				await runCli(["node", "agentctl", "sync", "--json"]);
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
				await runCli(["node", "agentctl", "sync", "--yes"]);
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
				await runCli(["node", "agentctl", "sync", "--only", "codex", "--yes"]);
			});

			const warning = logSpy.mock.calls.find(
				([message]) =>
					typeof message === "string" && message.includes("Codex only supports global prompts"),
			);
			expect(warning).toBeTruthy();
		});
	});
});
