import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { copyDirectoryWithTemplating } from "../../src/lib/sync-copy.js";

async function withTempDir(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "agentctrl-copy-"));
	try {
		await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("copyDirectoryWithTemplating", () => {
	it("applies templating to text files", async () => {
		await withTempDir(async (root) => {
			const source = path.join(root, "source");
			const destination = path.join(root, "dest");
			await mkdir(path.join(source, "nested"), { recursive: true });
			await writeFile(
				path.join(source, "skill.txt"),
				"Hello<agents claude> world</agents>!",
				"utf8",
			);
			await writeFile(
				path.join(source, "nested", "note.md"),
				"A<agents not:claude> B</agents>C",
				"utf8",
			);

			await copyDirectoryWithTemplating({
				source,
				destination,
				target: "claude",
				validAgents: ["claude", "codex"],
			});

			const output = await readFile(path.join(destination, "skill.txt"), "utf8");
			const nested = await readFile(path.join(destination, "nested", "note.md"), "utf8");

			expect(output).toBe("Hello world!");
			expect(nested).toBe("AC");
		});
	});

	it("copies binary files without modification", async () => {
		await withTempDir(async (root) => {
			const source = path.join(root, "source");
			const destination = path.join(root, "dest");
			await mkdir(source, { recursive: true });
			const buffer = Buffer.from([0xff, 0x00, 0xfe, 0x10]);
			await writeFile(path.join(source, "asset.bin"), buffer);

			await copyDirectoryWithTemplating({
				source,
				destination,
				target: "claude",
				validAgents: ["claude"],
			});

			const output = await readFile(path.join(destination, "asset.bin"));
			expect(output.equals(buffer)).toBe(true);
		});
	});

	it("propagates templating errors", async () => {
		await withTempDir(async (root) => {
			const source = path.join(root, "source");
			const destination = path.join(root, "dest");
			await mkdir(source, { recursive: true });
			await writeFile(
				path.join(source, "broken.txt"),
				"Hi<agents claude,not:claude> x</agents>",
				"utf8",
			);

			await expect(
				copyDirectoryWithTemplating({
					source,
					destination,
					target: "claude",
					validAgents: ["claude"],
				}),
			).rejects.toThrow(/Agent templating error/);
		});
	});
});
