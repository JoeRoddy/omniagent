# Research Findings: Sync Custom Slash Commands

## Canonical Command Source
- Decision: Store canonical slash commands as Markdown files under
  `agents/commands/`, using Claude Code's command definition format as the
  source of truth. The filename (without `.md`) is the command name and the file
  body is the prompt. Optional YAML frontmatter holds a description.
- Rationale: Satisfies the markdown-first principle and provides a stable,
  well-documented canonical format to map into other agents' formats.
- Alternatives considered: Single manifest file (YAML/TOML); TOML per command;
  JSON-based schema (rejected for markdown-first principle).

## Gemini CLI Custom Commands
- Decision: Map each canonical command to a TOML file at either
  `<repo>/.gemini/commands/` (project) or `~/.gemini/commands/` (global), using
  `prompt` and optional `description` fields.
- Rationale: Gemini CLI requires TOML with `prompt` and supports optional
  `description`; project commands override user commands with the same name and
  subdirectories create namespaced commands via `:`.
- Alternatives considered: Treat Gemini as unsupported (rejects project/global
  support and TOML requirements).

## Claude Code Custom Commands
- Decision: Treat Claude Code's Markdown command format as canonical and map
  other agents to it. Use `.claude/commands/` (project) or `~/.claude/commands/`
  (personal) for direct sync.
- Rationale: Claude Code already consumes the canonical format, reducing
  transformation overhead and clarifying the source-of-truth standard.
- Alternatives considered: Creating a new canonical schema and mapping Claude
  Code to it (adds unnecessary transformation complexity).

## Codex Custom Prompts
- Decision: Map commands to `~/.codex/prompts/*.md` only. Project-level prompts
  are not supported; offer conversion to skills as an alternative (skip by
  excluding the target).
- Rationale: Codex loads prompts from the local Codex home directory, ignores
  subdirectories, and does not share prompts via the repository.
- Alternatives considered: Writing prompts into a project directory (not
  supported by Codex).

## GitHub Copilot CLI
- Decision: Treat custom slash commands as unsupported for Copilot CLI and
  convert commands to skills by default (skip by excluding the target).
- Rationale: Copilot CLI currently exposes only built-in slash commands, and a
  feature request to read `.github/prompts` is still open.
- Alternatives considered: Implementing `.github/prompts` mapping immediately
  (no evidence of support).

## Sync State Tracking and Deletions
- Decision: Track managed commands per target in a small manifest file (TOML)
  stored alongside target outputs and remove only commands listed in the
  manifest when they are removed from the shared catalog.
- Rationale: Enables safe cleanup without deleting user-created commands.
- Alternatives considered: Relying solely on filename heuristics or overwriting
  full directories (too destructive).

## Non-Interactive Defaults
- Decision: Support `--yes` to accept defaults for all prompts. Defaults are:
  project scope for agents that support project/global, global scope for Codex
  conversions, convert-to-skills for unsupported agents, and skip on conflicts.
- Rationale: Safe-by-default behavior avoids destructive changes in
  non-interactive runs while keeping the flow predictable.
- Alternatives considered: Overwrite by default for conflicts (riskier
  behavior).
