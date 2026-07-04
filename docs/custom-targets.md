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

## Structured output (`cli.flags.structuredOutput`)

Custom targets whose CLI supports schema-constrained responses can declare a
`structuredOutput` spec so the shim's `--output-schema` flag works for them:

```ts
const config = {
	targets: [
		{
			id: "acme",
			cli: {
				modes: {
					interactive: { command: "acme" },
					oneShot: { command: "acme", args: ["run"] },
				},
				flags: {
					structuredOutput: {
						// "inline": schema JSON is passed as the flag value.
						// "file": schema is written to a temp file and its path is passed.
						delivery: "file",
						flag: ["--schema"],
						// Extra args always added alongside the schema (e.g. forcing JSON output).
						companionArgs: ["--format", "json"],
						// How the shim extracts the final payload:
						// { type: "json-envelope", field: "structured_output" } parses captured
						// stdout as JSON and prints only that field, or
						// { type: "last-message-file", flag: ["--last-message"] } passes a temp
						// file path via the given flag and prints its contents after the run.
						extraction: { type: "last-message-file", flag: ["--last-message"] },
					},
				},
			},
		},
	],
};
```

Targets inheriting a built-in (`inherits: "codex"` or `inherits: "claude"`) get the built-in's
spec automatically. Targets that define a custom `cli.translate` function receive the resolved
plan as `invocation.structuredOutput` and must append `invocation.structuredOutput.args`
themselves; the default translator does this automatically.

## Structured output fallback (`cli.flags.structuredOutputFallback`)

Targets without a native `structuredOutput` spec automatically use the shim's prompt-based
fallback for `--output-schema`: the schema is embedded in the prompt, the response is captured
and validated client-side, and failed attempts are retried with feedback (up to
`--output-schema-retries`, default 2). The target must define `cli.prompt`; a target with no
prompt mechanism exits with code 2 for schema runs.

By default the fallback captures the agent's raw stdout as text. Declare a
`structuredOutputFallback` spec to add one-shot args for clean capture or to unwrap a JSON
envelope first:

```ts
const config = {
	targets: [
		{
			id: "acme",
			cli: {
				modes: {
					interactive: { command: "acme" },
					oneShot: { command: "acme", args: ["run"] },
				},
				prompt: { type: "flag", flag: ["-p"] },
				flags: {
					structuredOutputFallback: {
						// Extra one-shot args that keep stdout parseable (quiet/log flags etc.).
						args: ["--quiet"],
						// "text" (default): stdout is the response text.
						// "json-envelope": stdout is JSON; the response text is read from `field`.
						extraction: { type: "text" },
					},
				},
			},
		},
	],
};
```

The built-in agy target uses `{ extraction: { type: "text" } }` (no extra args); copilot uses
`{ args: ["--silent"], extraction: { type: "text" } }`. A `json-envelope` extraction remains
available for CLIs that wrap responses in a JSON envelope: `{ args: ["--output-format", "json"],
extraction: { type: "json-envelope", field: "response" } }`. Targets with a custom `cli.translate` function receive fallback plans as
`invocation.structuredOutput` too — append `invocation.structuredOutput.args` yourself, and note
the prompt passed to `translate` is already augmented with the schema instructions on each
attempt.

`omniagent usage` enforces a 30-second per-target timeout unless `usage.launch.timeoutMs` is
configured. A user-supplied `--timeout` value overrides `context.launch.timeoutMs` for that run,
so custom extractors should pass `context.launch.timeoutMs` through to any child-process or TUI
probe they start.
`launch.command` is optional; omit it when an extractor reads usage from another source such as
a local file, SDK, or API. When provided, launch commands are executed directly, so only use
trusted binaries.

Built-in usage extraction is available for Codex, Claude, and Antigravity (agy). Copilot is
not supported for usage extraction in v1.

## Related docs

- Core sync behavior: [`docs/sync-basics.md`](sync-basics.md)
- Full flag list: [`docs/reference.md`](reference.md)

## Target implementation references

For examples and implementation reference, see [`/src/lib/targets/builtins/`](../src/lib/targets/builtins/):

- [Claude Code](../src/lib/targets/builtins/claude-code/target.ts)
- [Codex](../src/lib/targets/builtins/codex/target.ts)
- [Copilot](../src/lib/targets/builtins/copilot-cli/target.ts)
- [Antigravity](../src/lib/targets/builtins/antigravity-cli/target.ts)

## Legacy Gemini CLI

The built-in `gemini` target was replaced by `agy` (Antigravity CLI) after Google retired
Gemini CLI for individual accounts in June 2026; `gemini` now resolves as an alias of `agy`
everywhere a target name is accepted. Enterprise users who still run the legacy Gemini CLI can
re-create it as a custom target using the definition shape above (`.gemini/skills/`,
`.gemini/commands/*.toml`, `GEMINI.md`, and a `gemini` binary with `--approval-mode`/
`--output-format` flags). Note the id `gemini` itself now collides with agy's alias and is
rejected by validation — pick a distinct id such as `gemini-legacy`.
