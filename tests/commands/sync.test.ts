import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli/index.js";

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "agentctl-sync-"));
	try {
		await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function withCwd(dir: string, fn: () => Promise<void>): Promise<void> {
	const previous = process.cwd();
	process.chdir(dir);
	try {
		await fn();
	} finally {
		process.chdir(previous);
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

async function createCanonicalConfig(root: string): Promise<string> {
	const sourceDir = path.join(root, "agents", "skills");
	await mkdir(sourceDir, { recursive: true });
	await writeFile(path.join(sourceDir, "example.txt"), "hello");
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
			await createCanonicalConfig(root);

			await withCwd(root, async () => {
				await runCli(["node", "agentctl", "sync"]);
			});

			const codex = await readFile(path.join(root, ".codex", "skills", "example.txt"), "utf8");
			const claude = await readFile(path.join(root, ".claude", "skills", "example.txt"), "utf8");
			const copilot = await readFile(path.join(root, ".github", "skills", "example.txt"), "utf8");

			expect(codex).toBe("hello");
			expect(claude).toBe("hello");
			expect(copilot).toBe("hello");
			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("respects --only filters", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalConfig(root);

			await withCwd(root, async () => {
				await runCli(["node", "agentctl", "sync", "--only", "claude"]);
			});

			expect(await pathExists(path.join(root, ".claude", "skills", "example.txt"))).toBe(true);
			expect(await pathExists(path.join(root, ".codex", "skills"))).toBe(false);
			expect(await pathExists(path.join(root, ".github", "skills"))).toBe(false);
		});
	});

	it("errors on unknown targets without syncing", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await createCanonicalConfig(root);

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
			await createCanonicalConfig(root);

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
			const canonicalRoot = await realpath(root);
			const expected = path.join(canonicalRoot, "agents", "skills");

			await withCwd(path.join(root, "subdir"), async () => {
				await runCli(["node", "agentctl", "sync"]);
			});

			expect(errorSpy).toHaveBeenCalledWith(
				`Error: Canonical config source not found at ${expected}.`,
			);
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	it("emits JSON summaries when --json is provided", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			const sourcePath = await createCanonicalConfig(root);

			await withCwd(root, async () => {
				await runCli(["node", "agentctl", "sync", "--json"]);
			});

			expect(logSpy).toHaveBeenCalled();
			const output = logSpy.mock.calls[0]?.[0];
			const parsed = JSON.parse(output);
			expect(parsed.sourcePath).toBe(sourcePath);
			expect(parsed.results).toHaveLength(3);
			expect(parsed.hadFailures).toBe(false);
		});
	});
});
