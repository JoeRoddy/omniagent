import { readFile } from "node:fs/promises";

const PACKAGE_PATH = new URL("../../package.json", import.meta.url);
const BIOME_PATH = new URL("../../biome.json", import.meta.url);
const TSCONFIG_PATH = new URL("../../tsconfig.json", import.meta.url);
const VITEST_CONFIG_PATH = new URL("../../vitest.config.ts", import.meta.url);

async function readJson<T>(url: URL): Promise<T> {
	const contents = await readFile(url, "utf8");
	return JSON.parse(contents) as T;
}

describe("tooling configuration", () => {
	it("runs tests via vitest in non-interactive mode", async () => {
		const pkg = await readJson<{ scripts?: Record<string, string> }>(PACKAGE_PATH);
		const testScript = pkg.scripts?.test ?? "";

		expect(testScript).toContain("vitest run");
		expect(testScript).not.toContain("--watch");

		const configModule = await import(VITEST_CONFIG_PATH.href);
		const config = configModule.default;
		expect(config.test?.include ?? []).toEqual(expect.arrayContaining(["tests/**/*.test.ts"]));
		const reporters = config.test?.reporters;
		const reporterList = Array.isArray(reporters)
			? reporters
			: reporters
				? [reporters]
				: ["default"];
		expect(reporterList).toEqual(expect.arrayContaining(["default"]));
		expect(config.test?.silent).not.toBe(true);
	});

	it("wires biome checks and formatting commands", async () => {
		const pkg = await readJson<{
			devDependencies?: Record<string, string>;
			scripts?: Record<string, string>;
		}>(PACKAGE_PATH);
		const scripts = pkg.scripts ?? {};

		expect(pkg.devDependencies).toHaveProperty("@biomejs/biome");
		expect(scripts.check ?? "").toContain("biome check");
		expect(scripts.check ?? "").not.toContain("--write");
		expect(scripts.format ?? "").toContain("biome format");
		expect(scripts.build ?? "").toContain("npm run check");

		const biome = await readJson<{ files?: { includes?: string[] } }>(BIOME_PATH);
		const includes = biome.files?.includes ?? [];
		expect(includes).toEqual(expect.arrayContaining(["src/**/*.ts"]));
		expect(includes).toEqual(expect.arrayContaining(["tests/**/*.ts"]));
		expect(includes.some((entry) => entry.includes("dist"))).toBe(false);
		expect(includes.some((entry) => entry.includes("coverage"))).toBe(false);
		expect(includes.some((entry) => entry.includes("node_modules"))).toBe(false);
	});

	it("builds with Vite and targets compiled JS entrypoints", async () => {
		const pkg = await readJson<{
			devDependencies?: Record<string, string>;
			scripts?: Record<string, string>;
			main?: string;
			bin?: Record<string, string>;
		}>(PACKAGE_PATH);
		const scripts = pkg.scripts ?? {};

		expect(pkg.devDependencies).toHaveProperty("vite");
		expect(scripts.build ?? "").toContain("vite build");
		expect(pkg.main ?? "").toMatch(/dist\/.+\.js$/);
		expect(pkg.bin?.omniagent ?? "").toMatch(/dist\/.+\.js$/);
	});

	it("keeps typecheck as a no-emit verification step", async () => {
		const pkg = await readJson<{ scripts?: Record<string, string> }>(PACKAGE_PATH);
		expect(pkg.scripts?.typecheck ?? "").toContain("tsgo --noEmit");

		const tsconfig = await readJson<{ compilerOptions?: Record<string, unknown> }>(TSCONFIG_PATH);
		const compilerOptions = tsconfig.compilerOptions ?? {};
		expect(compilerOptions).not.toHaveProperty("outDir");
		expect(compilerOptions).not.toHaveProperty("declarationDir");
	});
});
