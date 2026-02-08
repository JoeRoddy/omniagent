import { readFile } from "node:fs/promises";

const README_PATH = new URL("../../README.md", import.meta.url);
const QUICKSTART_PATH = new URL(
	"../../specs/017-dynamic-template-scripts/quickstart.md",
	import.meta.url,
);

describe("README", () => {
	it("documents the agentsDir flag", async () => {
		const contents = await readFile(README_PATH, "utf8");

		expect(contents).toContain("--agentsDir");
		expect(contents).toContain("agents/");
	});

	it("documents agent-scoped templating", async () => {
		const contents = await readFile(README_PATH, "utf8");

		expect(contents).toContain("Agent-scoped templating");
		expect(contents).toContain("<agents");
	});

	it("documents dynamic template scripts with an end-to-end docs list example", async () => {
		const readme = await readFile(README_PATH, "utf8");
		const quickstart = await readFile(QUICKSTART_PATH, "utf8");

		expect(readme).toContain("Dynamic template scripts (`<oa-script>`)");
		expect(readme).toContain("sync --verbose");
		expect(quickstart).toContain("Current docs pages:");
		expect(quickstart).toContain('const docsDir = path.join(process.cwd(), "docs")');
		expect(quickstart).toContain('return pages.join("\\n");');
	});
});
