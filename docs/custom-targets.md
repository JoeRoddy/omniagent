# Custom Targets (Custom Agents)

Use custom targets when built-ins are not enough, or when you want to add a new agent runtime.

## Config file discovery

`sync` auto-discovers the first matching config in your agents directory:

- `omniagent.config.ts`
- `omniagent.config.mts`
- `omniagent.config.cts`
- `omniagent.config.js`
- `omniagent.config.mjs`
- `omniagent.config.cjs`

## Example

```ts
const config = {
	targets: [
		{
			id: "acme",
			displayName: "Acme Agent",
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
	disableTargets: ["copilot"],
};

export default config;
```

## Rules and behavior

- Built-in target IDs require `override: true` or `inherits: "claude"` to avoid collisions.
- `disableTargets` removes built-ins from the active target set.
- Placeholders:
  - `{repoRoot}`, `{homeDir}`, `{agentsDir}`
  - `{targetId}`, `{itemName}`, `{commandLocation}`
- If multiple targets resolve to the same file, default writers handle
  skills/subagents/instructions, but command collisions are errors.

## Usage extraction

Custom target configs can define `usage` when the agent exposes usage or limit information.
The `usage.extract` function returns normalized percent-limit rows that `omniagent usage`
can render in the table or JSON envelope.

```ts
const config = {
	targets: [
		{
			id: "metered",
			displayName: "Metered Agent",
			usage: {
				windows: ["5h", "weekly"],
				launch: {
					command: "metered",
					args: ["usage", "--json"],
					timeoutMs: 60_000,
					cheapModel: "small",
				},
				extract: async (context) => ({
					targetId: context.targetId,
					displayName: context.displayName,
					command: context.command,
					limits: [
						{
							id: "metered-weekly",
							targetId: context.targetId,
							agent: context.displayName,
							window: "weekly",
							percentUsed: 40,
							percentRemaining: 60,
							resetAt: null,
							resetText: "Monday",
							raw: "40% weekly usage",
						},
					],
				}),
			},
		},
	],
};

export default config;
```

`omniagent usage` enforces a 30-second per-target timeout by default. A user-supplied
`--timeout` value overrides `context.launch.timeoutMs` for that run, so custom extractors
should pass `context.launch.timeoutMs` through to any child-process or TUI probe they start.

Built-in usage extraction is available for Codex, Claude, and Gemini in v1. Copilot is not
supported for usage extraction in v1.

## Related docs

- Core sync behavior: [`docs/sync-basics.md`](sync-basics.md)
- Full flag list: [`docs/reference.md`](reference.md)

## Target implementation references

For examples and implementation reference, see [`/src/lib/targets/builtins/`](../src/lib/targets/builtins/):

- [Claude Code](../src/lib/targets/builtins/claude-code/target.ts)
- [Codex](../src/lib/targets/builtins/codex/target.ts)
- [Copilot](../src/lib/targets/builtins/copilot-cli/target.ts)
- [Gemini](../src/lib/targets/builtins/gemini-cli/target.ts)
