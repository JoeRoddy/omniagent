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
- `--model <name>`
- `--web <on|off|true|false|1|0>` (bare `--web` enables)
- `--output-schema <path-or-json>` (JSON schema file path or inline JSON object; one-shot only)
- `--output-schema-retries <n>` (0-10, default 2; max retries for prompt-based fallback runs)

## Shared-flag capability matrix

| Agent   | Approval | Sandbox | Output | Model | Web | Output schema |
|---------|----------|---------|--------|-------|-----|---------------|
| codex   | ✓        | ✓       | ✓      | ✓     | ✓   | ✓ (native)    |
| claude  | ✓        | ✗       | ✓      | ✓     | ✗   | ✓ (native)    |
| gemini  | ✓        | ✓       | ✓      | ✓     | ✓   | ✓ (fallback)  |
| copilot | ✓        | ✗       | ✓      | ✓     | ✗   | ✓ (fallback)  |

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
- gemini, copilot, custom targets (fallback): see below.

### Prompt-based fallback

Agents without native schema support automatically use a prompt-based fallback: the shim embeds
the schema in the prompt, captures the response, extracts the JSON (stripping prose or code
fences), and validates it client-side against the schema. If validation fails, the shim re-invokes
the agent with the previous output and the validation errors, up to `--output-schema-retries`
retries (default 2, so 3 attempts total). Each attempt is a fresh agent run and incurs its own
cost. A notice is written to stderr when the fallback engages:

```text
Notice: gemini lacks native --output-schema support; using prompt-based fallback with client-side validation.
```

- gemini: the shim adds `--output-format json` and reads the model text from the envelope's
  `response` field.
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
  enforced. Schemas that fail to compile exit with code 2 before the agent is spawned.
- The schema must be a JSON object.
- Failures exit with code 1 and write diagnostics to stderr: extraction failures (missing
  payload, error result, unparseable envelope) for native runs, and exhausted retries for
  fallback runs. Nonzero agent exits are passed through without retrying.
- A fallback target that defines no prompt mechanism cannot receive the schema and exits with
  code 2.

## Notes

- `--` passthrough is only valid after `--agent`.
- Unsupported shared flags are ignored with a warning.
- Output is passed through unmodified, except for `--output-schema` runs (see above).
- Passthrough args after `--` are not checked for collisions with shim-generated flags such as
  `--output-schema` or fallback-injected flags (gemini's `--output-format json`, copilot's
  `--silent`); the agent CLI's own duplicate-flag error surfaces instead.
- Some approval values are agent-specific.
- Some output formats are one-shot only for specific CLIs.
- Copilot exposes JSONL via `--output-format json`, so `--output json` and `--output stream-json` both map to that flag in one-shot mode.
