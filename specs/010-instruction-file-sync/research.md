# Phase 0 Research: Instruction File Sync

**Date**: 2026-01-17  
**Context**: Sync instruction sources from `/agents/**` templates and repo `AGENTS.md` files.

## Decision 1: Dual source discovery with precedence

**Decision**: Discover `/agents/**` templates and repo `AGENTS.md` files outside `/agents`; when both
map to the same output path + target, `/agents` templates take precedence.

**Rationale**: Preserves the common default workflow while enabling advanced templated sources
without ambiguity.

**Alternatives considered**: Only `/agents` templates (would force migrations); only repo sources
(would block advanced templating).

## Decision 2: Support non-prefixed `/agents/**/AGENTS.md` templates with `outPutPath`

**Decision**: Treat `/agents/**/AGENTS.md` (without the `*.AGENTS.md` prefix) as valid templates if
`outPutPath` is provided; warn and skip outputs when `outPutPath` is missing or invalid. Recommend
`*.AGENTS.md` in documentation for searchability, but do not document the non-prefixed pattern.

**Rationale**: Allows flexibility for existing layouts while keeping a discoverable convention.

**Alternatives considered**: Require `*.AGENTS.md` strictly (breaks existing patterns); default to
template directory (risk unintended outputs).

## Decision 3: Output mapping and Codex+Copilot counting

**Decision**: Map targets to filenames (Claude → `CLAUDE.md`, Gemini → `GEMINI.md`, Codex/Copilot →
`AGENTS.md`), and when both Codex and Copilot are selected, write one `AGENTS.md` and count it once
in summaries.

**Rationale**: Matches file system reality and avoids double-counting a single artifact.

**Alternatives considered**: Count per target (misleading for file-based reporting); generate
separate files (violates target mapping requirement).

## Decision 4: Safe cleanup via tracked state

**Decision**: Persist generated outputs with hashes; only delete files tracked by omniagent and
matching the last generated hash. If diverged, warn and skip deletion in non-interactive mode.

**Rationale**: Prevents data loss and aligns with safe automation expectations.

**Alternatives considered**: Always delete missing outputs (unsafe); delete with no hash check
(risks removing user edits).

## Decision 5: Shared local-precedence engine

**Decision**: Use the shared local-precedence engine (as with skills/commands/subagents) for
instruction sources; `--exclude-local`, `--only`, and `--skip` apply consistently.

**Rationale**: Ensures deterministic resolution order and avoids per-feature duplication.

**Alternatives considered**: Feature-specific precedence logic (maintenance risk, inconsistent UX).
