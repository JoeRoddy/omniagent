import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli/index.js";

async function withTempRepo(fn: (root: string, homeDir: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-sync-agents-dir-"));
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

async function createRepoRoot(root: string): Promise<void> {
	await writeFile(path.join(root, "package.json"), "{}", "utf8");
}

async function writeLocalSkill(root: string, baseDir: string, name: string): Promise<void> {
	const dir = path.join(root, baseDir, ".local", "skills", name);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "SKILL.md"), `Skill ${name}`, "utf8");
}

async function writeLocalCommand(root: string, baseDir: string, name: string): Promise<void> {
	const dir = path.join(root, baseDir, ".local", "commands");
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, `${name}.md`), `Command ${name}`, "utf8");
}

async function writeLocalSubagent(root: string, baseDir: string, fileName: string, name: string) {
	const dir = path.join(root, baseDir, ".local", "agents");
	await mkdir(dir, { recursive: true });
	const contents = `---\nname: ${name}\n---\nBody\n`;
	await writeFile(path.join(dir, `${fileName}.md`), contents, "utf8");
}

async function writeLocalInstruction(
	root: string,
	baseDir: string,
	fileName: string,
): Promise<void> {
	const filePath = path.join(root, baseDir, fileName);
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, "Instruction", "utf8");
}

type LocalListEntry = { name: string; sourcePath: string; markerType: string };

type LocalListOutput = {
	skills: LocalListEntry[];
	commands: LocalListEntry[];
	agents: LocalListEntry[];
	instructions: LocalListEntry[];
};

function parseListLocalOutput(logSpy: ReturnType<typeof vi.spyOn>): LocalListOutput {
	const entry = logSpy.mock.calls
		.map((call) => call[0])
		.find((value) => typeof value === "string" && value.trim().startsWith("{"));
	if (!entry || typeof entry !== "string") {
		throw new Error("JSON output not found in console.log calls.");
	}
	return JSON.parse(entry) as LocalListOutput;
}

const skipPermissions =
	process.platform === "win32" || (typeof process.getuid === "function" && process.getuid() === 0);
const permissionTest = skipPermissions ? it.skip : it;

describe.sequential("sync command agentsDir override", () => {
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

	it("shows agentsDir in help output", async () => {
		await runCli(["node", "omniagent", "sync", "--help"]);

		const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(output).toContain("--agentsDir");
		expect(output).toContain("agents");
	});

	it("uses the default agents directory when no override is provided", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeLocalSkill(root, "agents", "default-skill");
			await writeLocalCommand(root, "agents", "default-command");
			await writeLocalSubagent(root, "agents", "default", "Default Subagent");
			await writeLocalInstruction(root, "agents", "AGENTS.local.md");

			await writeLocalSkill(root, "custom-agents", "custom-skill");
			await writeLocalCommand(root, "custom-agents", "custom-command");
			await writeLocalSubagent(root, "custom-agents", "custom", "Custom Subagent");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--list-local", "--json"]);
			});

			const output = parseListLocalOutput(logSpy);
			expect(output.skills.map((entry) => entry.name)).toEqual(["default-skill"]);
			expect(output.commands.map((entry) => entry.name)).toEqual(["default-command"]);
			expect(output.agents.map((entry) => entry.name)).toEqual(["Default Subagent"]);
			expect(output.instructions.map((entry) => entry.name)).toEqual([
				path.join("agents", "AGENTS.local.md"),
			]);
		});
	});

	it("uses a relative override for all local categories", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeLocalSkill(root, "agents", "default-skill");
			await writeLocalCommand(root, "agents", "default-command");
			await writeLocalSubagent(root, "agents", "default", "Default Subagent");

			await writeLocalSkill(root, "custom-agents", "custom-skill");
			await writeLocalCommand(root, "custom-agents", "custom-command");
			await writeLocalSubagent(root, "custom-agents", "custom", "Custom Subagent");
			await writeLocalInstruction(root, "custom-agents", "AGENTS.local.md");

			await withCwd(root, async () => {
				await runCli([
					"node",
					"omniagent",
					"sync",
					"--agentsDir",
					"./custom-agents",
					"--list-local",
					"--json",
				]);
			});

			const output = parseListLocalOutput(logSpy);
			expect(output.skills.map((entry) => entry.name)).toEqual(["custom-skill"]);
			expect(output.commands.map((entry) => entry.name)).toEqual(["custom-command"]);
			expect(output.agents.map((entry) => entry.name)).toEqual(["Custom Subagent"]);
			expect(output.instructions.map((entry) => entry.name)).toEqual([
				path.join("custom-agents", "AGENTS.local.md"),
			]);
		});
	});

	it("uses an absolute override path", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeLocalSkill(root, "custom-agents", "custom-skill");

			await withCwd(root, async () => {
				await runCli([
					"node",
					"omniagent",
					"sync",
					"--agentsDir",
					path.join(root, "custom-agents"),
					"--list-local",
					"--json",
				]);
			});

			const output = parseListLocalOutput(logSpy);
			expect(output.skills.map((entry) => entry.name)).toEqual(["custom-skill"]);
		});
	});

	it("errors when the override path is missing", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--agentsDir", "missing-agents"]);
			});

			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Agents directory not found"));
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	it("errors when the override path is a file", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			const filePath = path.join(root, "custom-agents");
			await writeFile(filePath, "not a directory", "utf8");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--agentsDir", "custom-agents"]);
			});

			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Agents directory is not a directory"),
			);
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	permissionTest("errors when the override directory is not accessible", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			const agentsDir = path.join(root, "restricted-agents");
			await mkdir(agentsDir, { recursive: true });
			await chmod(agentsDir, 0o500);

			try {
				await withCwd(root, async () => {
					await runCli(["node", "omniagent", "sync", "--agentsDir", "restricted-agents"]);
				});
			} finally {
				await chmod(agentsDir, 0o700);
			}

			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Agents directory is not readable, writable, or searchable"),
			);
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	it("accepts the default path when explicitly provided", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeLocalSkill(root, "agents", "default-skill");

			await withCwd(root, async () => {
				await runCli([
					"node",
					"omniagent",
					"sync",
					"--agentsDir",
					"agents",
					"--list-local",
					"--json",
				]);
			});

			const output = parseListLocalOutput(logSpy);
			expect(output.skills.map((entry) => entry.name)).toEqual(["default-skill"]);
		});
	});

	it("matches default behavior when agentsDir is explicitly set to the default", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeLocalSkill(root, "agents", "default-skill");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--list-local", "--json"]);
			});
			const baseline = parseListLocalOutput(logSpy);

			logSpy.mockClear();

			await withCwd(root, async () => {
				await runCli([
					"node",
					"omniagent",
					"sync",
					"--agentsDir",
					"agents",
					"--list-local",
					"--json",
				]);
			});
			const explicit = parseListLocalOutput(logSpy);

			expect(explicit).toEqual(baseline);
		});
	});
});
