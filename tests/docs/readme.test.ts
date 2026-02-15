import { readFile } from "node:fs/promises";

const README_PATH = new URL("../../README.md", import.meta.url);
const DOCS_INDEX_PATH = new URL("../../docs/README.md", import.meta.url);
const TEMPLATING_PATH = new URL("../../docs/templating.md", import.meta.url);
const QUICKSTART_PATH = new URL(
	"../../specs/017-dynamic-template-scripts/quickstart.md",
	import.meta.url,
);

describe("README", () => {
	it("focuses on onboarding and links to advanced docs", async () => {
		const contents = await readFile(README_PATH, "utf8");

		expect(contents).toContain("## Quickstart");
		expect(contents).toContain("## How It Works");
		expect(contents).toContain("## Common Commands");
		expect(contents).toContain("## Agent CLI Shim");
		expect(contents).toContain("## Local Overrides (`.local`)");
		expect(contents).toContain("## Basic Templating");
		expect(contents).toContain("## Documentation");
		expect(contents).toContain("docs/custom-targets.md");
		expect(contents).toContain("docs/templating.md");
		expect(contents).toContain("docs/cli-shim.md");
		expect(contents).toContain("--agentsDir");
		expect(contents).toContain("deploy.local.md");
		expect(contents).toContain("SKILL.local.md");
		expect(contents).toContain(".local/");
		expect(contents).toContain("deploy.md");
		expect(contents).toContain("my-personal-command.md");
		expect(contents).toContain("<agents claude,codex>");
		expect(contents).toMatch(/agent="\$\{1:-claude\}"/);
		expect(contents).toContain("## Contributing");
		expect(contents).toContain("CONTRIBUTING.md");
		expect(contents).not.toContain("## Validation");
		expect(contents).not.toContain("docs/cli-shim-e2e.md");
	});

	it("keeps advanced templating details in docs pages", async () => {
		const readme = await readFile(README_PATH, "utf8");
		const templating = await readFile(TEMPLATING_PATH, "utf8");

		expect(readme).not.toContain("Agent-scoped templating");
		expect(readme).not.toContain("Dynamic template scripts (`<nodejs>` and `<shell>`)");
		expect(templating).toContain("Agent-scoped templating");
		expect(templating).toContain("<agents");
		expect(templating).toContain("Dynamic template scripts (`<nodejs>` and `<shell>`)");
		expect(templating).toContain("<shell>");
		expect(templating).toContain("sync --verbose");
	});

	it("keeps docs index and dynamic template quickstart example discoverable", async () => {
		const docsIndex = await readFile(DOCS_INDEX_PATH, "utf8");
		const quickstart = await readFile(QUICKSTART_PATH, "utf8");

		expect(docsIndex).toContain("docs/custom-targets.md");
		expect(docsIndex).toContain("docs/templating.md");
		expect(docsIndex).toContain("docs/reference.md");
		expect(docsIndex).toContain("CONTRIBUTING.md");
		expect(docsIndex).not.toContain("docs/cli-shim-e2e.md");
		expect(quickstart).toContain("Current docs pages:");
		expect(quickstart).toContain('const docsDir = path.join(process.cwd(), "docs")');
		expect(quickstart).toContain('return pages.join("\\n");');
	});
});
