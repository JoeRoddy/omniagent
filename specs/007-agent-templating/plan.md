# Implementation Plan: Agent-Specific Templating

**Branch**: `007-agent-templating` | **Date**: 2026-01-12 | **Spec**: /Users/joeroddy/Documents/dev/projects/open-source/agentctl/specs/007-agent-templating/spec.md
**Input**: Feature specification from `/specs/007-agent-templating/spec.md`

**Note**: This plan follows the `/speckit.plan` workflow.

## Summary

Add agent-scoped templating blocks that can appear anywhere in syncable files, using a
tag-style `<agents selector-list> ... </agents>` syntax with include/exclude selectors. The compiler must apply
selectors consistently across all syncable features, fail fast on invalid selectors, and
document the universal support in AGENTS.md and other syncable feature docs.

## Technical Context

**Language/Version**: TypeScript 5.9 (ES2022) on Node.js 18+  
**Primary Dependencies**: yargs, Node.js `fs/promises`, `path`, Vitest, Vite, Biome  
**Storage**: Filesystem (repo-local config + target directories + user home config)  
**Testing**: Vitest (unit + integration)  
**Target Platform**: Node.js CLI (macOS/Linux/Windows)  
**Project Type**: Single project (CLI)  
**Performance Goals**: `validate` < 500ms, `compile` < 2s for typical projects  
**Constraints**: < 100MB memory, stream I/O where possible, fail-fast on invalid selectors  
**Scale/Scope**: Typical repos with tens to hundreds of config files and dozens of agents

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- CLI-first compiler boundary maintained (no runtime execution) — PASS
- Markdown-first, human-readable output preserved — PASS
- Lossy mapping transparency (templating never silently dropped) — PASS
- Test-driven validation required for new parsing logic — PASS
- Deterministic resolution order preserved — PASS
- Performance standards (validate/compile targets) acknowledged — PASS

## Project Structure

### Documentation (this feature)

```text
/Users/joeroddy/Documents/dev/projects/open-source/agentctl/specs/007-agent-templating/
├── plan.md              # This file (/speckit.plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── cli/
├── lib/
└── index.ts

tests/
├── commands/
├── lib/
└── subagents/
```

**Structure Decision**: Single-project Node.js CLI with `src/` and `tests/`.

## Phase 0: Outline & Research

### Research Tasks

- Decision: tag-style block syntax `<agents selector-list> ... </agents>` with `not:` exclusions.
  - Rationale: avoids collisions with common `{}` usage while keeping inline include/exclude semantics.
  - Alternatives considered: single-brace inline syntax, double-bracket tags, line-based tags.
- Decision: block ends at first unescaped `</agents>` and supports `\</agents>` inside content.
  - Rationale: avoids ambiguous nesting and supports literal closing tags.
  - Alternatives considered: single-line only, explicit end tokens.
- Decision: invalid selectors fail entire sync run and list valid identifiers.
  - Rationale: fail-fast prevents silent corruption and enforces correctness.
  - Alternatives considered: warnings only or partial-file failure.
- Decision: selector validation is case-insensitive and limited to configured agents.
  - Rationale: reduces user error while keeping explicit scope.
  - Alternatives considered: case-sensitive matching or unrestricted identifiers.

**Output**: `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/specs/007-agent-templating/research.md`

## Phase 1: Design & Contracts

### Data Model

- Capture Template Block and Agent Identifier entities and validation rules from the spec.

**Output**: `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/specs/007-agent-templating/data-model.md`

### Contracts

- No external HTTP/GraphQL APIs are introduced; document CLI-facing contract notes.

**Output**: `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/specs/007-agent-templating/contracts/README.md`

### Quickstart

- Provide user-facing examples for the finalized syntax and error behavior.

**Output**: `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/specs/007-agent-templating/quickstart.md`

### Agent Context Update

- Run `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/.specify/scripts/bash/update-agent-context.sh codex` after design artifacts are generated.

## Phase 2: Planning Handoff

- `/speckit.tasks` will derive implementation tasks from this plan.

## Constitution Check (Post-Design)

- No violations introduced by the syntax or validation design — PASS
