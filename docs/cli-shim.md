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

## Shared-flag capability matrix

| Agent   | Approval | Sandbox | Output | Model | Web |
|---------|----------|---------|--------|-------|-----|
| codex   | ✓        | ✓       | ✓      | ✓     | ✓   |
| claude  | ✓        | ✗       | ✓      | ✓     | ✗   |
| gemini  | ✓        | ✓       | ✓      | ✓     | ✓   |
| copilot | ✓        | ✗       | ✗      | ✓     | ✗   |

## Notes

- `--` passthrough is only valid after `--agent`.
- Unsupported shared flags are ignored with a warning.
- Output is passed through unmodified.
- Some approval values are agent-specific.
- Some output formats are one-shot only for specific CLIs.
