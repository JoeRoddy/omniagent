import { readFile } from "node:fs/promises";

const CI_PATH = new URL("../../.github/workflows/ci.yml", import.meta.url);
const PACKAGE_PATH = new URL("../../package.json", import.meta.url);

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readWorkflow(): Promise<string> {
	return readFile(CI_PATH, "utf8");
}

async function readPackage(): Promise<{ scripts?: Record<string, string> }> {
	const contents = await readFile(PACKAGE_PATH, "utf8");
	return JSON.parse(contents) as { scripts?: Record<string, string> };
}

function expectStep(contents: string, name: string, run: string): void {
	const pattern = new RegExp(
		`- name:\\s*${escapeRegex(name)}[\\s\\S]*?\\n\\s*run:\\s*${escapeRegex(run)}`,
	);
	expect(contents).toMatch(pattern);
}

describe("ci workflow", () => {
	it("runs on pull requests and pushes", async () => {
		const contents = await readWorkflow();
		expect(contents).toMatch(/\n\s*pull_request:\s*\n/);
		expect(contents).toMatch(/\n\s*push:\s*\n/);
		expect(contents).not.toMatch(/pull_request_target/);
	});

	it("runs quality, typecheck, tests, and build as separate steps", async () => {
		const contents = await readWorkflow();
		expectStep(contents, "Quality check", "npm run check");
		expectStep(contents, "Typecheck", "npm run typecheck");
		expectStep(contents, "Test", "npm test");
		expectStep(contents, "Build", "npm run build");

		const qualityIndex = contents.indexOf("name: Quality check");
		const typecheckIndex = contents.indexOf("name: Typecheck");
		expect(qualityIndex).toBeGreaterThan(-1);
		expect(typecheckIndex).toBeGreaterThan(-1);
		expect(qualityIndex).toBeLessThan(typecheckIndex);
	});

	it("fails the workflow if any required step fails", async () => {
		const contents = await readWorkflow();
		expect(contents).not.toMatch(/continue-on-error:\s*true/);
		expect(contents).not.toMatch(/\|\|\s*true/);
	});

	it("uses read-only permissions and avoids secrets on forked pull requests", async () => {
		const contents = await readWorkflow();
		expect(contents).toMatch(/\npermissions:\s*read-all\s*\n/);
		expect(contents).not.toMatch(/secrets\./);
	});

	it("uses the package typecheck command in CI", async () => {
		const contents = await readWorkflow();
		const pkg = await readPackage();
		expect(pkg.scripts?.typecheck ?? "").toContain("tsgo --noEmit");
		expect(contents).toMatch(/run:\s*npm run typecheck/);
	});
});
