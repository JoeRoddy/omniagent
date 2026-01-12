import { readFile } from "node:fs/promises";
import path from "node:path";

describe("templating documentation", () => {
	it("mentions templating support across syncable features", async () => {
		const readme = await readFile(path.join(process.cwd(), "README.md"), "utf8");
		expect(readme).toContain("Agent-scoped templating");
		expect(readme).toContain("slash command");
		expect(readme).toContain("subagent");
		expect(readme).toContain("skill");

		const agents = await readFile(path.join(process.cwd(), "AGENTS.md"), "utf8");
		expect(agents).toContain("Agent-scoped templating");
		expect(agents).toContain("syncable features");
	});
});
