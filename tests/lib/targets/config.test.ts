import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BUILTIN_TARGETS } from "../../../src/lib/targets/builtins.js";
import { findTargetConfigPath, loadTargetConfig } from "../../../src/lib/targets/config-loader.js";
import type { OmniagentConfig } from "../../../src/lib/targets/config-types.js";
import { validateTargetConfig } from "../../../src/lib/targets/config-validate.js";
import { resolveTargets } from "../../../src/lib/targets/resolve-targets.js";
import {
	defaultInstructionWriter,
	defaultSkillWriter,
	defaultSubagentWriter,
} from "../../../src/lib/targets/writers.js";

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-targets-config-"));
	try {
		await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("target config discovery", () => {
	it("finds the first config file by extension order in the agents dir", async () => {
		await withTempRepo(async (root) => {
			const agentsDir = path.join(root, "agents");
			await mkdir(agentsDir, { recursive: true });
			await writeFile(path.join(agentsDir, "omniagent.config.js"), "export default {}", "utf8");
			await writeFile(path.join(agentsDir, "omniagent.config.ts"), "export default {}", "utf8");

			const found = await findTargetConfigPath({ repoRoot: root });

			expect(found).toBe(path.join(agentsDir, "omniagent.config.ts"));
		});
	});

	it("ignores config files outside the agents dir", async () => {
		await withTempRepo(async (root) => {
			await writeFile(path.join(root, "omniagent.config.js"), "export default {}", "utf8");

			const found = await findTargetConfigPath({ repoRoot: root });

			expect(found).toBeNull();
		});
	});

	it("respects agentsDir overrides when locating config", async () => {
		await withTempRepo(async (root) => {
			const agentsDir = path.join(root, "custom-agents");
			await mkdir(agentsDir, { recursive: true });
			await writeFile(path.join(agentsDir, "omniagent.config.cjs"), "module.exports = {}", "utf8");

			const found = await findTargetConfigPath({ repoRoot: root, agentsDir: "custom-agents" });

			expect(found).toBe(path.join(agentsDir, "omniagent.config.cjs"));
		});
	});

	it("loads config modules from the agents dir", async () => {
		await withTempRepo(async (root) => {
			const agentsDir = path.join(root, "agents");
			await mkdir(agentsDir, { recursive: true });
			const configPath = path.join(agentsDir, "omniagent.config.cjs");
			await writeFile(configPath, "module.exports = { targets: [] };", "utf8");

			const { config, configPath: loadedPath } = await loadTargetConfig({ repoRoot: root });

			expect(loadedPath).toBe(configPath);
			expect(config).toEqual({ targets: [] });
		});
	});
});

describe("target config validation", () => {
	it("allows built-in overrides without inherits", () => {
		const config: OmniagentConfig = {
			targets: [{ id: "claude" }],
		};

		const validation = validateTargetConfig({ config, builtIns: BUILTIN_TARGETS });

		expect(validation.valid).toBe(true);
		expect(validation.errors).toEqual([]);
	});

	it("aggregates schema errors with actionable messages", () => {
		const config: OmniagentConfig = {
			disableTargets: ["unknown"],
			targets: [
				{
					id: "alpha",
					aliases: ["beta", "beta"],
					outputs: {
						skills: "{repoRoot}/{unknown}",
					},
				},
				{ id: "alpha" },
			],
		};

		const validation = validateTargetConfig({ config, builtIns: BUILTIN_TARGETS });

		expect(validation.valid).toBe(false);
		expect(validation.errors).toEqual(
			expect.arrayContaining([
				"disableTargets includes unknown built-in: unknown.",
				"targets[0].aliases includes duplicate alias (beta).",
				"targets[0].outputs.skills contains unknown placeholders: unknown.",
				"targets[1].id duplicates another target (alpha).",
			]),
		);
	});

	it("rejects empty defaultAgent values", () => {
		const config: OmniagentConfig = {
			defaultAgent: " " as OmniagentConfig["defaultAgent"],
		};

		const validation = validateTargetConfig({ config, builtIns: BUILTIN_TARGETS });

		expect(validation.valid).toBe(false);
		expect(validation.errors).toContain("defaultAgent must be a non-empty string when provided.");
	});
});

describe("target resolution", () => {
	it("merges built-ins with custom targets and applies overrides/inheritance", () => {
		const config: OmniagentConfig = {
			disableTargets: ["copilot"],
			targets: [
				{
					id: "claude",
					inherits: "claude",
					outputs: {
						instructions: "CLAUDE_OVERRIDE.md",
					},
				},
				{
					id: "acme",
					displayName: "Acme Agent",
					aliases: ["acme-ai"],
					inherits: "claude",
					outputs: {
						instructions: "ACME.md",
					},
				},
			],
		};

		const resolved = resolveTargets({ config, builtIns: BUILTIN_TARGETS });
		const ids = resolved.targets.map((target) => target.id);

		expect(ids).toEqual(expect.arrayContaining(["codex", "claude", "gemini", "acme"]));
		expect(ids).not.toContain("copilot");

		const builtinClaude = BUILTIN_TARGETS.find((target) => target.id === "claude");
		const claude = resolved.targets.find((target) => target.id === "claude");
		const acme = resolved.targets.find((target) => target.id === "acme");

		expect(claude?.outputs.instructions).toBe("CLAUDE_OVERRIDE.md");
		expect(claude?.outputs.skills).toEqual(builtinClaude?.outputs?.skills);
		expect(acme?.outputs.instructions).toBe("ACME.md");
		expect(acme?.outputs.skills).toEqual(builtinClaude?.outputs?.skills);
		expect(acme?.displayName).toBe("Acme Agent");
		expect(resolved.aliasToId.get("acme-ai")).toBe("acme");
		expect(resolved.configSourceById.get("claude")).toBe("inherits");
		expect(resolved.configSourceById.get("acme")).toBe("inherits");
	});

	it("exports target-agnostic default writers", () => {
		expect(defaultSkillWriter.id).toBe("default-skill-writer");
		expect(defaultSubagentWriter.id).toBe("default-subagent-writer");
		expect(defaultInstructionWriter.id).toBe("default-instruction-writer");
	});

	it("preserves built-ins when no config is provided", () => {
		const resolved = resolveTargets({ config: null, builtIns: BUILTIN_TARGETS });

		expect(resolved.targets.map((target) => target.id)).toEqual(
			BUILTIN_TARGETS.map((target) => target.id),
		);
		for (const target of resolved.targets) {
			expect(target.isBuiltIn).toBe(true);
			expect(target.isCustomized).toBe(false);
		}
	});
});
