import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli/index.js";

async function withTempRepo(fn: (root: string, homeDir: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-custom-targets-cli-"));
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

async function writeSkill(root: string, name: string, body: string): Promise<void> {
	const dir = path.join(root, "agents", "skills", name);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "SKILL.md"), body, "utf8");
}

describe.sequential("sync command with custom targets", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let exitSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
		process.exitCode = undefined;
	});

	afterEach(() => {
		logSpy.mockRestore();
		exitSpy.mockRestore();
		process.exitCode = undefined;
	});

	it("exits non-zero when converter errors occur", async () => {
		await withTempRepo(async (root) => {
			await createRepoRoot(root);
			await writeSkill(root, "alpha", "Alpha skill");
			await writeSkill(root, "beta", "Beta skill");
			const agentsDir = path.join(root, "agents");
			await mkdir(agentsDir, { recursive: true });
			const configPath = path.join(agentsDir, "omniagent.config.cjs");
			const configContents = [
				'const path = require("node:path");',
				"module.exports = {",
				"  targets: [",
				"    {",
				'      id: "acme",',
				"      outputs: {",
				"        skills: {",
				'          path: "{repoRoot}/.acme/skills/{itemName}",',
				"          converter: {",
				"            convert: (item, context) => {",
				'              const name = item?.name || "";',
				'              if (name === "alpha") {',
				'                return { error: "bad alpha" };',
				"              }",
				"              return {",
				"                output: {",
				'                  outputPath: path.join(context.repoRoot, "converted", "beta.txt"),',
				'                  content: "ok"',
				"                }",
				"              };",
				"            }",
				"          }",
				"        }",
				"      }",
				"    }",
				"  ]",
				"};",
			].join("\n");
			await writeFile(configPath, configContents, "utf8");

			await withCwd(root, async () => {
				await runCli(["node", "omniagent", "sync", "--only", "acme", "--yes", "--json"]);
			});

			expect(exitSpy).not.toHaveBeenCalled();
			expect(process.exitCode).toBe(1);
			expect(await readFile(path.join(root, "converted", "beta.txt"), "utf8")).toBe("ok");
		});
	});
});
