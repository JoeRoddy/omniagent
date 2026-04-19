import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli/index.js";
import { resolveManagedOutputsPath } from "../../src/lib/targets/managed-outputs.js";

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

async function writeSkill(root: string, name: string, body?: string): Promise<void> {
	const dir = path.join(root, "agents", "skills", name);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "SKILL.md"), body ?? `skill-${name}`, "utf8");
}

async function writeCommand(root: string, name: string, body?: string): Promise<void> {
	const dir = path.join(root, "agents", "commands");
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, `${name}.md`), body ?? `command-${name}`, "utf8");
}

async function writeSubagent(
	root: string,
	name: string,
	body = "body",
	frontmatterLines?: string[],
): Promise<void> {
	const dir = path.join(root, "agents", "agents");
	await mkdir(dir, { recursive: true });
	const frontmatter = frontmatterLines ?? [`name: ${name}`];
	await writeFile(
		path.join(dir, `${name}.md`),
		["---", ...frontmatter, "---", body].join("\n"),
		"utf8",
	);
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

async function writeTargetConfig(root: string, contents: string): Promise<void> {
	const target = path.join(root, "agents", "omniagent.config.cjs");
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, contents, "utf8");
}

async function readManagedOutputsManifest(
	root: string,
): Promise<{ entries: Array<Record<string, unknown>> }> {
	const manifestPath = resolveManagedOutputsPath(root, path.join(root, "home"));
	const contents = await readFile(manifestPath, "utf8");
	return JSON.parse(contents) as { entries: Array<Record<string, unknown>> };
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

	it("keeps frontmatter-disabled items out by default", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "hidden-skill", "---\nenabled: false\n---\nhidden-skill");
			await writeCommand(root, "hidden-command", "---\nenabled: false\n---\nhidden-command");
			await writeSubagent(root, "hidden-agent", "body", ["name: hidden-agent", "enabled: false"]);
			await writeSkill(root, "visible-skill");
			await writeCommand(root, "visible-command");
			await writeSubagent(root, "visible-agent");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync"]);
			});

			expect(
				await pathExists(path.join(root, ".claude", "skills", "hidden-skill", "SKILL.md")),
			).toBe(false);
			expect(await pathExists(path.join(root, ".claude", "commands", "hidden-command.md"))).toBe(
				false,
			);
			expect(await pathExists(path.join(root, ".claude", "agents", "hidden-agent.md"))).toBe(false);
			expect(
				await pathExists(path.join(root, ".claude", "skills", "visible-skill", "SKILL.md")),
			).toBe(true);
			expect(await pathExists(path.join(root, ".claude", "commands", "visible-command.md"))).toBe(
				true,
			);
			expect(await pathExists(path.join(root, ".claude", "agents", "visible-agent.md"))).toBe(true);
		});
	});

	it("ignores invalid targets on frontmatter-disabled items until a profile opts them in", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(
				root,
				"hidden-skill",
				["---", "enabled: false", "targets:", "  - nope", "---", "hidden-skill"].join("\n"),
			);
			await writeCommand(
				root,
				"hidden-command",
				["---", "enabled: false", "targets:", "  - nope", "---", "hidden-command"].join("\n"),
			);
			await writeSubagent(root, "hidden-agent", "body", [
				"name: hidden-agent",
				"enabled: false",
				"targets:",
				"  - nope",
			]);
			await writeSkill(root, "visible-skill");
			await writeCommand(root, "visible-command");
			await writeSubagent(root, "visible-agent");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync"]);
			});

			expect(exitSpy).not.toHaveBeenCalled();
			expect(errorSpy).not.toHaveBeenCalled();
			expect(
				await pathExists(path.join(root, ".claude", "skills", "hidden-skill", "SKILL.md")),
			).toBe(false);
			expect(await pathExists(path.join(root, ".claude", "commands", "hidden-command.md"))).toBe(
				false,
			);
			expect(await pathExists(path.join(root, ".claude", "agents", "hidden-agent.md"))).toBe(false);
			expect(
				await pathExists(path.join(root, ".claude", "skills", "visible-skill", "SKILL.md")),
			).toBe(true);
			expect(await pathExists(path.join(root, ".claude", "commands", "visible-command.md"))).toBe(
				true,
			);
			expect(await pathExists(path.join(root, ".claude", "agents", "visible-agent.md"))).toBe(true);
		});
	});

	it("fails when a profile opts an invalid frontmatter-disabled skill back in", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(
				root,
				"hidden-skill",
				["---", "enabled: false", "targets:", "  - nope", "---", "hidden-skill"].join("\n"),
			);
			await writeProfile(root, "profiles/focus.json", {
				enable: { skills: ["hidden-skill"] },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--profile", "focus"]);
			});

			expect(exitSpy).toHaveBeenCalledWith(1);
			const errOut = errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(errOut).toContain('Skill "hidden-skill" has unsupported targets (nope)');
		});
	});

	it("skips frontmatter-disabled items during templating preflight and script evaluation", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(
				root,
				"hidden-skill",
				[
					"---",
					"enabled: false",
					"---",
					"<agents nope>bad</agents>",
					"<nodejs>",
					"throw new Error('boom');",
					"</nodejs>",
				].join("\n"),
			);
			await writeSkill(root, "visible-skill", "visible-skill");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync"]);
			});

			expect(exitSpy).not.toHaveBeenCalled();
			expect(
				await pathExists(path.join(root, ".claude", "skills", "hidden-skill", "SKILL.md")),
			).toBe(false);
			expect(
				await pathExists(path.join(root, ".claude", "skills", "visible-skill", "SKILL.md")),
			).toBe(true);
		});
	});

	it("lets profiles override frontmatter enabled=false and strips the field from outputs", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "hidden-skill", "---\nenabled: false\n---\nhidden-skill");
			await writeCommand(root, "hidden-command", "---\nenabled: false\n---\nhidden-command");
			await writeSubagent(root, "hidden-agent", "body", ["name: hidden-agent", "enabled: false"]);
			await writeProfile(root, "profiles/focus.json", {
				enable: {
					skills: ["hidden-skill"],
					commands: ["hidden-command"],
					subagents: ["hidden-agent"],
				},
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--profile", "focus"]);
			});

			const skillOutputPath = path.join(root, ".claude", "skills", "hidden-skill", "SKILL.md");
			const commandOutputPath = path.join(root, ".claude", "commands", "hidden-command.md");
			const subagentOutputPath = path.join(root, ".claude", "agents", "hidden-agent.md");
			const copilotCommandOutputPath = path.join(
				root,
				".github",
				"agents",
				"hidden-command.agent.md",
			);
			expect(await pathExists(skillOutputPath)).toBe(true);
			expect(await pathExists(commandOutputPath)).toBe(true);
			expect(await pathExists(subagentOutputPath)).toBe(true);
			expect(await pathExists(copilotCommandOutputPath)).toBe(true);

			expect(await readFile(skillOutputPath, "utf8")).not.toContain("enabled:");
			expect(await readFile(commandOutputPath, "utf8")).not.toContain("enabled:");
			expect(await readFile(subagentOutputPath, "utf8")).not.toContain("enabled:");
			expect(await readFile(copilotCommandOutputPath, "utf8")).not.toContain("enabled:");
		});
	});

	it("uses the profile-filtered skill set when checking subagent-to-skill conflicts", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "planner", "---\nenabled: false\n---\ncanonical planner");
			await writeSubagent(root, "planner", "subagent planner");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "codex", "--json"]);
			});

			const firstRun = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] ?? ""));
			const firstSubagentResult = firstRun.subagents.results.find(
				(entry: { targetName: string }) => entry.targetName === "codex",
			);
			expect(firstSubagentResult?.counts.converted).toBe(1);

			const codexSkillPath = path.join(root, ".codex", "skills", "planner", "SKILL.md");
			expect(await pathExists(codexSkillPath)).toBe(true);
			expect(await readFile(codexSkillPath, "utf8")).toContain("subagent planner");

			logSpy.mockClear();
			await writeProfile(root, "profiles/focus.json", {
				enable: { skills: ["planner"] },
			});

			await withCwd(root, async () => {
				await runCli([
					"node",
					"omniagent",
					"sync",
					"--only",
					"codex",
					"--profile",
					"focus",
					"--json",
				]);
			});

			const secondRun = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] ?? ""));
			const secondSubagentResult = secondRun.subagents.results.find(
				(entry: { targetName: string }) => entry.targetName === "codex",
			);
			expect(secondSubagentResult?.counts.converted).toBe(0);
			expect(
				secondRun.subagents.warnings.some((warning: string) =>
					warning.includes("canonical skill exists at"),
				),
			).toBe(true);

			const codexSkillOutput = await readFile(codexSkillPath, "utf8");
			expect(codexSkillOutput).toContain("canonical planner");
			expect(codexSkillOutput).not.toContain("subagent planner");
		});
	});

	it("retires stale subagent ownership when a profile activates a canonical skill", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(
				root,
				"planner",
				["---", "enabled: false", "---", "canonical planner"].join("\n"),
			);
			await writeSubagent(root, "planner", "subagent planner");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "codex"]);
			});

			let manifest = await readManagedOutputsManifest(root);
			expect(
				manifest.entries.filter(
					(entry) => entry.targetId === "codex" && entry.sourceId === "planner",
				),
			).toEqual([
				expect.objectContaining({
					sourceType: "subagent",
				}),
			]);

			logSpy.mockClear();
			errorSpy.mockClear();
			await writeProfile(root, "profiles/focus.json", {
				enable: { skills: ["planner"] },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "codex", "--profile", "focus"]);
			});

			manifest = await readManagedOutputsManifest(root);
			expect(
				manifest.entries.filter(
					(entry) => entry.targetId === "codex" && entry.sourceId === "planner",
				),
			).toEqual([
				expect.objectContaining({
					sourceType: "skill",
				}),
			]);

			await rm(path.join(root, "agents", "agents", "planner.md"));
			logSpy.mockClear();
			errorSpy.mockClear();

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "codex", "--profile", "focus"]);
			});

			const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(output).not.toContain("Output modified since last sync");
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

	it("restricts sync to explicitly enabled targets", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha");
			await writeProfile(root, "profiles/claude-only.json", {
				targets: { claude: { enabled: true } },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--profile", "claude-only"]);
			});

			expect(await pathExists(path.join(root, ".claude", "skills", "alpha", "SKILL.md"))).toBe(
				true,
			);
			expect(await pathExists(path.join(root, ".codex", "skills", "alpha", "SKILL.md"))).toBe(
				false,
			);
			expect(await pathExists(path.join(root, ".gemini", "skills", "alpha", "SKILL.md"))).toBe(
				false,
			);
			expect(await pathExists(path.join(root, ".github", "skills", "alpha", "SKILL.md"))).toBe(
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

	it("warns on unknown enabled targets without turning them into an empty allowlist", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha");
			await writeProfile(root, "profiles/typo.json", {
				targets: { claud: { enabled: true } },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--profile", "typo", "--only", "claude"]);
			});

			expect(await pathExists(path.join(root, ".claude", "skills", "alpha", "SKILL.md"))).toBe(
				true,
			);
			expect(process.exitCode).toBeUndefined();
			const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(output).toContain('unknown target "claud"');
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

	it("does not warn for valid commands when syncing a skill-only custom target", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha");
			await writeCommand(root, "review");
			await writeProfile(root, "profiles/focus.json", {
				enable: { skills: ["alpha"], commands: ["review"] },
			});
			await writeTargetConfig(
				root,
				[
					"module.exports = {",
					"  targets: [",
					"    {",
					'      id: "acme",',
					'      displayName: "Acme Agent",',
					"      outputs: {",
					'        skills: "{repoRoot}/.acme/skills/{itemName}"',
					"      }",
					"    }",
					"  ]",
					"};",
				].join("\n"),
			);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "acme", "--profile", "focus"]);
			});

			expect(await pathExists(path.join(root, ".acme", "skills", "alpha", "SKILL.md"))).toBe(true);
			const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(output).not.toContain('unknown command "review"');
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

	it("substitutes profile variables into skill content", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "review", "Review style: {{REVIEW_STYLE}}");
			await writeProfile(root, "profiles/vars.json", {
				variables: { REVIEW_STYLE: "terse" },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--profile", "vars"]);
			});

			const output = await readFile(
				path.join(root, ".claude", "skills", "review", "SKILL.md"),
				"utf8",
			);
			expect(output).toContain("Review style: terse");
			expect(output).not.toContain("{{REVIEW_STYLE}}");
		});
	});

	it("applies an inline default when the variable is not set", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "logger", "Source: {{LOG_SOURCE=stdout}}");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync"]);
			});

			const output = await readFile(
				path.join(root, ".claude", "skills", "logger", "SKILL.md"),
				"utf8",
			);
			expect(output).toContain("Source: stdout");
		});
	});

	it("CLI --var overrides profile variables", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "review", "Style: {{REVIEW_STYLE}}");
			await writeProfile(root, "profiles/vars.json", {
				variables: { REVIEW_STYLE: "terse" },
			});

			await withCwd(root, async () => {
				await runCli([
					"node",
					"omniagent",
					"sync",
					"--profile",
					"vars",
					"--var",
					"REVIEW_STYLE=thorough",
				]);
			});

			const output = await readFile(
				path.join(root, ".claude", "skills", "review", "SKILL.md"),
				"utf8",
			);
			expect(output).toContain("Style: thorough");
		});
	});

	it("warns when an unresolved bare variable is present", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "review", "Style: {{MISSING_VAR}}");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync"]);
			});

			const combined = [
				...logSpy.mock.calls.map(([msg]) => String(msg)),
				...errorSpy.mock.calls.map(([msg]) => String(msg)),
			].join("\n");
			expect(combined).toContain("MISSING_VAR");
		});
	});

	it("errors on malformed --var values", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--var", "lowercase=nope"]);
			});

			expect(exitSpy).toHaveBeenCalled();
			const errOut = errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(errOut).toContain("lowercase=nope");
		});
	});

	it("skips templating validation for profile-excluded items", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "good", "Good skill");
			await writeSkill(root, "bad", "<agents claude>\n");
			await writeProfile(root, "profiles/focus.json", {
				enable: { skills: ["good"] },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--profile", "focus", "--only", "claude"]);
			});

			expect(await pathExists(path.join(root, ".claude", "skills", "good", "SKILL.md"))).toBe(true);
			expect(await pathExists(path.join(root, ".claude", "skills", "bad", "SKILL.md"))).toBe(false);
			expect(process.exitCode).toBeUndefined();
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
