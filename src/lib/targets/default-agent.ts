import { BUILTIN_TARGETS } from "./builtins.js";
import { loadTargetConfig } from "./config-loader.js";
import type { AgentId } from "./config-types.js";
import { validateTargetConfig } from "./config-validate.js";

export type DefaultAgentResolution =
	| {
			status: "resolved";
			id: AgentId;
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

	return {
		status: "resolved",
		id: defaultAgent,
		source: "config",
		configPath,
	};
}
