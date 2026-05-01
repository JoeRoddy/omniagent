import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

	it("initializes a new profile with starter JSON and a commented guide", async () => {
		const originalNoColor = process.env.NO_COLOR;
		process.env.NO_COLOR = "1";
		try {
			await withTempRepo(async (root) => {
				await createRepoRoot(root);

				await withCwd(root, async () => {
					await runCli(["node", "omniagent", "profiles", "init", "code-reviewer"]);
				});

				const profilePath = path.join(root, "agents", "profiles", "code-reviewer.json");
				const created = JSON.parse(await readFile(profilePath, "utf8"));
				expect(created).toEqual({
					$schema:
						"https://raw.githubusercontent.com/JoeRoddy/omniagent/master/schemas/profile.v1.json",
					description: "",
					targets: {},
					enable: {
						skills: [],
						subagents: [],
						commands: [],
					},
					disable: {
						skills: [],
						subagents: [],
						commands: [],
					},
					variables: {},
				});
				const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
				expect(output).toContain(
					'Created profile "code-reviewer" at agents/profiles/code-reviewer.json.',
				);
				expect(output).toContain("Profile files must be valid JSON.");
				expect(output).toContain('"claude": { "enabled": true }, // includes Claude');
				expect(output).toContain(
					"// https://github.com/JoeRoddy/omniagent/blob/master/docs/templating.md",
				);
				expect(output).toContain("omniagent sync --profile code-reviewer");
				expect(output).not.toContain("\u001B[90m");
			});
		} finally {
			if (originalNoColor === undefined) {
				delete process.env.NO_COLOR;
			} else {
				process.env.NO_COLOR = originalNoColor;
			}
		}
	});

	it("initializes .local suffix profiles as local sibling profiles", async () => {
		const originalNoColor = process.env.NO_COLOR;
		process.env.NO_COLOR = "1";
		try {
			await withTempRepo(async (root) => {
				await createRepoRoot(root);

				await withCwd(root, async () => {
					await runCli(["node", "omniagent", "profiles", "init", "joe.local"]);
				});

				const profilePath = path.join(root, "agents", "profiles", "joe.local.json");
				const created = JSON.parse(await readFile(profilePath, "utf8"));
				expect(created.description).toBe("");
				expect(created.targets).toEqual({});
				const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
				expect(output).toContain('Created local profile "joe" at agents/profiles/joe.local.json.');
				expect(output).toContain(
					'Use profile name "joe" when syncing; ".local" is only the file suffix.',
				);
				expect(output).toContain("omniagent profiles show joe");
				expect(output).toContain("omniagent sync --profile joe");
				expect(output).not.toContain("omniagent sync --profile joe.local");
			});
		} finally {
			if (originalNoColor === undefined) {
				delete process.env.NO_COLOR;
			} else {
				process.env.NO_COLOR = originalNoColor;
			}
		}
	});

	it("prints init guide comments in gray when color is forced", async () => {
		const originalForceColor = process.env.FORCE_COLOR;
		const originalNoColor = process.env.NO_COLOR;
		process.env.FORCE_COLOR = "1";
		delete process.env.NO_COLOR;
		try {
			await withTempRepo(async (root) => {
				await createRepoRoot(root);

				await withCwd(root, async () => {
					await runCli(["node", "omniagent", "profiles", "init", "colored"]);
				});

				const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
				expect(output).toContain("\u001B[90m// includes Claude");
				expect(output).toContain(
					"\u001B[90m// https://github.com/JoeRoddy/omniagent/blob/master/docs/templating.md",
				);
				expect(output).not.toContain("https:\u001B[90m//raw.githubusercontent.com");
			});
		} finally {
			if (originalForceColor === undefined) {
				delete process.env.FORCE_COLOR;
			} else {
				process.env.FORCE_COLOR = originalForceColor;
			}
			if (originalNoColor === undefined) {
				delete process.env.NO_COLOR;
			} else {
				process.env.NO_COLOR = originalNoColor;
			}
		}
	});

	it("does not overwrite an existing profile on init", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeProfile(root, "profiles/existing.json", { description: "Keep me" });

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles", "init", "existing"]);
			});

			expect(exitSpy).toHaveBeenCalledWith(1);
			const errOut = errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(errOut).toContain('Profile "existing" already exists');
			const profilePath = path.join(root, "agents", "profiles", "existing.json");
			const existing = JSON.parse(await readFile(profilePath, "utf8"));
			expect(existing).toEqual({ description: "Keep me" });
		});
	});

	it("does not create a local sibling when a dedicated local profile already exists", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeProfile(root, ".local/profiles/joe.json", { description: "Dedicated" });

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles", "init", "joe.local"]);
			});

			expect(exitSpy).toHaveBeenCalledWith(1);
			const errOut = errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(errOut).toContain('Local profile "joe" already exists');
			const siblingPath = path.join(root, "agents", "profiles", "joe.local.json");
			await expect(readFile(siblingPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
		});
	});

	it("rejects profile names that would escape the profiles directory", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles", "init", "../oops"]);
			});

			expect(exitSpy).toHaveBeenCalledWith(1);
			const errOut = errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(errOut).toContain("Profile names may only contain");
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
