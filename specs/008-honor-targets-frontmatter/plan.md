# Implementation Plan: Honor Targets Frontmatter

**Branch**: `008-honor-targets-frontmatter` | **Date**: 2026-01-14 | **Spec**: `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/specs/008-honor-targets-frontmatter/spec.md`
**Input**: Feature specification from `/specs/008-honor-targets-frontmatter/spec.md`

## Summary

Honor per-file `targets`/`targetAgents` frontmatter defaults across skills, subagents, and slash
commands, while allowing run-level `--only`/`--skip` CLI overrides to replace or filter those
defaults. Ensure unsupported targets are reported, effective targets can resolve to empty, and
generated outputs strip target metadata consistently across conversions.

## Technical Context

**Language/Version**: TypeScript 5.9 (ES2022) on Node.js 18+  
**Primary Dependencies**: yargs, Node.js `fs/promises`, `path`  
**Storage**: Filesystem (repo-local config + target directories + user home config)  
**Testing**: Vitest  
**Target Platform**: Node.js CLI  
**Project Type**: Single project (CLI + supporting libs)  
**Performance Goals**: Sync completes within existing CLI performance standards  
**Constraints**: Preserve CLI-first compiler boundaries; avoid new runtime dependencies  
**Scale/Scope**: Typical repo size; no large-scale data requirements

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. CLI-First Compiler Design**: Pass — feature adds compile-time target selection logic only.
- **II. Markdown-First, Human-Readable Output**: Pass — frontmatter remains YAML and outputs remain
  markdown; target metadata stripped from generated files.
- **III. Explicit Lossy Mapping Transparency**: Pass — spec requires user notice for unsupported
  targets; no silent drops.
- **IV. Test-Driven Validation**: Pass — plan includes tests for new targeting behavior across
  features.
- **V. Predictable Resolution Order**: Pass — CLI overrides deterministically apply `--only` then
  `--skip` over per-file defaults.

## Project Structure

### Documentation (this feature)

```text
specs/008-honor-targets-frontmatter/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── cli/
├── lib/
└── models/

tests/
├── integration/
└── unit/
```

**Structure Decision**: Single project; keep updates within existing `src/` and `tests/` layout.

## Phase 0: Outline & Research

### Research Tasks

- Validate existing target selection behavior in current sync flow and confirm where to inject
  frontmatter defaults.
- Review current frontmatter parsing and metadata stripping rules to ensure `targets` and
  `targetAgents` can be removed from outputs without affecting other fields.
- Verify how CLI `--only` and `--skip` flags are currently modeled and where they should override
  per-file defaults.

### Research Findings

- Decision: Reuse existing frontmatter parsing and target selection logic, extending it to skills
  and subagents with shared normalization for `targets` and `targetAgents`.
  - Rationale: The system already parses frontmatter and applies target filters for slash commands;
    extending the same normalization reduces surface area and keeps behavior consistent.
  - Alternatives considered: Creating feature-specific target logic per file type (rejected due to
    duplication and higher divergence risk).
- Decision: Define a unified effective-target resolution step that accepts per-file defaults and
  CLI overrides (`--only` then `--skip`).
  - Rationale: Makes override semantics explicit and testable, aligning with the clarified spec.
  - Alternatives considered: Filtering only within frontmatter (rejected; conflicts with clarified
    override behavior).
- Decision: Strip `targets`/`targetAgents` metadata during output rendering/conversion across all
  targets.
  - Rationale: Prevents target metadata leakage and matches spec requirement.
  - Alternatives considered: Keeping metadata for debug (rejected; violates spec and could confuse
    target tools).

## Phase 1: Design & Contracts

### Data Model

- **Syncable File**
  - Fields: `path`, `type` (skill/subagent/command), `frontmatter`, `content`
  - Validation: `targets`/`targetAgents` values normalize to supported targets only
- **Target Selection**
  - Fields: `defaultTargets`, `overrideOnly`, `overrideSkip`, `effectiveTargets`
  - Rules: If `overrideOnly` provided → base = `overrideOnly`; else base = `defaultTargets`
    (or all supported if default empty). Then remove any `overrideSkip`.
- **Target Agent**
  - Values: `claude`, `codex`, `copilot`, `gemini` (case-insensitive matching)

### Contracts

This feature is CLI-only and does not add external API contracts. Command behavior is described by
CLI usage and tests; no HTTP or RPC endpoints are introduced.

### Quickstart

1. Add targets to a skill:
   - `targets: [claude, codex]`
2. Add targets to a subagent:
   - `targetAgents: gemini`
3. Run a default sync to apply per-file defaults.
4. Run `sync --only gemini` to override frontmatter for a one-off sync.
5. Run `sync --skip copilot` to filter targets from the current base selection.

### Agent Context Update

- Run `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/.specify/scripts/bash/update-agent-context.sh codex`
- Confirm manual additions preserved

## Phase 1 Constitution Re-Check

- **I. CLI-First Compiler Design**: Pass
- **II. Markdown-First, Human-Readable Output**: Pass
- **III. Explicit Lossy Mapping Transparency**: Pass (unsupported targets surfaced)
- **IV. Test-Driven Validation**: Pass (tests planned)
- **V. Predictable Resolution Order**: Pass (override order explicit)

## Phase 2: Planning

- Build tasks list in `/specs/008-honor-targets-frontmatter/tasks.md` with unit + integration tests
  for target normalization, override semantics, and metadata stripping.
