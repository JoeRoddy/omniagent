import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadCommandCatalog } from "../../../src/lib/slash-commands/catalog.js";

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-slash-commands-catalog-"));
	try {
		await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("slash command catalog", () => {
	it("rejects duplicate command names case-insensitively", async () => {
		await withTempRepo(async (root) => {
			const commandsDir = path.join(root, "agents", "commands");
			await mkdir(path.join(commandsDir, "claude"), { recursive: true });
			await writeFile(path.join(commandsDir, "Review.md"), "Say hello.");
			await writeFile(path.join(commandsDir, "claude", "review.md"), "Say hello again.");

			await expect(loadCommandCatalog(root)).rejects.toThrow(/Duplicate command name/);
		});
	});
});
