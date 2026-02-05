# Data Model: CLI Shim Surface

## Entities

### Agent Config (`/Users/joeroddy/Documents/dev/projects/open-source/omniagent/agents/omniagent.config.*`)

Extends the existing agents directory configuration to include a default agent.

Fields:
- `defaultAgent`: `"claude" | "codex" | "gemini" | "copilot"` (optional).
- `targets`: `TargetDefinition[]` (optional; existing feature).
- `disableTargets`: `string[]` (optional; existing feature).
- `hooks`: `SyncHooks` (optional; existing feature).

Validation rules:
- If `defaultAgent` is provided, it must be one of the supported agent IDs.
- If no `defaultAgent` is set and `--agent` is omitted, the invocation is invalid.

Relationships:
- Agent Config 1 -> 0..1 Default Agent.

### Invocation

Represents a single CLI run and its resolved mode.

Fields:
- `mode`: `"interactive" | "one-shot"`.
- `prompt`: `string | null` (derived from `--prompt` or piped stdin).
- `stdinIsTTY`: `boolean`.
- `usesPipedStdin`: `boolean`.
- `flags`: `ShimFlags`.
- `agent`: `AgentSelection`.
- `passthrough`: `AgentPassthrough`.
- `session`: `SessionConfiguration`.

Validation rules:
- `mode` is `one-shot` if `--prompt` is set or `stdinIsTTY` is false.
- `prompt` uses `--prompt` when provided, otherwise piped stdin content.
- `--` is invalid without `--agent`.
- Unknown flags before `--` are invalid usage.

### ShimFlags

Canonical representation of the shim CLI options.

Fields:
- `prompt`: `string | null`.
- `approval`: `"prompt" | "auto-edit" | "yolo"`.
- `autoEdit`: `boolean` (alias for approval auto-edit).
- `yolo`: `boolean` (alias for approval yolo).
- `sandbox`: `"workspace-write" | "off"`.
- `output`: `"text" | "json" | "stream-json"`.
- `json`: `boolean` (alias for output json).
- `streamJson`: `boolean` (alias for output stream-json).
- `model`: `string | null`.
- `web`: `boolean`.
- `agent`: `"claude" | "codex" | "gemini" | "copilot" | null`.
- `help`: `boolean`.
- `version`: `boolean`.

Validation rules:
- `approval` values limited to `prompt|auto-edit|yolo`.
- `sandbox` values limited to `workspace-write|off`.
- `output` values limited to `text|json|stream-json`.
- `web` values limited to `on|off|true|false|1|0` (coerced to boolean).

### SessionConfiguration

Resolved shared settings applied to the invocation.

Fields:
- `approvalPolicy`: `"prompt" | "auto-edit" | "yolo"`.
- `sandbox`: `"workspace-write" | "off"`.
- `outputFormat`: `"text" | "json" | "stream-json"`.
- `model`: `string | null`.
- `webEnabled`: `boolean`.
- `sandboxExplicit`: `boolean` (derived).

Validation rules:
- `approvalPolicy` defaults to `prompt`.
- If `approvalPolicy` is `yolo` and `sandboxExplicit` is false, `sandbox` defaults to `off`.

### AgentSelection

Resolved agent choice for the invocation.

Fields:
- `id`: `"claude" | "codex" | "gemini" | "copilot"`.
- `source`: `"flag" | "config"`.
- `configPath`: `string | null` (path to `omniagent.config.*` when `source` is `config`).

Validation rules:
- `id` must be one of the supported agents.
- If `source` is `config`, `configPath` must be present.

### AgentPassthrough

Encapsulates the passthrough delimiter behavior.

Fields:
- `hasDelimiter`: `boolean`.
- `args`: `string[]` (verbatim arguments after `--`).

Validation rules:
- If `hasDelimiter` is true, `agent` must be set.
- Passthrough args are appended after shim-translated args.

### Output Envelope

Represents the agent-native output format that is passed through unchanged.

Fields:
- `format`: `"text" | "json" | "stream-json"`.
- `payload`: `string | stream` (opaque, agent-native).

Validation rules:
- The shim must not transform payload data for any format.

### ExitCode

Represents the process termination status.

Fields:
- `code`: `0 | 1 | 2 | 3`.
- `reason`: `"success" | "execution-error" | "invalid-usage" | "blocked"`.

State transitions:
- `success` when agent exits cleanly.
- `invalid-usage` when parsing/validation fails before execution.
- `blocked` when approval policy prevents execution.
- `execution-error` for runtime/agent failures.
