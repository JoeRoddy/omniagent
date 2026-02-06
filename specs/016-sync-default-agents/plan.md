# Implementation Plan: Sync Default Agent Generation

**Branch**: `016-sync-default-agents` | **Date**: 2026-02-06 | **Spec**: [/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/016-sync-default-agents/spec.md](/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/016-sync-default-agents/spec.md)
**Input**: Feature specification from `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/016-sync-default-agents/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Update `sync` so that when no explicit target filter is provided, it detects available agent
platforms by checking for their CLIs on `PATH`, syncs only those targets, and surfaces clear
skip reasons and warnings. Explicit target lists always override availability detection, and
previously synced outputs are retained when a platform becomes unavailable.

## Technical Context

**Language/Version**: TypeScript 5.9 (ES2022) on Node.js 18+  
**Primary Dependencies**: yargs, Node.js `fs/promises` + `path`, Vitest, Vite, Biome  
**Storage**: Filesystem (repo-local outputs and user home state under `~/.omniagent/state/`)  
**Testing**: Vitest  
**Target Platform**: Node.js 18+ CLI  
**Project Type**: single  
**Performance Goals**: Maintain responsive CLI behavior; typical `sync` completes under 2 seconds  
**Constraints**: Offline, local detection only; deterministic target selection  
**Scale/Scope**: Small target set (<=10 platforms) and bounded output size per run

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **CLI-First Compiler Design**: Pass. No runtime agent execution; only target selection and output generation.
- **Markdown-First Output**: Pass. No new output formats introduced.
- **Lossy Mapping Transparency**: Pass. Skips and warnings are surfaced in summaries.
- **Test-Driven Validation**: Pass. Plan includes tests for availability detection and summary output.
- **Predictable Resolution Order**: Pass. Explicit targets override detection; default path is deterministic.
- **Performance Standards**: Pass. Availability checks are lightweight local signals.

**Post-Design Re-check**: Pass. Design artifacts stay within compiler scope and keep output transparency.

## Project Structure

### Documentation (this feature)

```text
specs/016-sync-default-agents/
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
└── index.ts

tests/
├── commands/
├── docs/
├── e2e/
├── lib/
└── subagents/
```

**Structure Decision**: Single-project layout using existing `src/` and `tests/` directories.

## Complexity Tracking

No constitution violations identified; complexity tracking not required.
