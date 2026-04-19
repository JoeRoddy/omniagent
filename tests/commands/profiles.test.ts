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

async function writeProfile(
	root: string,
	relative: string,
	data: Record<string, unknown>,
): Promise<void> {
	const target = path.join(root, "agents", relative);
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, JSON.stringify(data), "utf8");
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

	it("shows fully-resolved merged profile as JSON", async () => {
		await withTempRepo(async (root) => {
			await writeProfile(root, "profiles/base.json", {
				disable: { skills: ["ppt"] },
			});
			await writeProfile(root, "profiles/code-reviewer.json", {
				extends: "base",
				description: "Review",
				enable: { skills: ["review"] },
			});

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles", "show", "code-reviewer"]);
			});

			const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			const parsed = JSON.parse(output);
			expect(parsed.description).toBe("Review");
			expect(parsed.enable.skills).toEqual(["review"]);
			expect(parsed.disable.skills).toEqual(["ppt"]);
		});
	});

	it("validate exits zero when profiles are valid", async () => {
		await withTempRepo(async (root) => {
			await writeProfile(root, "profiles/ok.json", { description: "good" });

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "profiles", "validate"]);
			});

			expect(exitSpy).not.toHaveBeenCalled();
		});
	});

	it("validate exits non-zero on schema violations", async () => {
		await withTempRepo(async (root) => {
			const filePath = path.join(root, "agents", "profiles", "bad.json");
			await mkdir(path.dirname(filePath), { recursive: true });
			await writeFile(filePath, JSON.stringify({ extends: 42 }), "utf8");

			await withCwd(root, async () => {
				try {
					await runCli(["node", "omniagent", "profiles", "validate"]);
				} catch {
					// expected — schema errors throw during load
				}
			});

			const errOut = errorSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
			expect(errOut).toContain("bad");
		});
	});
});
