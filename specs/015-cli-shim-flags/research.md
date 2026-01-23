# Research: CLI Shim Surface

## CLI mode resolution (interactive vs one-shot)

- Decision: Treat the run as one-shot when `--prompt`/`-p` is provided or when stdin is not a
  TTY; prompt is `--prompt` if set, otherwise the piped stdin contents.
- Rationale: Matches FR-002 and the edge-case rule that `--prompt` wins over piped stdin.
- Alternatives considered: Require `--prompt` for one-shot (rejects stdin-driven automation),
  prefer stdin over `--prompt` (contradicts spec).

## Shim flag parsing + passthrough delimiter

- Decision: Use yargs strict parsing for shim flags and enable `populate--` to capture arguments
  after `--` for passthrough. Enforce that `--` requires `--agent` and treat unknown pre-`--`
  flags as invalid usage.
- Rationale: Preserves verbatim agent flags while keeping shim surface explicit and validated
  (FR-017 to FR-021).
- Alternatives considered: Accept unknown flags implicitly (violates FR-019), stop parsing at the
  first non-option (breaks shared flags ordering).

## Default agent discovery

- Decision: Extend the existing config file in
  `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/agents/omniagent.config.*` with a
  `defaultAgent` string (`claude|codex|gemini|copilot`) and load it via
  `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/targets/config-loader.ts`.
- Rationale: Reuses the agents directory config discovery path already in place and avoids new
  config locations or formats.
- Alternatives considered: New standalone config file (adds another discovery path), hardcoded
  default agent (conflicts with spec).

## Approval + sandbox defaults

- Decision: `--yolo` maps to `--approval yolo`, and if `--sandbox` is not explicitly provided,
  sandbox defaults to `off`; explicit `--sandbox` always wins.
- Rationale: Required by FR-005 to FR-007 and the defined edge cases.
- Alternatives considered: Always force sandbox `off` when `--yolo` is set (violates FR-007).

## Output + web flag normalization

- Decision: Resolve output format by last-specified `--output/--json/--stream-json`; parse `--web`
  values (`on|off|true|false|1|0`) into a boolean and treat bare `--web` as `on`.
- Rationale: Matches FR-009 to FR-013 and the edge-case list.
- Alternatives considered: Fail on mixed output flags (spec says last wins), accept arbitrary
  truthy/falsey strings (would allow unsupported values).

## Agent execution + output passthrough

- Decision: Spawn the selected agent CLI with shim-translated flags placed before passthrough
  args and use `stdio: "inherit"` to pass output through unmodified in all output modes.
- Rationale: Satisfies FR-020 and FR-022 while keeping output fidelity for `json` and
  `stream-json`.
- Alternatives considered: Buffering and re-emitting output (risks formatting changes), merging
  shim and passthrough flags with conflict resolution (explicitly disallowed).
