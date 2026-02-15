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

## Related docs

- Core sync behavior: [`docs/sync-basics.md`](sync-basics.md)
- Full flag list: [`docs/reference.md`](reference.md)

## Target implementation references

For examples and implementation reference, see [`/src/lib/targets/builtins/`](../src/lib/targets/builtins/):

- [Claude Code](../src/lib/targets/builtins/claude-code/target.ts)
- [Codex](../src/lib/targets/builtins/codex/target.ts)
- [Copilot](../src/lib/targets/builtins/copilot-cli/target.ts)
- [Gemini](../src/lib/targets/builtins/gemini-cli/target.ts)
