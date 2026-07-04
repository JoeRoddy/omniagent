import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BUILTIN_TARGETS } from "../../../src/lib/targets/builtins.js";
import { findTargetConfigPath, loadTargetConfig } from "../../../src/lib/targets/config-loader.js";
import type {
	OmniagentConfig,
	TargetDefinition,
	TargetUsageDefinition,
} from "../../../src/lib/targets/config-types.js";
import { validateTargetConfig } from "../../../src/lib/targets/config-validate.js";
import { resolveTargets } from "../../../src/lib/targets/resolve-targets.js";
import {
	defaultInstructionWriter,
	defaultSkillWriter,
	defaultSubagentWriter,
} from "../../../src/lib/targets/writers.js";

function createUsage(windows: string[] = ["5h"]): TargetUsageDefinition {
	return {
		windows,
		extract: async (context) => ({
			targetId: context.targetId,
			displayName: context.displayName,
			command: context.command,
			limits: [
				{
					id: `${context.targetId}-${context.window}`,
					targetId: context.targetId,
					agent: context.targetId,
					window: context.window,
					percentUsed: 25,
					percentRemaining: 75,
					resetAt: null,
					resetText: null,
					raw: "25%",
				},
			],
		}),
	};
}

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

	it("allows command outputs that convert directly into skills", () => {
		const config: OmniagentConfig = {
			targets: [
				{
					id: "codex",
					inherits: "codex",
					outputs: {
						commands: {
							fallback: { mode: "convert", targetType: "skills" },
						},
					},
				},
			],
		};

		const validation = validateTargetConfig({ config, builtIns: BUILTIN_TARGETS });

		expect(validation.valid).toBe(true);
		expect(validation.errors).toEqual([]);
	});

	it("allows custom targets with valid structured output specs", () => {
		const config: OmniagentConfig = {
			targets: [
				{
					id: "custom-agent",
					cli: {
						modes: {
							interactive: { command: "custom" },
							oneShot: { command: "custom", args: ["run"] },
						},
						flags: {
							structuredOutput: {
								delivery: "file",
								flag: ["--schema"],
								companionArgs: ["--format", "json"],
								extraction: { type: "last-message-file", flag: ["--last-message"] },
							},
						},
					},
				},
			],
		};

		const validation = validateTargetConfig({ config, builtIns: BUILTIN_TARGETS });

		expect(validation.valid).toBe(true);
		expect(validation.errors).toEqual([]);
	});

	it("rejects invalid structured output specs", () => {
		const config: OmniagentConfig = {
			targets: [
				{
					id: "custom-agent",
					cli: {
						modes: {
							interactive: { command: "custom" },
							oneShot: { command: "custom" },
						},
						flags: {
							structuredOutput: {
								delivery: "socket",
								flag: [],
								extraction: { type: "telepathy" },
							},
						},
					},
				} as unknown as TargetDefinition,
			],
		};

		const validation = validateTargetConfig({ config, builtIns: BUILTIN_TARGETS });

		expect(validation.valid).toBe(false);
		expect(validation.errors).toEqual(
			expect.arrayContaining([
				'targets[0].cli.flags.structuredOutput.delivery must be "inline" or "file".',
				"targets[0].cli.flags.structuredOutput.flag must include at least one entry.",
				'targets[0].cli.flags.structuredOutput.extraction.type must be "json-envelope" or "last-message-file".',
			]),
		);
	});

	it("accepts custom structured output fallback specs", () => {
		const config: OmniagentConfig = {
			targets: [
				{
					id: "custom-agent",
					cli: {
						modes: {
							interactive: { command: "custom" },
							oneShot: { command: "custom" },
						},
						prompt: { type: "flag", flag: ["-p"] },
						flags: {
							structuredOutputFallback: {
								args: ["--quiet"],
								extraction: { type: "json-envelope", field: "response" },
							},
						},
					},
				},
			],
		};

		const validation = validateTargetConfig({ config, builtIns: BUILTIN_TARGETS });

		expect(validation.valid).toBe(true);
		expect(validation.errors).toEqual([]);
	});

	it("rejects invalid structured output fallback specs", () => {
		const config: OmniagentConfig = {
			targets: [
				{
					id: "custom-agent",
					cli: {
						modes: {
							interactive: { command: "custom" },
							oneShot: { command: "custom" },
						},
						flags: {
							structuredOutputFallback: {
								args: [42],
								extraction: { type: "telepathy" },
							},
						},
					},
				} as unknown as TargetDefinition,
			],
		};

		const validation = validateTargetConfig({ config, builtIns: BUILTIN_TARGETS });

		expect(validation.valid).toBe(false);
		expect(validation.errors).toEqual(
			expect.arrayContaining([
				"targets[0].cli.flags.structuredOutputFallback.args[0] must be a non-empty string.",
				'targets[0].cli.flags.structuredOutputFallback.extraction.type must be "text" or "json-envelope".',
			]),
		);
	});

	it("rejects json-envelope extraction without a field", () => {
		const config: OmniagentConfig = {
			targets: [
				{
					id: "custom-agent",
					cli: {
						modes: {
							interactive: { command: "custom" },
							oneShot: { command: "custom" },
						},
						flags: {
							structuredOutput: {
								delivery: "inline",
								flag: ["--schema"],
								extraction: { type: "json-envelope", field: " " },
							},
						},
					},
				} as unknown as TargetDefinition,
			],
		};

		const validation = validateTargetConfig({ config, builtIns: BUILTIN_TARGETS });

		expect(validation.valid).toBe(false);
		expect(validation.errors).toContain(
			"targets[0].cli.flags.structuredOutput.extraction.field must be a non-empty string.",
		);
	});

	it("allows custom usage extract functions", () => {
		const config: OmniagentConfig = {
			targets: [
				{
					id: "metered",
					usage: {
						windows: ["5h"],
						launch: {
							command: "metered",
							args: ["usage", "--json"],
							timeoutMs: 1_000,
							cheapModel: "small",
						},
						extract: async (context) => ({
							targetId: context.targetId,
							displayName: context.displayName,
							limits: [],
						}),
					},
				},
			],
		};

		const validation = validateTargetConfig({ config, builtIns: BUILTIN_TARGETS });

		expect(validation.valid).toBe(true);
		expect(validation.errors).toEqual([]);
	});

	it("rejects invalid usage definitions", () => {
		const config: OmniagentConfig = {
			targets: [
				{
					id: "metered",
					usage: {
						windows: [],
						launch: {
							args: ["usage", ""],
							timeoutMs: 0,
						},
						extract: "nope",
					},
				} as unknown as TargetDefinition,
			],
		};

		const validation = validateTargetConfig({ config, builtIns: BUILTIN_TARGETS });

		expect(validation.valid).toBe(false);
		expect(validation.errors).toEqual(
			expect.arrayContaining([
				"targets[0].usage.windows must include at least one entry.",
				"targets[0].usage.launch.args[1] must be a non-empty string.",
				"targets[0].usage.launch.timeoutMs must be a positive number when provided.",
				"targets[0].usage.extract must be a function.",
			]),
		);
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

	it("preserves inherited usage definitions", () => {
		const builtIns: TargetDefinition[] = [
			{
				id: "metered",
				displayName: "Metered",
				outputs: { skills: "{repoRoot}/.metered/skills/{itemName}" },
				usage: createUsage(["5h", "weekly"]),
			},
		];
		const config: OmniagentConfig = {
			targets: [
				{
					id: "acme",
					inherits: "metered",
					outputs: { instructions: "ACME.md" },
				},
			],
		};

		const resolved = resolveTargets({ config, builtIns });
		const acme = resolved.byId.get("acme");

		expect(acme?.usage).toBeDefined();
		expect(acme?.usage).not.toBe(builtIns[0].usage);
		expect(acme?.usage?.windows).toEqual(["5h", "weekly"]);
		expect(acme?.usage?.extract).toBe(builtIns[0].usage?.extract);
	});

	it("uses explicit usage overrides for inherited targets", () => {
		const inheritedUsage = createUsage(["5h"]);
		const customUsage = createUsage(["daily"]);
		const builtIns: TargetDefinition[] = [
			{
				id: "metered",
				displayName: "Metered",
				outputs: {},
				usage: inheritedUsage,
			},
		];
		const config: OmniagentConfig = {
			targets: [
				{
					id: "metered",
					inherits: "metered",
					usage: customUsage,
				},
			],
		};

		const resolved = resolveTargets({ config, builtIns });
		const metered = resolved.byId.get("metered");

		expect(metered?.usage).toBeDefined();
		expect(metered?.usage).not.toBe(customUsage);
		expect(metered?.usage?.windows).toEqual(["daily"]);
		expect(metered?.usage?.extract).toBe(customUsage.extract);
	});

	it("replaces usage for built-in overrides that do not inherit", () => {
		const builtIns: TargetDefinition[] = [
			{
				id: "metered",
				displayName: "Metered",
				outputs: {},
				usage: createUsage(["5h"]),
			},
		];
		const config: OmniagentConfig = {
			targets: [
				{
					id: "metered",
					outputs: {},
				},
			],
		};

		const resolved = resolveTargets({ config, builtIns });

		expect(resolved.byId.get("metered")?.usage).toBeUndefined();
	});
});
