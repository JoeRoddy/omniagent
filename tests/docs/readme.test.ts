import { readFile } from "node:fs/promises";

const README_PATH = new URL("../../README.md", import.meta.url);

describe("README", () => {
	it("documents the agentsDir flag", async () => {
		const contents = await readFile(README_PATH, "utf8");

		expect(contents).toContain("--agentsDir");
		expect(contents).toContain("agents/");
	});
});
