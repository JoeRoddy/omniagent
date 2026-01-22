import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSubagentCatalog } from "../../src/lib/subagents/catalog.js";

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-catalog-"));
	try {
		await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function writeSubagent(root: string, fileName: string, name: string): Promise<string> {
	const catalogDir = path.join(root, "agents", "agents");
	await mkdir(catalogDir, { recursive: true });
	const contents = `---\nname: ${name}\n---\nBody\n`;
	const filePath = path.join(catalogDir, `${fileName}.md`);
	await writeFile(filePath, contents, "utf8");
	return filePath;
}

async function writeSubagentFile(
	root: string,
	fileName: string,
	contents: string,
): Promise<string> {
	const catalogDir = path.join(root, "agents", "agents");
	await mkdir(catalogDir, { recursive: true });
	const filePath = path.join(catalogDir, fileName);
	await writeFile(filePath, contents, "utf8");
	return filePath;
}

describe("subagent catalog", () => {
	it("includes both file paths in duplicate-name errors", async () => {
		await withTempRepo(async (root) => {
			const firstPath = await writeSubagent(root, "first", "Duplicate");
			const secondPath = await writeSubagent(root, "second", "duplicate");

			let message = "";
			try {
				await loadSubagentCatalog(root);
			} catch (error) {
				message = error instanceof Error ? error.message : String(error);
			}

			expect(message).toContain(firstPath);
			expect(message).toContain(secondPath);
		});
	});

	it("falls back to the filename when frontmatter name is missing", async () => {
		await withTempRepo(async (root) => {
			await writeSubagentFile(
				root,
				"fallback.md",
				["---", 'description: "No name"', "---", "Body"].join("\n"),
			);

			const catalog = await loadSubagentCatalog(root);
			expect(catalog.subagents[0]?.resolvedName).toBe("fallback");
		});
	});

	it("fails when frontmatter is invalid", async () => {
		await withTempRepo(async (root) => {
			await writeSubagentFile(
				root,
				"broken.md",
				["---", "name: ok", "invalid line", "---", "Body"].join("\n"),
			);

			await expect(loadSubagentCatalog(root)).rejects.toThrow(/Invalid frontmatter/);
		});
	});

	it("fails when a non-Markdown file exists in the catalog", async () => {
		await withTempRepo(async (root) => {
			await writeSubagentFile(root, "not-markdown.txt", "Contents");

			await expect(loadSubagentCatalog(root)).rejects.toThrow(/Non-Markdown file/);
		});
	});

	it("fails when a subagent file is empty", async () => {
		await withTempRepo(async (root) => {
			await writeSubagentFile(root, "empty.md", "");

			await expect(loadSubagentCatalog(root)).rejects.toThrow(/Subagent file is empty/);
		});
	});
});
