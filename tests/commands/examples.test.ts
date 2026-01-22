import { readdir, stat } from "node:fs/promises";

const COMMANDS_DIR = new URL("../../src/cli/commands/", import.meta.url);
const TESTS_DIR = new URL("./", import.meta.url);

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await stat(filePath);
		return true;
	} catch {
		return false;
	}
}

describe("example CLI commands", () => {
	it("includes at least three example commands", async () => {
		const entries = await readdir(COMMANDS_DIR);
		const commandFiles = entries.filter((entry) => entry.endsWith(".ts") && entry !== "sync.ts");

		expect(commandFiles.length).toBeGreaterThanOrEqual(3);
		expect(commandFiles).toEqual(expect.arrayContaining(["hello.ts", "greet.ts", "echo.ts"]));
	});

	it("has tests for each example command", async () => {
		const commandTests = ["hello.test.ts", "greet.test.ts", "echo.test.ts"];
		for (const testFile of commandTests) {
			const filePath = new URL(testFile, TESTS_DIR).pathname;
			expect(await pathExists(filePath)).toBe(true);
		}
	});
});
