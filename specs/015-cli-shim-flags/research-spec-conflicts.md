# Research vs Spec Conflicts: 015-cli-shim-flags

## What I did

Reviewed the 015 spec, plan, and tasks against the CLI research notes in
`research/cli-surfaces/major-clis-initial-dr.md` and
`research/cli-surfaces/major-clis-followup-shared-schemas.md`, then identified
mismatches between the proposed shared shim flags and the actual agent CLI
surfaces described in the research.
Discussed each conflict with the user and recorded the agreed resolutions.

## Conflicts

- **Model selection is not universal**: The spec requires a shared `--model`
  flag (FR-011). Earlier research stated Copilot CLI did not allow model
  selection via a flag. Update (2026-01-28): Copilot CLI now supports `--model`,
  so this conflict is resolved for Copilot.
- **Web access flag is not universal**: The spec defines `--web` to enable web
  search; research says Claude Code and Copilot CLI have no native web search,
  Codex uses `--search` (not `--web`), and Gemini’s web access is tool-enabled
  without a documented `--web` flag. A single shared `--web` flag conflicts with
  per-agent reality.
- **Output formats don’t align across agents**: The spec mandates
  `--output text|json|stream-json` (plus `--json`/`--stream-json`) and says shared
  flags apply in both interactive and one-shot modes. Research shows Copilot CLI
  lacks a JSON output flag, Codex only offers `--json` (JSONL stream) without a
  distinct `json` vs `stream-json`, and Claude/Gemini output-format flags are
  documented for non-interactive mode only. This conflicts with the shared flag
  semantics and mode parity.
- **Approval policy names and behavior diverge**: The spec’s
  `--approval prompt|auto-edit|yolo` (with `--auto-edit`) does not map cleanly to
  agent CLIs: Gemini uses `auto_edit`, Codex uses `--ask-for-approval`/`--full-auto`,
  Claude uses `--permission-mode`/`--dangerously-skip-permissions`, and Copilot
  uses `--allow-all-tools`/`--allow-tool`. There is no universal “auto-edit” or
  “prompt” flag.
- **Sandbox values are not shared**: The spec requires
  `--sandbox workspace-write|off`, but research indicates Codex supports multiple
  sandbox levels (including read-only and danger/full-access), Gemini’s
  `--sandbox` is a boolean enable, and Claude/Copilot don’t expose a sandbox flag.
  `off` is not a documented Codex sandbox value.
- **Tasks assume a single translation path without per-agent capability gating**:
  The plan/tasks define a uniform shim mapping without a capability matrix,
  but research shows per-agent differences for model selection, output format,
  web access, approval, and sandboxing. That mismatch is not accounted for in the
  current tasks.

## Resolutions (2026-01-23)

- **Model selection**: Keep shared `--model`; map when available; otherwise no-op
  with warning and document per-agent capability.
- **Web access**: Keep shared `--web`; map when available; otherwise no-op with
  warning and document per-agent capability.
- **Output formats**: Keep shared `--output`/`--json`/`--stream-json`; map when
  available; otherwise no-op with warning; document mode limitations.
- **Approval policy**: Keep shared `--approval`/`--auto-edit`; map to closest
  agent behavior; otherwise no-op with warning; document mapping.
- **Sandbox**: Keep shared `--sandbox`; map to closest agent behavior; otherwise
  no-op with warning; document value translation.
- **Capability gating in tasks**: Add a capability matrix and per-agent mapping/
  gating tasks so shared flags are translated or ignored per agent, with warnings.
