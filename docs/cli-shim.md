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

## Shared-flag capability matrix

| Agent   | Approval | Sandbox | Output | Model | Web | Output schema |
|---------|----------|---------|--------|-------|-----|---------------|
| codex   | ✓        | ✓       | ✓      | ✓     | ✓   | ✓             |
| claude  | ✓        | ✗       | ✓      | ✓     | ✗   | ✓             |
| gemini  | ✓        | ✓       | ✓      | ✓     | ✓   | ✗             |
| copilot | ✓        | ✗       | ✓      | ✓     | ✗   | ✗             |

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

The stdout contract is the same for every supporting agent: stdout is exactly the
schema-conforming JSON (pipe it straight to `jq`). Agent-specific envelopes and session logs
are handled by the shim:

- claude: the shim forces `--output-format json`, consumes the result envelope, and prints only
  its `structured_output` payload.
- codex: the shim passes the schema via a temp file plus `--output-last-message`, forwards the
  session log to stderr, and prints the final message to stdout.

Rules:

- One-shot only — provide `-p/--prompt` or pipe stdin; interactive mode exits with code 2.
- Cannot be combined with explicit `--output`, `--json`, or `--stream-json` (exit code 2); the
  shim owns the output format for schema runs.
- Agents without native schema support (gemini, copilot) fail fast with exit code 2 instead of
  the usual warn-and-ignore, because the output shape is a contract downstream scripts rely on.
- The schema must be a JSON object; the response is not re-validated client-side (enforcement is
  delegated to the agent).
- Extraction failures (missing payload, error result, unparseable envelope) exit with code 1 and
  write diagnostics to stderr.

## Notes

- `--` passthrough is only valid after `--agent`.
- Unsupported shared flags are ignored with a warning (except `--output-schema`, which errors).
- Output is passed through unmodified, except for `--output-schema` runs (see above).
- Passthrough args after `--` are not checked for collisions with shim-generated flags such as
  `--output-schema`; the agent CLI's own duplicate-flag error surfaces instead.
- Some approval values are agent-specific.
- Some output formats are one-shot only for specific CLIs.
- Copilot exposes JSONL via `--output-format json`, so `--output json` and `--output stream-json` both map to that flag in one-shot mode.
