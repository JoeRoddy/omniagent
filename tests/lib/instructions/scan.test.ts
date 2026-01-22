import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanRepoInstructionSources } from "../../../src/lib/instructions/scan.js";
import { BUILTIN_TARGETS } from "../../../src/lib/targets/builtins.js";

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-instructions-scan-"));
	try {
		await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function writeAgents(root: string, relPath: string): Promise<string> {
	const filePath = path.join(root, relPath);
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, `Content for ${relPath}`, "utf8");
	return filePath;
}

describe("instruction repo scanning", () => {
	it("discovers AGENTS.md outside /agents and respects ignore rules", async () => {
		await withTempRepo(async (root) => {
			await writeAgents(root, "AGENTS.md");
			await writeAgents(root, path.join("docs", "AGENTS.md"));
			await writeAgents(root, path.join("agents", "AGENTS.md"));
			await writeAgents(root, path.join("node_modules", "AGENTS.md"));
			await writeAgents(root, path.join("ignored", "AGENTS.md"));
			await writeFile(path.join(root, ".gitignore"), "ignored/\n", "utf8");

			const sources = await scanRepoInstructionSources({
				repoRoot: root,
				includeLocal: true,
				targets: BUILTIN_TARGETS,
			});
			const relative = sources.map((source) => path.relative(root, source.sourcePath)).sort();

			expect(relative).toEqual(["AGENTS.md", path.join("docs", "AGENTS.md")]);
		});
	});

	it("skips default directories when scanning for repo instructions", async () => {
		await withTempRepo(async (root) => {
			await writeAgents(root, "AGENTS.md");
			await writeAgents(root, path.join("docs", "AGENTS.md"));
			const skipDirs = [
				".git",
				"node_modules",
				"dist",
				".claude",
				".codex",
				".gemini",
				".github",
				".omniagent",
				"coverage",
			];
			for (const dir of skipDirs) {
				await writeAgents(root, path.join(dir, "AGENTS.md"));
			}

			const sources = await scanRepoInstructionSources({
				repoRoot: root,
				includeLocal: true,
				targets: BUILTIN_TARGETS,
			});
			const relative = sources.map((source) => path.relative(root, source.sourcePath)).sort();

			expect(relative).toEqual(["AGENTS.md", path.join("docs", "AGENTS.md")]);
		});
	});

	it("classifies local suffix and path markers", async () => {
		await withTempRepo(async (root) => {
			const suffixPath = await writeAgents(root, path.join("docs", "AGENTS.local.md"));
			const pathMarker = await writeAgents(root, path.join("docs.local", "AGENTS.md"));

			const sources = await scanRepoInstructionSources({
				repoRoot: root,
				includeLocal: true,
				targets: BUILTIN_TARGETS,
			});
			const suffixEntry = sources.find((source) => source.sourcePath === suffixPath);
			const pathEntry = sources.find((source) => source.sourcePath === pathMarker);

			expect(suffixEntry?.sourceType).toBe("local");
			expect(suffixEntry?.markerType).toBe("suffix");
			expect(pathEntry?.sourceType).toBe("local");
			expect(pathEntry?.markerType).toBe("path");
		});
	});

	it("supports negated gitignore patterns", async () => {
		await withTempRepo(async (root) => {
			await writeAgents(root, path.join("important", "AGENTS.md"));
			await writeAgents(root, path.join("ignored", "AGENTS.md"));
			await writeFile(
				path.join(root, ".gitignore"),
				["*", "!important/", "!important/AGENTS.md"].join("\n"),
				"utf8",
			);

			const sources = await scanRepoInstructionSources({
				repoRoot: root,
				includeLocal: true,
				targets: BUILTIN_TARGETS,
			});
			const relative = sources.map((source) => path.relative(root, source.sourcePath)).sort();

			expect(relative).toEqual([path.join("important", "AGENTS.md")]);
		});
	});

	it("excludes local sources when includeLocal is false", async () => {
		await withTempRepo(async (root) => {
			await writeAgents(root, "AGENTS.md");
			await writeAgents(root, "AGENTS.local.md");

			const sources = await scanRepoInstructionSources({
				repoRoot: root,
				includeLocal: false,
				targets: BUILTIN_TARGETS,
			});
			const relative = sources.map((source) => path.relative(root, source.sourcePath));

			expect(relative).toEqual(["AGENTS.md"]);
		});
	});

	it("skips the override agents directory when scanning repo instructions", async () => {
		await withTempRepo(async (root) => {
			await writeAgents(root, path.join("custom-agents", "AGENTS.md"));
			await writeAgents(root, path.join("docs", "AGENTS.md"));

			const sources = await scanRepoInstructionSources({
				repoRoot: root,
				includeLocal: true,
				agentsDir: "custom-agents",
				targets: BUILTIN_TARGETS,
			});
			const relative = sources.map((source) => path.relative(root, source.sourcePath)).sort();

			expect(relative).toEqual([path.join("docs", "AGENTS.md")]);
		});
	});
});
