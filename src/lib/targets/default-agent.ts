import { BUILTIN_TARGETS } from "./builtins.js";
import { loadTargetConfig } from "./config-loader.js";
import { validateTargetConfig } from "./config-validate.js";
import { resolveTargets } from "./resolve-targets.js";

export type DefaultAgentResolution =
	| {
			status: "resolved";
			id: string;
			source: "config";
			configPath: string;
	  }
	| {
			status: "missing";
			configPath: string | null;
	  }
	| {
			status: "invalid";
			configPath: string | null;
			errors: string[];
	  };

export async function resolveDefaultAgent(options: {
	repoRoot: string;
	agentsDir?: string | null;
}): Promise<DefaultAgentResolution> {
	const { config, configPath } = await loadTargetConfig(options);
	if (!config || !configPath) {
		return { status: "missing", configPath: configPath ?? null };
	}

	const validation = validateTargetConfig({ config, builtIns: BUILTIN_TARGETS });
	if (!validation.valid || !validation.config) {
		return {
			status: "invalid",
			configPath,
			errors: validation.errors,
		};
	}

	const defaultAgent = validation.config.defaultAgent;
	if (!defaultAgent) {
		return { status: "missing", configPath };
	}

	const resolved = resolveTargets({ config: validation.config, builtIns: BUILTIN_TARGETS });
	const key = defaultAgent.trim().toLowerCase();
	const resolvedId = resolved.aliasToId.get(key);
	if (!resolvedId) {
		return {
			status: "invalid",
			configPath,
			errors: [`defaultAgent must match a configured target or alias (${defaultAgent}).`],
		};
	}

	return {
		status: "resolved",
		id: resolvedId,
		source: "config",
		configPath,
	};
}
