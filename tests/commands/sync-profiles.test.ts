import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli/index.js";

const DEFAULT_CLI_COMMANDS = ["codex", "claude", "gemini", "copilot"];

async function createFakeCliBin(root: string): Promise<string> {
	const binDir = path.join(root, "bin");
	await mkdir(binDir, { recursive: true });
	const isWindows = process.platform === "win32";
	for (const command of DEFAULT_CLI_COMMANDS) {
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
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-sync-profiles-"));
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

async function writeSkill(root: string, name: string): Promise<void> {
	const dir = path.join(root, "agents", "skills", name);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "SKILL.md"), `skill-${name}`, "utf8");
}

async function writeCommand(root: string, name: string): Promise<void> {
	const dir = path.join(root, "agents", "commands");
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, `${name}.md`), `command-${name}`, "utf8");
}

async function writeSubagent(root: string, name: string): Promise<void> {
	const dir = path.join(root, "agents", "agents");
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, `${name}.md`), `---\nname: ${name}\n---\nbody`, "utf8");
}

async function writeProfile(
	root: string,
	relative: string,
	data: Record<string, unknown>,
): Promise<void> {
	const target = path.join(root, "agents", relative);
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, JSON.stringify(data), "utf8");
}

describe.sequential("sync command with profiles", () => {
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

	it("ignores profiles when no default.json exists and no --profile is passed", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync"]);
			});

			expect(await pathExists(path.join(root, ".claude", "skills", "alpha", "SKILL.md"))).toBe(
				true,
			);
		});
	});

	it("applies agents/profiles/default.json when present and --profile is not passed", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha");
			await writeSkill(root, "beta");
			await writeProfile(root, "profiles/default.json", {
				disable: { skills: ["beta"] },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync"]);
			});

			expect(await pathExists(path.join(root, ".claude", "skills", "alpha", "SKILL.md"))).toBe(
				true,
			);
			expect(await pathExists(path.join(root, ".claude", "skills", "beta", "SKILL.md"))).toBe(
				false,
			);
		});
	});

	it("does not prepend default.json when --profile is explicit", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha");
			await writeSkill(root, "beta");
			await writeProfile(root, "profiles/default.json", {
				disable: { skills: ["beta"] },
			});
			await writeProfile(root, "profiles/other.json", {});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--profile", "other"]);
			});

			expect(await pathExists(path.join(root, ".claude", "skills", "alpha", "SKILL.md"))).toBe(
				true,
			);
			expect(await pathExists(path.join(root, ".claude", "skills", "beta", "SKILL.md"))).toBe(true);
		});
	});

	it("filters skills and commands using enable globs", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "review");
			await writeSkill(root, "other");
			await writeCommand(root, "diff-summary");
			await writeCommand(root, "note");
			await writeProfile(root, "profiles/focus.json", {
				enable: { skills: ["review"], commands: ["diff-*"] },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--profile", "focus"]);
			});

			expect(await pathExists(path.join(root, ".claude", "skills", "review", "SKILL.md"))).toBe(
				true,
			);
			expect(await pathExists(path.join(root, ".claude", "skills", "other", "SKILL.md"))).toBe(
				false,
			);
			expect(await pathExists(path.join(root, ".claude", "commands", "diff-summary.md"))).toBe(
				true,
			);
			expect(await pathExists(path.join(root, ".claude", "commands", "note.md"))).toBe(false);
		});
	});

	it("disables a target via targets.<name>.enabled=false", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha");
			await writeProfile(root, "profiles/nocodex.json", {
				targets: { codex: { enabled: false } },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--profile", "nocodex"]);
			});

			expect(await pathExists(path.join(root, ".claude", "skills", "alpha", "SKILL.md"))).toBe(
				true,
			);
			expect(await pathExists(path.join(root, ".codex", "skills", "alpha", "SKILL.md"))).toBe(
				false,
			);
		});
	});

	it("merges multiple --profile arguments in CLI order (later wins)", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha");
			await writeProfile(root, "profiles/noclaude.json", {
				targets: { claude: { enabled: false } },
			});
			await writeProfile(root, "profiles/yesclaude.json", {
				targets: { claude: { enabled: true } },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--profile", "noclaude,yesclaude"]);
			});

			expect(await pathExists(path.join(root, ".claude", "skills", "alpha", "SKILL.md"))).toBe(
				true,
			);
		});
	});

	it("layers CLI --skip after profile-driven target selection", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha");
			await writeProfile(root, "profiles/allon.json", {
				targets: { claude: { enabled: true }, codex: { enabled: true } },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--profile", "allon", "--skip", "claude"]);
			});

			expect(await pathExists(path.join(root, ".claude", "skills", "alpha", "SKILL.md"))).toBe(
				false,
			);
			expect(await pathExists(path.join(root, ".codex", "skills", "alpha", "SKILL.md"))).toBe(true);
		});
	});

	it("warns about unknown bare references", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha");
			await writeProfile(root, "profiles/typo.json", {
				enable: { skills: ["alpha"] },
				disable: { skills: ["missing-skill"] },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--profile", "typo"]);
			});

			const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(output).toContain("missing-skill");
		});
	});

	it("errors loudly when --profile names a missing profile", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--profile", "ghost"]);
			});

			expect(exitSpy).toHaveBeenCalled();
			const errOut = errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(errOut).toMatch(/ghost/);
		});
	});

	it("emits 'Active profile' in non-JSON output", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha");
			await writeProfile(root, "profiles/focus.json", {});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--profile", "focus"]);
			});

			const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(output).toContain("Active profile: focus");
		});
	});

	it("filters subagents via enable", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSubagent(root, "reviewer");
			await writeSubagent(root, "debugger");
			await writeProfile(root, "profiles/reviewonly.json", {
				enable: { subagents: ["reviewer"] },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--profile", "reviewonly"]);
			});

			expect(await pathExists(path.join(root, ".claude", "agents", "reviewer.md"))).toBe(true);
			expect(await pathExists(path.join(root, ".claude", "agents", "debugger.md"))).toBe(false);
		});
	});

	it("extends chain applies base disable and child enable together", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "kept");
			await writeSkill(root, "dropped");
			await writeProfile(root, "profiles/base.json", {
				disable: { skills: ["dropped"] },
			});
			await writeProfile(root, "profiles/child.json", {
				extends: "base",
				enable: { skills: ["kept", "dropped"] },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--profile", "child"]);
			});

			expect(await pathExists(path.join(root, ".claude", "skills", "kept", "SKILL.md"))).toBe(true);
			expect(await pathExists(path.join(root, ".claude", "skills", "dropped", "SKILL.md"))).toBe(
				false,
			);
		});
	});
});
