import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncInstructions } from "../../../src/lib/instructions/sync.js";
import { SUPPORTED_AGENT_NAMES } from "../../../src/lib/supported-targets.js";

const VALID_AGENTS = [...SUPPORTED_AGENT_NAMES];

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-instructions-sync-"));
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

async function writeInstruction(root: string, relPath: string, contents: string): Promise<string> {
	const filePath = path.join(root, relPath);
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, contents, "utf8");
	return filePath;
}

async function pathExists(candidate: string): Promise<boolean> {
	try {
		await stat(candidate);
		return true;
	} catch {
		return false;
	}
}

describe("instruction sync", () => {
	it("syncs repo AGENTS sources and preserves AGENTS for codex", async () => {
		await withTempRepo(async (root) => {
			await writeInstruction(root, path.join("docs", "AGENTS.md"), "Repo instructions");

			const summary = await syncInstructions({
				repoRoot: root,
				targets: ["claude", "gemini", "codex"],
				validAgents: VALID_AGENTS,
				removeMissing: true,
				nonInteractive: true,
			});

			const claude = await readFile(path.join(root, "docs", "CLAUDE.md"), "utf8");
			const gemini = await readFile(path.join(root, "docs", "GEMINI.md"), "utf8");
			const agents = await readFile(path.join(root, "docs", "AGENTS.md"), "utf8");

			expect(claude).toBe("Repo instructions");
			expect(gemini).toBe("Repo instructions");
			expect(agents).toBe("Repo instructions");

			const codexResult = summary.results.find((result) => result.targetName === "codex");
			expect(codexResult?.counts.skipped).toBe(1);
		});
	});

	it("treats repo AGENTS as plain text without frontmatter or templating", async () => {
		await withTempRepo(async (root) => {
			const content = [
				"---",
				"targets: [claude]",
				"---",
				"Hello <agents claude>Claude</agents><agents not:claude>Other</agents>",
			].join("\n");
			await writeInstruction(root, path.join("docs", "AGENTS.md"), content);

			await syncInstructions({
				repoRoot: root,
				targets: ["claude", "gemini"],
				validAgents: VALID_AGENTS,
				nonInteractive: true,
			});

			const claude = await readFile(path.join(root, "docs", "CLAUDE.md"), "utf8");
			const gemini = await readFile(path.join(root, "docs", "GEMINI.md"), "utf8");

			expect(claude).toBe(content);
			expect(gemini).toBe(content);
		});
	});

	it("does not overwrite repo AGENTS outputs when a local override exists", async () => {
		await withTempRepo(async (root) => {
			await writeInstruction(root, path.join("docs", "AGENTS.md"), "Shared instructions");
			await writeInstruction(root, path.join("docs", "AGENTS.local.md"), "Local instructions");

			await syncInstructions({
				repoRoot: root,
				targets: ["claude", "codex"],
				validAgents: VALID_AGENTS,
				nonInteractive: true,
			});

			const claude = await readFile(path.join(root, "docs", "CLAUDE.md"), "utf8");
			const agents = await readFile(path.join(root, "docs", "AGENTS.md"), "utf8");

			expect(claude).toBe("Local instructions");
			expect(agents).toBe("Shared instructions");
		});
	});

	it("does not write AGENTS outputs without codex/copilot targets", async () => {
		await withTempRepo(async (root) => {
			await writeInstruction(root, path.join("agents", "AGENTS.md"), "Template instructions");

			await syncInstructions({
				repoRoot: root,
				targets: ["claude"],
				validAgents: VALID_AGENTS,
				nonInteractive: true,
			});

			expect(await pathExists(path.join(root, "AGENTS.md"))).toBe(false);
			const claude = await readFile(path.join(root, "CLAUDE.md"), "utf8");
			expect(claude).toBe("Template instructions");
		});
	});

	it("prefers templates over repo sources and overwrites existing outputs", async () => {
		await withTempRepo(async (root) => {
			await writeInstruction(root, "AGENTS.md", "Repo instructions");
			await writeInstruction(root, path.join("agents", "AGENTS.md"), "Template instructions");
			await writeInstruction(root, "CLAUDE.md", "Old output");

			const summary = await syncInstructions({
				repoRoot: root,
				targets: ["claude"],
				validAgents: VALID_AGENTS,
				nonInteractive: true,
			});

			const output = await readFile(path.join(root, "CLAUDE.md"), "utf8");
			const source = await readFile(path.join(root, "AGENTS.md"), "utf8");

			expect(output).toBe("Template instructions");
			expect(source).toBe("Repo instructions");

			const result = summary.results.find((entry) => entry.targetName === "claude");
			expect(result?.counts.updated).toBe(1);
		});
	});

	it("overrides repo AGENTS outputs when a template targets codex", async () => {
		await withTempRepo(async (root) => {
			await writeInstruction(root, path.join("docs", "AGENTS.md"), "Repo instructions");
			const template = [
				"---",
				"outPutPath: docs/",
				"targets: codex",
				"---",
				"Template <agents codex>Codex</agents><agents not:codex>Other</agents>",
			].join("\n");
			await writeInstruction(root, path.join("agents", "override.AGENTS.md"), template);

			await syncInstructions({
				repoRoot: root,
				targets: ["codex"],
				validAgents: VALID_AGENTS,
				nonInteractive: true,
			});

			const output = await readFile(path.join(root, "docs", "AGENTS.md"), "utf8");
			expect(output).toBe("Template Codex");
		});
	});

	it("normalizes outPutPath and applies templating", async () => {
		await withTempRepo(async (root) => {
			const template = [
				"---",
				"outPutPath: docs/AGENTS.md",
				"---",
				"Hello <agents claude>Claude</agents><agents not:claude>Other</agents>",
			].join("\n");
			await writeInstruction(root, path.join("agents", "sub", "foo.AGENTS.md"), template);

			await syncInstructions({
				repoRoot: root,
				targets: ["claude"],
				validAgents: VALID_AGENTS,
				nonInteractive: true,
			});

			const output = await readFile(path.join(root, "docs", "CLAUDE.md"), "utf8");
			expect(output).toContain("Hello Claude");
			expect(output).not.toContain("Other");
		});
	});

	it("writes outputs for nested AGENTS templates with outPutPath", async () => {
		await withTempRepo(async (root) => {
			const template = ["---", "outPutPath: docs/team", "---", "Team instructions"].join("\n");
			await writeInstruction(root, path.join("agents", "team", "AGENTS.md"), template);

			await syncInstructions({
				repoRoot: root,
				targets: ["claude"],
				validAgents: VALID_AGENTS,
				nonInteractive: true,
			});

			const output = await readFile(path.join(root, "docs", "team", "CLAUDE.md"), "utf8");
			expect(output).toBe("Team instructions");
		});
	});

	it("warns and skips templates missing outPutPath outside /agents/AGENTS.md", async () => {
		await withTempRepo(async (root) => {
			await writeInstruction(
				root,
				path.join("agents", "sub", "missing.AGENTS.md"),
				"Missing output path",
			);

			const summary = await syncInstructions({
				repoRoot: root,
				targets: ["claude"],
				validAgents: VALID_AGENTS,
				nonInteractive: true,
			});

			expect(summary.warnings.some((warning) => warning.includes("missing outPutPath"))).toBe(true);
			expect(await pathExists(path.join(root, "CLAUDE.md"))).toBe(false);
		});
	});

	it("prefers local templates over shared templates", async () => {
		await withTempRepo(async (root) => {
			await writeInstruction(root, path.join("agents", "AGENTS.md"), "Shared");
			await writeInstruction(root, path.join("agents", ".local", "AGENTS.md"), "Local");

			await syncInstructions({
				repoRoot: root,
				targets: ["claude"],
				validAgents: VALID_AGENTS,
				nonInteractive: true,
			});

			const output = await readFile(path.join(root, "CLAUDE.md"), "utf8");
			expect(output).toBe("Local");
		});
	});

	it("excludes local templates when excludeLocal is set", async () => {
		await withTempRepo(async (root) => {
			await writeInstruction(root, path.join("agents", "AGENTS.md"), "Shared");
			await writeInstruction(root, path.join("agents", ".local", "AGENTS.md"), "Local");

			await syncInstructions({
				repoRoot: root,
				targets: ["claude"],
				validAgents: VALID_AGENTS,
				excludeLocal: true,
				nonInteractive: true,
			});

			const output = await readFile(path.join(root, "CLAUDE.md"), "utf8");
			expect(output).toBe("Shared");
		});
	});

	it("applies overrideOnly filters to instruction outputs", async () => {
		await withTempRepo(async (root) => {
			await writeInstruction(root, path.join("docs", "AGENTS.md"), "Repo instructions");

			await syncInstructions({
				repoRoot: root,
				targets: ["claude", "gemini"],
				overrideOnly: ["claude"],
				validAgents: VALID_AGENTS,
				nonInteractive: true,
			});

			expect(await pathExists(path.join(root, "docs", "CLAUDE.md"))).toBe(true);
			expect(await pathExists(path.join(root, "docs", "GEMINI.md"))).toBe(false);
		});
	});

	it("applies overrideSkip filters to instruction outputs", async () => {
		await withTempRepo(async (root) => {
			await writeInstruction(root, path.join("docs", "AGENTS.md"), "Repo instructions");

			await syncInstructions({
				repoRoot: root,
				targets: ["claude", "gemini"],
				overrideSkip: ["gemini"],
				validAgents: VALID_AGENTS,
				nonInteractive: true,
			});

			expect(await pathExists(path.join(root, "docs", "CLAUDE.md"))).toBe(true);
			expect(await pathExists(path.join(root, "docs", "GEMINI.md"))).toBe(false);
		});
	});

	it("removes unchanged outputs when sources disappear", async () => {
		await withTempRepo(async (root) => {
			await writeInstruction(root, path.join("docs", "AGENTS.md"), "Repo instructions");

			await syncInstructions({
				repoRoot: root,
				targets: ["claude"],
				validAgents: VALID_AGENTS,
				removeMissing: true,
				nonInteractive: true,
			});

			await rm(path.join(root, "docs", "AGENTS.md"), { force: true });

			const summary = await syncInstructions({
				repoRoot: root,
				targets: ["claude"],
				validAgents: VALID_AGENTS,
				removeMissing: true,
				nonInteractive: true,
			});

			expect(await pathExists(path.join(root, "docs", "CLAUDE.md"))).toBe(false);
			const result = summary.results.find((entry) => entry.targetName === "claude");
			expect(result?.counts.removed).toBe(1);
		});
	});

	it("keeps modified outputs in non-interactive mode", async () => {
		await withTempRepo(async (root) => {
			await writeInstruction(root, path.join("docs", "AGENTS.md"), "Repo instructions");

			await syncInstructions({
				repoRoot: root,
				targets: ["claude"],
				validAgents: VALID_AGENTS,
				removeMissing: true,
				nonInteractive: true,
			});

			await writeInstruction(root, path.join("docs", "CLAUDE.md"), "Edited output");
			await rm(path.join(root, "docs", "AGENTS.md"), { force: true });

			const summary = await syncInstructions({
				repoRoot: root,
				targets: ["claude"],
				validAgents: VALID_AGENTS,
				removeMissing: true,
				nonInteractive: true,
			});

			const output = await readFile(path.join(root, "docs", "CLAUDE.md"), "utf8");
			expect(output).toBe("Edited output");
			expect(
				summary.warnings.some((warning) => warning.includes("Output modified since last sync")),
			).toBe(true);
		});
	});

	it("only removes outputs that were tracked in the manifest", async () => {
		await withTempRepo(async (root) => {
			await writeInstruction(root, path.join("docs", "AGENTS.md"), "Repo instructions");

			await syncInstructions({
				repoRoot: root,
				targets: ["claude", "gemini"],
				overrideOnly: ["gemini"],
				validAgents: VALID_AGENTS,
				removeMissing: true,
				nonInteractive: true,
			});

			expect(await pathExists(path.join(root, "docs", "GEMINI.md"))).toBe(true);
			await writeInstruction(root, path.join("docs", "CLAUDE.md"), "Untracked output");
			await rm(path.join(root, "docs", "AGENTS.md"), { force: true });

			await syncInstructions({
				repoRoot: root,
				targets: ["claude", "gemini"],
				validAgents: VALID_AGENTS,
				removeMissing: true,
				nonInteractive: true,
			});

			expect(await pathExists(path.join(root, "docs", "GEMINI.md"))).toBe(false);
			const claude = await readFile(path.join(root, "docs", "CLAUDE.md"), "utf8");
			expect(claude).toBe("Untracked output");
		});
	});

	it("shares AGENTS output when codex and copilot are selected", async () => {
		await withTempRepo(async (root) => {
			await writeInstruction(root, path.join("agents", "AGENTS.md"), "Template instructions");

			const summary = await syncInstructions({
				repoRoot: root,
				targets: ["codex", "copilot"],
				validAgents: VALID_AGENTS,
				nonInteractive: true,
			});

			const output = await readFile(path.join(root, "AGENTS.md"), "utf8");
			expect(output).toBe("Template instructions");

			const codexResult = summary.results.find((result) => result.targetName === "codex");
			const copilotResult = summary.results.find((result) => result.targetName === "copilot");

			expect(codexResult?.counts.created).toBe(1);
			expect(codexResult?.counts.total).toBe(1);
			expect(copilotResult?.counts.total).toBe(0);
			expect(copilotResult?.message).toContain("Shared AGENTS.md output with codex");
		});
	});

	it("renders shared AGENTS output using the primary target content", async () => {
		await withTempRepo(async (root) => {
			const template = [
				"---",
				"---",
				"Hello <agents codex>Codex</agents><agents copilot>Copilot</agents>",
			].join("\n");
			await writeInstruction(root, path.join("agents", "AGENTS.md"), template);

			await syncInstructions({
				repoRoot: root,
				targets: ["codex", "copilot"],
				validAgents: VALID_AGENTS,
				nonInteractive: true,
			});

			const output = await readFile(path.join(root, "AGENTS.md"), "utf8");
			expect(output).toContain("Hello Codex");
			expect(output).not.toContain("Copilot");
		});
	});
});
