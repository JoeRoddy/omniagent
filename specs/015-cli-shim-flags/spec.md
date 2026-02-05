# Feature Specification: CLI Shim Surface

**Feature Branch**: `015-cli-shim-flags`  
**Created**: 2026-01-23  
**Status**: Draft  
**Input**: User description: "Define the initial CLI shim surface with shared flags for interactive and one-shot modes, including approval policy, sandboxing, output format, model selection, and web search enablement. - Support interactive REPL and one-shot prompts with shared flags. - Provide approval policy controls suitable for automation. - Provide output formats for scripting. - Allow model selection via `--model`. - Allow enabling web search via a flag. - Allow a pass through mechanism / proxy mechanism to pass arbitrary args through to the agent cli - Agent-specific advanced flags (session forks, MCP config, etc.). - Persisted config files (can be added later). - `omniagent` -> interactive REPL (default). - `-p, --prompt <text>` -> one-shot (non-interactive). - stdin piped -> one-shot (acts like `--prompt`). - `--approval <prompt|auto-edit|yolo>` (default: `prompt`) - `--auto-edit` (alias for `--approval auto-edit`) - `--yolo` (alias for `--approval yolo`) - If `--yolo` is set and `--sandbox` is not explicitly provided, sandbox defaults to `off`. - `--sandbox <workspace-write|off>` (default: `workspace-write`) - `--output <text|json|stream-json>` (default: `text`) - `--json` (alias for `--output json`) - `--stream-json` (alias for `--output stream-json`) - `-m, --model <name>` (selects model) - `--web <on|off|true|false|1|0>` (enable web search; default: `off`; bare `--web` equals `--web=on`) - `--help`, `--version` - Support delimiter-based passthrough for agent CLI flags. - Syntax: `omniagent [shim flags] --agent <claude|codex|gemini|copilot> -- [agent flags...]` - Everything after `--` is passed verbatim to the agent CLI. - Unknown flags before `--` should error (no silent passthrough). - Shim flags always parse before `--`, are converted into agent flags, and are placed before passthrough (no conflict handling). Example: `omniagent -p … --agent codex -- --some-agent-flag --model gpt-5` - 0 success - 1 execution error (tool/model failure) - 2 invalid usage - 3 blocked by approval policy - `--prompt` and piped stdin must always run non-interactively. - Shared flags must be accepted in both modes (interactive + one-shot); unsupported flags warn and no-op. - `--yolo` should not automatically disable the sandbox if `--sandbox` is explicitly set. - `--web` only enables access; the agent may still choose not to use it. - CLI parsing accepts the flags exactly as specified above. - One-shot and interactive modes both honor shared flags when supported; unsupported flags warn and no-op. - `--yolo` defaults sandbox to `off` unless user explicitly sets `--sandbox`. - `--model` and `--web` are plumbed through the runtime configuration. - Output format flags render correct output or structured JSON modes when supported by the selected agent; otherwise warn and pass through agent output."

## Clarifications

### Session 2026-01-23

- Q: Should `--agent` be allowed without `--` to select the agent (no passthrough), with `--` only required when passing agent flags? → A: Yes—use `--agent` (renamed from `--vendor`) without `--` in both interactive and one-shot modes; `--` is only for passthrough.
- Q: Should the shim pass through all agent outputs unmodified (including `json` and `stream-json`)? → A: Yes—pass through all agent output without modification.
- Q: When constructing the agent command, what order should we use? → A: Shim-translated flags first, then passthrough; no conflict handling; agent decides precedence.
- Q: Should there be an `exec` subcommand for one-shot mode? → A: No—remove `exec`; one-shot is only via `--prompt`/`-p` or piped stdin.
- Q: When `--agent` is omitted, what should the shim do? → A: Use the default agent from the existing config file inside `<agentsDir>` if present; otherwise invalid usage.
- Q: How should the shim handle shared flags that are unsupported by the selected agent? → A: Accept the flag, emit a warning, and continue without applying it; document per-agent capabilities in help/docs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start interactive REPL with shared flags (Priority: P1)

As a user, I want `omniagent` to start an interactive session by default so I can chat iteratively, while still using the same flags that are available in one-shot mode.

**Why this priority**: This is the default entry point and must work reliably for all users.

**Independent Test**: Can be fully tested by launching `omniagent` with shared flags and confirming the session starts in interactive mode with the expected configuration.

**Acceptance Scenarios**:

1. **Given** a terminal with no piped stdin and no `--prompt`, **When** the user runs `omniagent`, **Then** the system starts an interactive session and uses default flag values.
2. **Given** a terminal with no piped stdin, **When** the user runs `omniagent --model <name> --output json --approval prompt`, **Then** the session starts interactively and those shared flags are applied.

---

### User Story 2 - Run a one-shot prompt reliably (Priority: P2)

As a user or automation script, I want a non-interactive one-shot mode driven by `--prompt` or stdin so I can run a single request without entering the REPL.

**Why this priority**: One-shot execution enables scripting and automation workflows.

**Independent Test**: Can be fully tested by running one-shot invocations with `--prompt` and piped stdin, and verifying outputs and exit codes.

**Acceptance Scenarios**:

1. **Given** a `--prompt` value, **When** the user runs `omniagent -p "..."`, **Then** the system runs one-shot mode and exits without entering interactive mode.
2. **Given** stdin is piped and `--prompt` is not provided, **When** the user runs `omniagent`, **Then** the system treats piped stdin as the prompt and runs one-shot mode.

---

### User Story 3 - Pass agent-specific flags through safely (Priority: P3)

As a user integrating with an agent CLI, I want to pass agent-specific flags through the shim without the shim silently accepting unknown flags, so I can use advanced agent options while keeping the shim reliable.

**Why this priority**: Agent passthrough is required to access advanced agent features without expanding the shim surface.

**Independent Test**: Can be fully tested by invoking the shim with `--agent ... -- [agent flags]` and verifying that only post-`--` flags are passed through.

**Acceptance Scenarios**:

1. **Given** an agent selection without a passthrough delimiter, **When** the user runs `omniagent --agent codex`, **Then** the shim selects the agent and proceeds without passthrough.
2. **Given** an agent selection and a passthrough delimiter, **When** the user runs `omniagent --agent codex -- --some-agent-flag`, **Then** the shim accepts the invocation and passes the agent flags through verbatim.
3. **Given** an unknown flag before the passthrough delimiter, **When** the user runs `omniagent --unknown-flag --agent codex -- --some-agent-flag`, **Then** the system rejects the invocation with an invalid-usage exit code.

---

### Edge Cases

- `--yolo` is set while `--sandbox` is explicitly provided: sandbox remains the explicitly provided value.
- `--web` is provided with an unsupported value: invocation fails with invalid-usage exit code.
- `--model` is used with an agent that cannot select models: warn and continue without applying the model.
- `--web` is used with an agent that has no web capability: warn and continue without enabling web access.
- `--output json`/`--output stream-json` is used with an agent or mode that doesn't support it: warn and continue with agent-default output.
- `--sandbox` is used with an agent that doesn't expose sandbox controls: warn and continue without applying sandbox settings.
- `--` is used without `--agent`: invocation fails with invalid-usage exit code.
- Both `--prompt` and piped stdin are present: the explicit `--prompt` is used.
- Conflicting output flags (e.g., `--output text` and `--json`) are both provided: the last-specified output flag wins.
- `--agent` is omitted and no default is configured in `<agentsDir>`: invocation fails with invalid-usage exit code.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The default invocation `omniagent` MUST start an interactive REPL when stdin is a TTY and no one-shot trigger is present.
- **FR-002**: The system MUST run non-interactively when `--prompt` is provided or when stdin is piped.
- **FR-003**: Shared flags MUST be accepted in both interactive and one-shot modes; if supported by the selected agent, they MUST be applied to the session configuration. If unsupported, they MUST be ignored with a warning.
- **FR-004**: The `--approval` flag MUST accept `prompt`, `auto-edit`, and `yolo`, and default to `prompt`.
- **FR-005**: `--auto-edit` MUST behave as `--approval auto-edit`, and `--yolo` MUST behave as `--approval yolo`.
- **FR-006**: If `--yolo` is set and `--sandbox` is not explicitly provided, sandbox MUST default to `off`.
- **FR-007**: If `--sandbox` is explicitly provided, `--yolo` MUST NOT override it.
- **FR-008**: The `--sandbox` flag MUST accept `workspace-write` and `off`, and default to `workspace-write` unless overridden by FR-006. If the selected agent does not support sandbox controls, the shim MUST warn and ignore `--sandbox`.
- **FR-009**: The `--output` flag MUST accept `text`, `json`, and `stream-json`, and default to `text`. If the requested format is unsupported by the selected agent or mode, the shim MUST warn and proceed with the agent-default output.
- **FR-010**: `--json` MUST behave as `--output json`, and `--stream-json` MUST behave as `--output stream-json`.
- **FR-011**: The `--model` flag MUST select the model for the session configuration when supported by the selected agent; if unsupported, the shim MUST warn and ignore `--model`.
- **FR-012**: The `--web` flag MUST accept `on`, `off`, `true`, `false`, `1`, and `0`, default to `off`, and treat bare `--web` as `on`. If the selected agent does not support web access, the shim MUST warn and ignore `--web`.
- **FR-013**: Enabling `--web` MUST only grant permission for web search; the agent MAY still choose not to use it. If the agent lacks web support, the shim MUST treat `--web` as a no-op with a warning.
- **FR-014**: `--help` and `--version` MUST display their information and exit successfully without starting a session.
- **FR-015**: The shim MUST support agent selection via `--agent <claude|codex|gemini|copilot>` in both interactive and one-shot modes.
- **FR-016**: If `--agent` is provided without `--`, the shim MUST select the agent and proceed without passthrough.
- **FR-017**: The shim MUST support delimiter-based passthrough using `--agent <claude|codex|gemini|copilot> -- [agent flags...]`.
- **FR-018**: All arguments after `--` MUST be passed to the agent CLI verbatim and MAY include advanced agent flags.
- **FR-019**: Unknown flags before `--` MUST cause invalid usage; no silent passthrough is allowed.
- **FR-020**: Shim flags MUST be parsed before the passthrough delimiter and translated into agent flags; when invoking the agent, shim-translated flags MUST appear before passthrough flags, with no conflict handling (agent decides precedence).
- **FR-021**: Using `--` without `--agent` MUST be treated as invalid usage.
- **FR-022**: When invoking an agent, the shim MUST pass through agent output unmodified for every `--output` mode (including `json` and `stream-json`) and MUST NOT wrap or reformat it. If the requested output mode is unsupported, the shim MUST warn and still pass through the agent output unmodified.
- **FR-023**: Exit codes MUST be: `0` success, `1` execution error, `2` invalid usage, `3` blocked by approval policy.
- **FR-024**: If `--agent` is omitted, the shim MUST read the default agent from the existing config file inside `<agentsDir>`; if no default is configured, it MUST return invalid usage.
- **FR-025**: The shim MUST define a per-agent capability matrix for model selection, web access, output formats, approval policy, and sandboxing, and MUST use it to determine flag translation, closest-value mapping, and warning behavior.
- **FR-026**: When a shared flag is unsupported by the selected agent, the shim MUST emit a warning to stderr and continue without changing the exit code.
- **FR-027**: CLI help and documentation MUST disclose per-agent capability differences and the warning/no-op behavior for unsupported flags.

### Key Entities *(include if feature involves data)*

- **Invocation**: A single CLI run including mode (interactive/one-shot), shared flags, and input source.
- **Session Configuration**: The resolved set of shared settings (approval, sandbox, output, model, web permission) applied to a run.
- **Agent Passthrough**: The agent selection plus any arguments supplied after `--` that are forwarded verbatim.
- **Output Envelope**: The agent-native output selected by `--output`, passed through by the shim without modification.
- **Agent Config**: The existing config file inside `<agentsDir>` that may define a default agent.
- **Capability Matrix**: The per-agent support map for shared flags used to translate or ignore requests with warnings.

## Assumptions

- If multiple output-related flags are provided, the last occurrence determines the effective output format.
- One-shot mode is only triggered by `--prompt`/`-p` or piped stdin; there is no `exec` subcommand.
- If `--agent` is omitted and a default exists in the config file inside `<agentsDir>`, the shim uses it; otherwise the invocation is invalid.
- Unsupported shared flags are treated as no-ops with warnings; the shim still executes the selected agent.
- Persisted configuration beyond the default agent option is out of scope for this feature and may be introduced later.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can start an interactive session with the default command in under 2 seconds on a standard workstation.
- **SC-002**: 100% of valid flag combinations in automated tests produce the expected mode (interactive vs one-shot), output format, and exit code.
- **SC-003**: 100% of invalid-usage scenarios (unknown flags, invalid values, missing `--agent` with `--`, missing default when `--agent` is omitted) return exit code `2` with a clear error message.
- **SC-004**: Automation workflows using `--approval auto-edit` or `--approval yolo` run without manual approval prompts in 100% of tests.
- **SC-005**: Supplying a shared flag unsupported by the selected agent produces a warning and still executes with exit code `0` or the agent-provided exit code.
