import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli/index.js";

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-profiles-cli-"));
	const homeDir = path.join(root, "home");
	await mkdir(homeDir, { recursive: true });
	const homeSpy = vi.spyOn(os, "homedir").mockReturnValue(homeDir);
	try {
		await writeFile(path.join(root, "package.json"), "{}");
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

async function createRepoRoot(root: string): Promise<void> {
	await writeFile(path.join(root, "package.json"), "{}");
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

async function writeSkill(root: string, name: string, body = "Skill body"): Promise<void> {
	const target = path.join(root, "agents", "skills", name, "SKILL.md");
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, body, "utf8");
}

async function writeCommand(root: string, name: string, body = "Command body"): Promise<void> {
	const target = path.join(root, "agents", "commands", `${name}.md`);
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, body, "utf8");
}

async function writeSubagent(root: string, name: string, body = "Subagent body"): Promise<void> {
	const target = path.join(root, "agents", "agents", `${name}.md`);
	const contents = `---\nname: ${name}\n---\n${body}\n`;
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, contents, "utf8");
}

describe.sequential("profiles subcommand", () => {
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

	it("lists profiles with descriptions and annotations", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeProfile(root, "profiles/default.json", { description: "Team default" });
			await writeProfile(root, "profiles/default.local.json", {});
			await writeProfile(root, "profiles/code-reviewer.json", { description: "Reviews" });
			await writeProfile(root, ".local/profiles/experiments.json", { description: "Personal" });

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles"]);
			});

			const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(output).toContain("default");
			expect(output).toContain("(active by default)");
			expect(output).toContain("[local override]");
			expect(output).toContain("code-reviewer");
			expect(output).toContain("Reviews");
			expect(output).toContain("experiments");
			expect(output).toContain("[local-only]");
		});
	});

	it("prefers the effective local description in profile listings", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeProfile(root, "profiles/reviewer.json", {
				description: "Shared description",
			});
			await writeProfile(root, ".local/profiles/reviewer.json", {
				description: "Local description",
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles"]);
			});

			const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(output).toContain("Local description");
			expect(output).not.toContain("Shared description [local override]");
		});
	});

	it("retains the shared description when a local override omits that key", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeProfile(root, "profiles/default.json", {
				description: "Team default",
			});
			await writeProfile(root, "profiles/default.local.json", {});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles"]);
			});

			const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(output).toContain("Team default");
		});
	});

	it("shows fully-resolved merged profile as JSON, including variables", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeProfile(root, "profiles/base.json", {
				disable: { skills: ["ppt"] },
				variables: { LOG_SOURCE: "stdout" },
			});
			await writeProfile(root, "profiles/code-reviewer.json", {
				extends: "base",
				description: "Review",
				enable: { skills: ["review"] },
				variables: { REVIEW_STYLE: "terse" },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles", "show", "code-reviewer"]);
			});

			const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			const parsed = JSON.parse(output);
			expect(parsed.description).toBe("Review");
			expect(parsed.enable.skills).toEqual(["review"]);
			expect(parsed.disable.skills).toEqual(["ppt"]);
			expect(parsed.variables).toEqual({
				LOG_SOURCE: "stdout",
				REVIEW_STYLE: "terse",
			});
		});
	});

	it("shows variables merged across multiple profiles in CLI order", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeProfile(root, "profiles/reviewer.json", {
				variables: {
					LOG_SOURCE: "stdout",
					REVIEW_STYLE: "terse",
				},
			});
			await writeProfile(root, "profiles/override.json", {
				variables: {
					REVIEW_STYLE: "thorough",
				},
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles", "show", "reviewer,override"]);
			});

			const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			const parsed = JSON.parse(output);
			expect(parsed.variables).toEqual({
				LOG_SOURCE: "stdout",
				REVIEW_STYLE: "thorough",
			});
		});
	});

	it("validate exits zero when profile references are valid", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "review");
			await writeCommand(root, "diff-summary");
			await writeSubagent(root, "reviewer");
			await writeProfile(root, "profiles/ok.json", {
				description: "good",
				targets: { codex: { enabled: false } },
				enable: {
					commands: ["diff-summary"],
					subagents: ["reviewer"],
				},
				disable: {
					skills: ["review"],
				},
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles", "validate"]);
			});

			expect(exitSpy).not.toHaveBeenCalled();
			const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(output).toContain("Validated 1 profile(s).");
		});
	});

	it("validate exits non-zero on schema violations", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			const filePath = path.join(root, "agents", "profiles", "bad.json");
			await mkdir(path.dirname(filePath), { recursive: true });
			await writeFile(filePath, JSON.stringify({ extends: 42 }), "utf8");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles", "validate"]);
			});

			expect(exitSpy).toHaveBeenCalledWith(1);
			const errOut = errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(errOut).toContain("bad");
			expect(errOut).toContain("extends: must be a non-empty string when provided.");
		});
	});

	it("validate continues after malformed profiles and reports later issues", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "review");
			const badJsonPath = path.join(root, "agents", "profiles", "a-bad-json.json");
			await mkdir(path.dirname(badJsonPath), { recursive: true });
			await writeFile(badJsonPath, "{ invalid json", "utf8");
			await writeProfile(root, "profiles/z-unknown-ref.json", {
				disable: { skills: ["missing-skill"] },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles", "validate"]);
			});

			expect(exitSpy).toHaveBeenCalledWith(1);
			const errOut = errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(errOut).toContain("a-bad-json");
			expect(errOut).toContain("Invalid JSON in profile");
			expect(errOut).toContain("z-unknown-ref");
			expect(errOut).toContain("missing-skill");
		});
	});

	it("validate exits non-zero on unknown skill references", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "review");
			await writeProfile(root, "profiles/typo.json", {
				disable: { skills: ["missing-skill"] },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles", "validate"]);
			});

			expect(exitSpy).toHaveBeenCalledWith(1);
			const errOut = errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(errOut).toContain("missing-skill");
		});
	});

	it("validate exits non-zero on unknown command references", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeCommand(root, "review");
			await writeProfile(root, "profiles/typo.json", {
				enable: { commands: ["missing-command"] },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles", "validate"]);
			});

			expect(exitSpy).toHaveBeenCalledWith(1);
			const errOut = errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(errOut).toContain("missing-command");
		});
	});

	it("validate exits non-zero on unknown subagent references", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSubagent(root, "reviewer");
			await writeProfile(root, "profiles/typo.json", {
				enable: { subagents: ["missing-subagent"] },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles", "validate"]);
			});

			expect(exitSpy).toHaveBeenCalledWith(1);
			const errOut = errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(errOut).toContain("missing-subagent");
		});
	});

	it("validate exits non-zero on unknown target references", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeProfile(root, "profiles/typo.json", {
				targets: { ghost: { enabled: false } },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles", "validate"]);
			});

			expect(exitSpy).toHaveBeenCalledWith(1);
			const errOut = errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(errOut).toContain('unknown target "ghost"');
		});
	});

	it("validate ignores frontmatter-disabled items with invalid targets until a profile enables them", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(
				root,
				"draft-skill",
				["---", "enabled: false", "targets:", "  - nope", "---", "Skill body"].join("\n"),
			);
			await writeCommand(
				root,
				"draft-command",
				["---", "enabled: false", "targets:", "  - nope", "---", "Command body"].join("\n"),
			);
			const subagentPath = path.join(root, "agents", "agents", "draft-agent.md");
			await mkdir(path.dirname(subagentPath), { recursive: true });
			await writeFile(
				subagentPath,
				[
					"---",
					"name: draft-agent",
					"enabled: false",
					"targets:",
					"  - nope",
					"---",
					"Subagent body",
				].join("\n"),
				"utf8",
			);
			await writeProfile(root, "profiles/default.json", {});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles", "validate"]);
			});

			expect(exitSpy).not.toHaveBeenCalled();
			const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(output).toContain("Validated 1 profile(s).");
		});
	});

	it("validate exits non-zero when a profile includes disabled draft skills, commands, or subagents", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(
				root,
				"draft-skill",
				["---", "enabled: false", "targets:", "  - nope", "---", "Skill body"].join("\n"),
			);
			await writeCommand(root, "draft", ["---", "enabled: false", "---", ""].join("\n"));
			const subagentPath = path.join(root, "agents", "agents", "draft.md");
			await mkdir(path.dirname(subagentPath), { recursive: true });
			await writeFile(
				subagentPath,
				["---", "name: draft", "enabled: false", "---", ""].join("\n"),
				"utf8",
			);
			await writeProfile(root, "profiles/drafts.json", {
				enable: { skills: ["draft-skill"], commands: ["draft"], subagents: ["draft"] },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles", "validate"]);
			});

			expect(exitSpy).toHaveBeenCalledWith(1);
			const errOut = errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(errOut).toContain('includes unusable skill "draft-skill"');
			expect(errOut).toContain("unsupported targets");
			expect(errOut).toContain('includes unusable command "draft"');
			expect(errOut).toContain("empty prompt");
			expect(errOut).toContain('includes unusable subagent "draft"');
			expect(errOut).toContain("empty body");
		});
	});

	it("validate stays silent for zero-match glob references", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "review");
			await writeProfile(root, "profiles/ok.json", {
				disable: { skills: ["*-legacy"] },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles", "validate"]);
			});

			expect(exitSpy).not.toHaveBeenCalled();
			const errOut = errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(errOut).not.toContain("legacy");
		});
	});
});
