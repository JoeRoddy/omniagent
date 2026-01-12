# Implementation Plan: Sync Custom Subagents

**Branch**: `006-add-custom-subagents` | **Date**: 2026-01-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-add-custom-subagents/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Add a canonical subagent catalog in `agents/agents/`, parse Claude Code–format subagents, sync them to
Claude Code’s project subagent directory, and convert subagents into skills for other targets. Enforce
deterministic naming, collision checks, strict file validation, and managed-output cleanup in sync
summaries while keeping lossy mappings explicit.

## Technical Context

**Language/Version**: TypeScript 5.9 (ES2022) on Node.js 18+  
**Primary Dependencies**: yargs, Node.js fs/promises + path  
**Storage**: Filesystem (repo-local config + target directories)  
**Testing**: Vitest  
**Target Platform**: Node.js CLI (macOS/Linux/Windows)  
**Project Type**: single  
**Performance Goals**: Typical `agentctrl sync` under 2 seconds; cold start under 5 seconds  
**Constraints**: Markdown-first canonical config; no runtime orchestration; only managed outputs modified  
**Scale/Scope**: Up to ~20 subagent definitions per repo, sync across 4 targets

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. CLI-First Compiler Design**: PASS — feature compiles configs into target files only.
- **II. Markdown-First, Human-Readable Output**: PASS — canonical subagents are Markdown + YAML.
- **III. Explicit Lossy Mapping Transparency**: PASS — unsupported targets are converted to skills with warnings.
- **IV. Test-Driven Validation**: PASS — new parsing/sync paths will include unit/integration tests.
- **V. Predictable Resolution Order**: PASS — uses existing sync flow; no new override layers.

**Post-Design Re-check**: PASS — design artifacts align with constraints and mapping transparency.

## Project Structure

### Documentation (this feature)

```text
specs/006-add-custom-subagents/
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
│   └── commands/
└── lib/
    └── slash-commands/

tests/
├── commands/
└── lib/
    └── slash-commands/
```

**Structure Decision**: Single-project CLI; changes will live in existing `src/lib` parsing/sync utilities
and `src/cli` command wiring, with tests under `tests/`.

## Complexity Tracking

No constitution violations requiring justification.
