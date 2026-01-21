# Quickstart: Custom Agent Targets

## 1) Create the config file

Create a config in the agents directory (first match wins by extension order).

Example path:
- `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/agents/omniagent.config.ts`

## 2) Define a minimal custom target

```ts
import type { OmniagentConfig } from "../src/lib/targets/config-types.js";

const config: OmniagentConfig = {
	targets: [
		{
			id: "acme",
			displayName: "Acme Agent",
			aliases: ["acme-ai"],
			outputs: {
				skills: "{repoRoot}/.acme/skills/{itemName}",
				subagents: "{repoRoot}/.acme/agents/{itemName}.md",
				commands: {
					projectPath: "{repoRoot}/.acme/commands/{itemName}.md",
					userPath: "{homeDir}/.acme/commands/{itemName}.md",
				},
				instructions: "AGENTS.md",
			},
		},
	],
};

export default config;
```

Notes:
- `skills`, `subagents`, and `commands` treat the value as a full path template.
- `instructions` treats the value as a filename, combined with each source output directory.
- Placeholders must be known and resolvable: `{repoRoot}`, `{homeDir}`, `{agentsDir}`,
  `{targetId}`, `{itemName}`, `{commandLocation}`.

## 3) Override or disable built-ins

```ts
const config: OmniagentConfig = {
	disableTargets: ["copilot"],
	targets: [
		{
			id: "codex",
			override: true,
			outputs: {
				instructions: "AGENTS.codex.md",
			},
		},
	],
};

export default config;
```

## 4) Run sync

From the repo root:

```bash
omniagent sync
```

The CLI auto-discovers the config in
`/Users/joeroddy/Documents/dev/projects/open-source/omniagent/agents/` and merges
custom targets with built-ins. If the config is invalid, the command exits non-zero and
writes no outputs.
