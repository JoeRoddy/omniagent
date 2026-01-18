# Implementation Plan: Instruction File Sync

**Branch**: `010-instruction-file-sync` | **Date**: 2026-01-17 | **Spec**: `specs/010-instruction-file-sync/spec.md`
**Input**: Feature specification from `/specs/010-instruction-file-sync/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add instruction-file sync support so `/agents/**` templates and repo `AGENTS.md` files can produce
Claude/Gemini/Codex/Copilot instruction outputs with deterministic precedence, safe cleanup via
tracked state, and accurate summary counts (including the single-output Codex+Copilot case).

## Technical Context

**Language/Version**: TypeScript 5.9 (ES2022) on Node.js 18+  
**Primary Dependencies**: yargs, Node.js `fs/promises`, `path`, Vitest, Vite, Biome  
**Storage**: Filesystem (repo-local sources/outputs + user home state under `~/.omniagent/state/`)  
**Testing**: Vitest  
**Target Platform**: Node.js CLI (macOS/Linux/Windows)  
**Project Type**: single (CLI tool)  
**Performance Goals**: Sync completes in under 2 seconds for typical repos and stays under 100MB RAM  
**Constraints**: Respect `.gitignore` and default skip list; deterministic precedence; non-interactive
safe deletion behavior  
**Scale/Scope**: Repos with hundreds to low-thousands of instruction sources

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. CLI-First Compiler Design**: PASS. Feature only compiles instruction sources into target
  files; no runtime agent behavior introduced.
- **II. Markdown-First, Human-Readable Output**: PASS. Outputs are markdown; summaries remain
  human-readable or JSON. Ensure generated files include provenance comments per existing patterns.
- **III. Explicit Lossy Mapping Transparency**: PASS. Any target-collision case (Codex+Copilot)
  is explicit and counted once; warnings surfaced for skip scenarios.
- **IV. Test-Driven Validation**: PASS. Plan includes unit/integration tests for discovery,
  precedence, and deletion safety.
- **V. Predictable Resolution Order**: PASS. Uses existing local-precedence engine and documented
  resolution order.
- **Performance Standards**: PASS. Directory scanning stays bounded via ignore rules and minimal I/O.

**Post-Design Re-check**: No constitution violations introduced by the Phase 1 design artifacts.

## Project Structure

### Documentation (this feature)

```text
specs/010-instruction-file-sync/
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
├── lib/
└── subagents/
```

**Structure Decision**: Single-project CLI structure (`src/`, `tests/`) already in use.

## Complexity Tracking

No constitution violations to justify.
