import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	loadInstructionTemplateCatalog,
	scanInstructionTemplateSources,
} from "../../../src/lib/instructions/catalog.js";

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-instructions-catalog-"));
	try {
		await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function writeTemplate(root: string, relPath: string, contents: string): Promise<string> {
	const filePath = path.join(root, relPath);
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, contents, "utf8");
	return filePath;
}

describe("instruction template catalog", () => {
	it("loads /agents templates and normalizes outPutPath", async () => {
		await withTempRepo(async (root) => {
			const rootPath = await writeTemplate(
				root,
				path.join("agents", "AGENTS.md"),
				"Root instructions",
			);
			const fooPath = await writeTemplate(
				root,
				path.join("agents", "sub", "foo.AGENTS.md"),
				["---", "outPutPath: docs/AGENTS.md", "---", "Foo"].join("\n"),
			);
			const teamPath = await writeTemplate(
				root,
				path.join("agents", "team", "AGENTS.md"),
				["---", "outPutPath: team/", "---", "Team"].join("\n"),
			);
			const dottedPath = await writeTemplate(
				root,
				path.join("agents", "dot", "dot.AGENTS.md"),
				["---", "outPutPath: docs.v2/", "---", "Dot"].join("\n"),
			);

			const catalog = await loadInstructionTemplateCatalog({ repoRoot: root });
			const rootTemplate = catalog.templates.find((template) => template.sourcePath === rootPath);
			const fooTemplate = catalog.templates.find((template) => template.sourcePath === fooPath);
			const teamTemplate = catalog.templates.find((template) => template.sourcePath === teamPath);
			const dottedTemplate = catalog.templates.find(
				(template) => template.sourcePath === dottedPath,
			);

			expect(rootTemplate?.resolvedOutputDir).toBe(root);
			expect(fooTemplate?.resolvedOutputDir).toBe(path.join(root, "docs"));
			expect(fooTemplate?.outPutPath).toBe("docs/AGENTS.md");
			expect(teamTemplate).toBeTruthy();
			expect(dottedTemplate?.resolvedOutputDir).toBe(path.join(root, "docs.v2"));
		});
	});

	it("marks templates missing outPutPath outside /agents/AGENTS.md", async () => {
		await withTempRepo(async (root) => {
			const missingPath = await writeTemplate(
				root,
				path.join("agents", "sub", "missing.AGENTS.md"),
				"Missing output path",
			);

			const catalog = await loadInstructionTemplateCatalog({ repoRoot: root });
			const missingTemplate = catalog.templates.find(
				(template) => template.sourcePath === missingPath,
			);

			expect(missingTemplate?.resolvedOutputDir).toBeNull();
		});
	});

	it("respects includeLocal when scanning templates", async () => {
		await withTempRepo(async (root) => {
			const sharedPath = await writeTemplate(root, path.join("agents", "AGENTS.md"), "Shared");
			const suffixPath = await writeTemplate(
				root,
				path.join("agents", "AGENTS.local.md"),
				"Local suffix",
			);
			const pathMarker = await writeTemplate(
				root,
				path.join("agents", ".local", "AGENTS.md"),
				"Local path",
			);

			const included = await scanInstructionTemplateSources({ repoRoot: root, includeLocal: true });
			const sharedEntry = included.find((entry) => entry.sourcePath === sharedPath);
			const suffixEntry = included.find((entry) => entry.sourcePath === suffixPath);
			const pathEntry = included.find((entry) => entry.sourcePath === pathMarker);

			expect(sharedEntry?.sourceType).toBe("shared");
			expect(suffixEntry?.sourceType).toBe("local");
			expect(suffixEntry?.markerType).toBe("suffix");
			expect(pathEntry?.sourceType).toBe("local");
			expect(pathEntry?.markerType).toBe("path");

			const excluded = await scanInstructionTemplateSources({
				repoRoot: root,
				includeLocal: false,
			});
			expect(excluded.some((entry) => entry.sourcePath === suffixPath)).toBe(false);
			expect(excluded.some((entry) => entry.sourcePath === pathMarker)).toBe(false);
			expect(excluded.some((entry) => entry.sourcePath === sharedPath)).toBe(true);
		});
	});

	it("uses the override directory when scanning templates", async () => {
		await withTempRepo(async (root) => {
			const defaultPath = await writeTemplate(root, path.join("agents", "AGENTS.md"), "Default");
			const customPath = await writeTemplate(
				root,
				path.join("custom-agents", "AGENTS.md"),
				"Custom",
			);

			const entries = await scanInstructionTemplateSources({
				repoRoot: root,
				agentsDir: "custom-agents",
			});
			const sources = entries.map((entry) => entry.sourcePath);

			expect(sources).toContain(customPath);
			expect(sources).not.toContain(defaultPath);
		});
	});
});
