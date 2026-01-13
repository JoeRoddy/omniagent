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
});
