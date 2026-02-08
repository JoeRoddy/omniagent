import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli/index.js";

function hashIdentifier(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

async function withTempRoot(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-reset-state-"));
	try {
		await fn(root);
	} finally {
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

async function createStateFixtures(homeDir: string, repoRoot: string): Promise<void> {
	const repoHash = hashIdentifier(repoRoot);
	const projectStateDir = path.join(homeDir, ".omniagent", "state");

	const paths = [
		path.join(projectStateDir, "managed-outputs", "projects", repoHash, "managed-outputs.json"),
		path.join(projectStateDir, "instructions", "projects", repoHash, "instruction-outputs.json"),
		path.join(projectStateDir, "subagents", "projects", repoHash, "claude.toml"),
		path.join(projectStateDir, "slash-commands", "projects", repoHash, "claude-project.toml"),
		path.join(projectStateDir, "ignore-rules", "projects", `${repoHash}.json`),
		path.join(homeDir, ".omniagent", "slash-commands", "projects", repoHash, "claude-project.toml"),
		path.join(
			homeDir,
			".omniagent",
			"slash-commands",
			"skills",
			"projects",
			repoHash,
			"codex-project.toml",
		),
	];

	for (const filePath of paths) {
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(filePath, "fixture", "utf8");
	}

	const repoLocalStatePath = path.join(repoRoot, ".omniagent", "slash-commands", "legacy.toml");
	await mkdir(path.dirname(repoLocalStatePath), { recursive: true });
	await writeFile(repoLocalStatePath, "fixture", "utf8");

	const repoLocalManifest = path.join(
		repoRoot,
		".claude",
		"commands",
		".omniagent-slash-commands.toml",
	);
	await mkdir(path.dirname(repoLocalManifest), { recursive: true });
	await writeFile(repoLocalManifest, "fixture", "utf8");
}

describe.sequential("reset-state command", () => {
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

	it("resets only state for the current repository", async () => {
		await withTempRoot(async (root) => {
			const homeDir = path.join(root, "home");
			const repoA = path.join(root, "repo-a");
			const repoB = path.join(root, "repo-b");
			await mkdir(homeDir, { recursive: true });
			await mkdir(repoA, { recursive: true });
			await mkdir(repoB, { recursive: true });
			await writeFile(path.join(repoA, "package.json"), "{}", "utf8");
			await writeFile(path.join(repoB, "package.json"), "{}", "utf8");
			await createStateFixtures(homeDir, repoA);
			await createStateFixtures(homeDir, repoB);

			const homeSpy = vi.spyOn(os, "homedir").mockReturnValue(homeDir);
			const repoSubdir = path.join(repoA, "src", "nested");
			await mkdir(repoSubdir, { recursive: true });
			try {
				await withCwd(repoSubdir, async () => {
					await runCli(["node", "omniagent", "dev", "reset-state"]);
				});
			} finally {
				homeSpy.mockRestore();
			}

			const repoAHash = hashIdentifier(repoA);
			const repoBHash = hashIdentifier(repoB);

			expect(
				await pathExists(
					path.join(homeDir, ".omniagent", "state", "managed-outputs", "projects", repoAHash),
				),
			).toBe(false);
			expect(
				await pathExists(
					path.join(homeDir, ".omniagent", "state", "managed-outputs", "projects", repoBHash),
				),
			).toBe(true);

			expect(await pathExists(path.join(repoA, ".omniagent", "slash-commands"))).toBe(false);
			expect(await pathExists(path.join(repoB, ".omniagent", "slash-commands"))).toBe(true);
			expect(
				await pathExists(path.join(repoA, ".claude", "commands", ".omniagent-slash-commands.toml")),
			).toBe(false);
			expect(
				await pathExists(path.join(repoB, ".claude", "commands", ".omniagent-slash-commands.toml")),
			).toBe(true);

			const output = logSpy.mock.calls.map(([value]) => String(value)).join("\n");
			expect(output).toContain(`Reset project state for: ${repoA}`);
			expect(output).toContain("Removed");
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("errors when no project root is found", async () => {
		await withTempRoot(async (root) => {
			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "dev", "reset-state"]);
			});

			expect(errorSpy).toHaveBeenCalledWith(
				"Error: Could not find a project root from the current directory.",
			);
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	it("reports when no project state exists", async () => {
		await withTempRoot(async (root) => {
			const repo = path.join(root, "repo");
			await mkdir(repo, { recursive: true });
			await writeFile(path.join(repo, "package.json"), "{}", "utf8");
			await withCwd(repo, async () => {
				await runCli(["node", "omniagent", "dev", "reset-state"]);
			});
			expect(exitSpy).not.toHaveBeenCalled();
			const output = logSpy.mock.calls.map(([value]) => String(value)).join("\n");
			expect(output).toContain(`No project state found for: ${repo}`);
		});
	});
});
