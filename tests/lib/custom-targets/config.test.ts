import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../../src/lib/custom-targets/load-config.js";
import { resolveTargets } from "../../../src/lib/custom-targets/resolve-targets.js";
import { validateConfig } from "../../../src/lib/custom-targets/validate-config.js";
import { TARGETS } from "../../../src/lib/sync-targets.js";

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-custom-targets-"));
	try {
		await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("custom target configuration", () => {
	it("loads omniagent.config.ts from the repo root", async () => {
		await withTempRepo(async (root) => {
			const configPath = path.join(root, "omniagent.config.ts");
			await writeFile(
				configPath,
				"export default { targets: [{ id: 'acme', outputs: { skills: 'out/skills' } }] };\n",
				"utf8",
			);

			const loaded = await loadConfig({ repoRoot: root });

			expect(loaded?.configPath).toBe(configPath);
			expect(loaded?.config.targets?.[0]?.id).toBe("acme");
		});
	});

	it("preserves built-in targets when no config is provided", () => {
		const registry = resolveTargets(null);
		const ids = registry.resolved.map((target) => target.id);
		const builtInIds = TARGETS.map((target) => target.name);

		expect(ids).toEqual(builtInIds);
		expect(registry.resolved.every((target) => target.source === "built-in")).toBe(true);
	});

	it("resolves custom target ids, display names, and aliases", () => {
		const registry = resolveTargets({
			targets: [
				{
					id: "acme",
					displayName: "Acme Tool",
					aliases: ["ac", "acme-cli"],
					outputs: { skills: "out/skills" },
				},
			],
		});
		const custom = registry.resolved.find((target) => target.id === "acme");

		expect(custom?.displayName).toBe("Acme Tool");
		expect(custom?.aliases).toEqual(["ac", "acme-cli"]);
		expect(custom?.source).toBe("custom");
	});

	it("supports overrides, extensions, and disabled built-ins", () => {
		const registry = resolveTargets({
			disabledTargets: ["gemini"],
			targets: [
				{
					id: "claude",
					outputs: { skills: { path: "custom/skills" } },
				},
				{
					id: "extended",
					extends: "claude",
					outputs: { skills: { path: "custom/extended" } },
				},
				{
					id: "copilot",
					disabled: true,
				},
			],
		});

		const ids = registry.resolved.map((target) => target.id);
		expect(ids).not.toContain("gemini");
		expect(ids).not.toContain("copilot");

		const claude = registry.resolved.find((target) => target.id === "claude");
		expect(claude?.source).toBe("override");
		expect(claude?.outputs.skills?.path).toBe("custom/skills");
		expect(claude?.outputs.commands).not.toBeNull();

		const extended = registry.resolved.find((target) => target.id === "extended");
		expect(extended?.source).toBe("custom");
		expect(extended?.outputs.skills?.path).toBe("custom/extended");
		expect(extended?.outputs.commands).not.toBeNull();
	});

	it("reports validation errors with target context and setting paths", () => {
		const result = validateConfig({
			targets: [
				{
					id: "acme",
					outputs: {
						commands: {
							path: "out/commands",
							format: "xml" as "markdown",
						},
					},
				},
			],
		});

		expect(result.valid).toBe(false);
		const paths = result.errors.map((error) => error.path ?? "");
		expect(paths.some((entry) => entry.includes("targets[0:acme]"))).toBe(true);
		expect(paths.some((entry) => entry.includes("outputs.commands.format"))).toBe(true);
	});
});
