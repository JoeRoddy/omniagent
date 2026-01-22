import { stat } from "node:fs/promises";
import path from "node:path";
import { resolveAgentsDirPath } from "../agents-dir.js";
import type { OmniagentConfig } from "./config-types.js";

const CONFIG_FILES = [
	"omniagent.config.ts",
	"omniagent.config.mts",
	"omniagent.config.cts",
	"omniagent.config.js",
	"omniagent.config.mjs",
	"omniagent.config.cjs",
] as const;

async function fileExists(filePath: string): Promise<boolean> {
	try {
		const stats = await stat(filePath);
		return stats.isFile();
	} catch {
		return false;
	}
}

export async function findTargetConfigPath(options: {
	repoRoot: string;
	agentsDir?: string | null;
}): Promise<string | null> {
	const agentsDir = resolveAgentsDirPath(options.repoRoot, options.agentsDir);
	for (const fileName of CONFIG_FILES) {
		const candidate = path.join(agentsDir, fileName);
		if (await fileExists(candidate)) {
			return candidate;
		}
	}
	return null;
}

function resolveConfigExport(moduleValue: unknown): unknown {
	if (moduleValue && typeof moduleValue === "object" && "default" in moduleValue) {
		return (moduleValue as { default?: unknown }).default ?? moduleValue;
	}
	return moduleValue;
}

export async function loadTargetConfig(options: {
	repoRoot: string;
	agentsDir?: string | null;
}): Promise<{ config: OmniagentConfig | null; configPath: string | null }> {
	const configPath = await findTargetConfigPath(options);
	if (!configPath) {
		return { config: null, configPath: null };
	}

	const mod = await import("jiti");
	const createJiti = mod.createJiti ?? mod.default;
	if (!createJiti) {
		throw new Error("Failed to initialize config loader.");
	}
	const jiti = createJiti(import.meta.url, { interopDefault: true });
	const loaded = await jiti(configPath);
	const resolved = resolveConfigExport(loaded);
	return {
		config: (resolved ?? null) as OmniagentConfig | null,
		configPath,
	};
}
