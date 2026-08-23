# CLI Shim

Running `omniagent` without a subcommand enables shim mode.

## Basic usage

```bash
# Interactive session
omniagent --agent codex

# One-shot prompt
omniagent -p "Summarize the repo" --agent codex --output json

# Piped stdin
echo "Summarize the repo" | omniagent --agent codex

# Passthrough args to target CLI
omniagent --agent codex -- --some-agent-flag --model gpt-5
```

You can set `defaultAgent` in `agents/omniagent.config.*` to avoid repeating `--agent`.

## Shared flags

- `--approval <prompt|auto-edit|yolo>` (aliases: `--auto-edit`, `--yolo`)
- `--sandbox <workspace-write|off>`
- `--output <text|json|stream-json>` (aliases: `--json`, `--stream-json`)
- `--model <name>` / `-m` (see [Model aliases](#model-aliases))
- `--web <on|off|true|false|1|0>` (bare `--web` enables)
- `--effort <low|medium|high|xhigh|max>` / `-e` (reasoning effort; unset keeps the agent's own default)
- `--output-schema <path-or-json>` (JSON schema file path or inline JSON object; one-shot only)
- `--output-schema-retries <n>` (0-10, default 2; max retries for prompt-based fallback runs)

### Short forms

`-p` (prompt), `-a` (agent), `-m` (model), and `-e` (effort) are shorthand for their long forms, and
each accepts an attached value:

```bash
omniagent -p "Summarize this repo" -a codex -m sol -e xhigh
omniagent -phi -acodex -msol -exhigh          # attached form
```

`-a` is the shim's own flag, so it means `--agent` regardless of what the selected agent's CLI uses
`-a` for. Behind `--`, an agent's native `-a` keeps its own meaning (on codex it is
`--ask-for-approval`, which still conflicts with an explicit `--approval`).

## Model aliases

A target may declare nicknames for the model ids its CLI accepts, so `-m sol` resolves to the current
official id:

```bash
omniagent -p "Refactor this module" -a codex -m sol   # -> codex -m gpt-5.6-sol
```

Resolution rules:

- A value with no matching alias is forwarded **verbatim**, so an id the table has never heard of —
  including one released after the table was written — reaches the agent untouched.
- A value that *does* match is always rewritten, so an alias shadows a model whose official id is
  that exact string. Aliases are chosen to be unlikely ids, but if that ever collides, pass the id
  after `--` (`-a codex -- -m sol`) to bypass alias resolution entirely.
- Lookups are case-insensitive (`-m SOL` works).
- Aliases apply only to the shared `--model` flag. Behind `--`, values pass through untouched.
- `--trace-translate` shows the resolved id, which is how you confirm what an alias expanded to.

Aliases are per target, because a nickname only means something relative to one CLI's model list.
Each target declares its own table in its definition (`cli.flags.model.aliases`), and custom targets
can declare one the same way — see [custom targets](./custom-targets.md).

| Agent   | Aliases |
|---------|---------|
| codex   | `sol` -> `gpt-5.6-sol` |
| claude  | None needed - the claude CLI resolves `opus`/`sonnet`/`haiku`/`fable` itself, and the shim forwards them untouched. |
| agy     | None declared. |
| copilot | None declared. |

Updating an alias currently requires an omniagent release, since overriding a built-in target's
`cli` block in config replaces it wholesale rather than merging into it.

## Shared-flag capability matrix

| Agent   | Approval | Sandbox | Output | Model | Web | Effort        | Output schema |
|---------|----------|---------|--------|-------|-----|---------------|---------------|
| codex   | ✓        | ✓       | ✓      | ✓     | ✓   | ✓ (config)    | ✓ (native)    |
| claude  | ✓        | ✗       | ✓      | ✓     | ✗   | ✓             | ✓ (native)    |
| agy     | ✓        | ✓       | ✗      | ✓     | ✗   | ✓ (per-model) | ✓ (fallback)  |
| copilot | ✓        | ✗       | ✓      | ✓     | ✗   | ✓ (per-model) | ✓ (fallback)  |

`gemini` is accepted as an alias for `agy` (Antigravity CLI, Google's replacement for the
retired Gemini CLI). agy has no approval granularity beyond `--yolo`
(`--dangerously-skip-permissions`) and no JSON output mode; `--output json`/`--stream-json`
requests warn and are ignored.

## Reasoning effort

`--effort` is a shared ladder (`low`, `medium`, `high`, `xhigh`, `max`) that each agent maps onto
its own reasoning-effort surface:

```bash
# Same flag, four different native surfaces
omniagent --agent codex   -p "Refactor this module" --effort xhigh
omniagent --agent claude  -p "Refactor this module" --effort xhigh
omniagent --agent agy     -p "Refactor this module" --effort high
omniagent --agent copilot -p "Refactor this module" --effort high
```

| Agent   | Native surface                          | Notes |
|---------|-----------------------------------------|-------|
| codex   | `-c model_reasoning_effort="<level>"`   | No native flag; the level rides on a config override. Codex does not validate the value locally, so the shim rejects an unknown level before the agent starts. |
| claude  | `--effort <level>`                      | Same ladder, 1:1. |
| agy     | `--effort <level>`                      | agy resolves the level against the selected model's effort variants; a level the model does not expose is rejected by agy, not by the shim. |
| copilot | `--reasoning-effort <level>`            | Copilot validates the level against the selected model's advertised efforts. |

Unlike `--web`, effort has no default: with the flag absent the shim emits no effort arguments at
all, so `~/.codex/config.toml`, `~/.copilot/settings.json`, and each agent's persisted selection
keep applying.

## Structured output

`--output-schema` enforces a JSON-schema-shaped final response — the coding-agent equivalent
of API "structured outputs". The value is either a path to a `.json` schema file or an inline
JSON object (values starting with `{` are treated as inline).

```bash
# Inline schema
omniagent --agent claude -p "Top 3 TypeScript benefits" \
  --output-schema '{"type":"object","properties":{"answer":{"type":"array","items":{"type":"string"}}},"required":["answer"],"additionalProperties":false}' \
  | jq .answer

# Schema file — identical stdout contract on codex
omniagent --agent codex -p "Top 3 TypeScript benefits" --output-schema ./schema.json | jq .answer
```

The stdout contract is the same for every agent: stdout is exactly the schema-conforming JSON
(pipe it straight to `jq`). Agent-specific envelopes and session logs are handled by the shim:

- claude (native): the shim forces `--output-format json`, consumes the result envelope, and
  prints only its `structured_output` payload.
- codex (native): the shim passes the schema via a temp file plus `--output-last-message`,
  forwards the session log to stderr, and prints the final message to stdout.
- agy, copilot, custom targets (fallback): see below.

### Prompt-based fallback

Agents without native schema support automatically use a prompt-based fallback: the shim embeds
the schema in the prompt, captures the response, extracts the JSON (stripping prose or code
fences), and validates it client-side against the schema. If validation fails, the shim re-invokes
the agent with the previous output and the validation errors, up to `--output-schema-retries`
retries (default 2, so 3 attempts total). Each attempt is a fresh agent run and incurs its own
cost. A notice is written to stderr when the fallback engages:

```text
Notice: agy lacks native --output-schema support; using prompt-based fallback with client-side validation.
```

- agy: the shim reads the response text directly from stdout (agy has no JSON output mode).
- copilot: the shim adds `--silent` and reads the response text from stdout.
- Custom targets: declare `cli.flags.structuredOutputFallback` for clean capture, or get a plain
  text-mode fallback by default (see [`docs/custom-targets.md`](custom-targets.md)).

Rules:

- One-shot only — provide `-p/--prompt` or pipe stdin; interactive mode exits with code 2.
- Cannot be combined with explicit `--output`, `--json`, or `--stream-json` (exit code 2); the
  shim owns the output format for schema runs.
- Native runs (codex, claude) are not re-validated client-side (enforcement is delegated to the
  agent); `--output-schema-retries` is ignored with a warning.
- Fallback runs validate with ajv (`strict: false`); unknown schema keywords and `format` are not
  enforced. The validator dialect follows the schema's `$schema` declaration — draft 2020-12,
  draft 2019-09, and draft-07 (also the default when `$schema` is absent) are supported. Schemas
  that fail to compile exit with code 2 before the agent is spawned.
- The schema must be a JSON object.
- Failures exit with code 1 and write diagnostics to stderr: extraction failures (missing
  payload, error result, unparseable envelope) for native runs, and exhausted retries for
  fallback runs. Nonzero agent exits are passed through without retrying.
- A fallback target that defines no prompt mechanism cannot receive the schema and exits with
  code 2.

## Notes

- `--` passthrough is only valid after `--agent`.
- A passthrough effort override (for example `-c model_reasoning_effort=low` on codex) conflicts
  with an explicit `--effort` and exits with code 2; on its own it passes through untouched.
- Unsupported shared flags are ignored with a warning.
- Output is passed through unmodified, except for `--output-schema` runs (see above).
- For target-declared native options, an explicit passthrough value suppresses the corresponding
  shim default. This is silent in normal output and visible in `--trace-translate` through
  `shimArgs` and `passthroughArgs`.
- Passthrough cannot override an explicit shared flag, a policy derived from one (such as
  `--yolo` selecting its sandbox), prompt delivery, or structured-output arguments. These
  conflicts exit with code 2 before the target starts and identify both inputs.
- Undeclared native options and duplicates wholly within passthrough remain the target CLI's
  responsibility. Value-sensitive declarations keep repeatable flags such as
  `--disable <feature>` independent.
- Some approval values are agent-specific.
- Some output formats are one-shot only for specific CLIs.
- Copilot exposes JSONL via `--output-format json`, so `--output json` and `--output stream-json` both map to that flag in one-shot mode.
