# Implementation Plan: Shared and Local Config Sync

**Branch**: `009-local-config-sync` | **Date**: January 15, 2026 | **Spec**: `specs/009-local-config-sync/spec.md`
**Input**: Feature specification from `/specs/009-local-config-sync/spec.md`

## Summary

Add local config support to `omniagent sync`, including local source discovery
(via `agents/.local/` and `.local` suffixes for files or skill directories),
deterministic precedence,
selective exclusion, and local item listing. Include optional ignore-rule
prompting with per-project suppression and non-interactive behavior, while
keeping outputs normalized and summaries accurate.

## Technical Context

**Language/Version**: TypeScript 5.9 (ES2022) on Node.js 18+  
**Primary Dependencies**: yargs, Node.js `fs/promises`, `path`  
**Storage**: Filesystem (repo-local agents/ directories and user home state under
`~/.omniagent/state/`)  
**Testing**: Vitest  
**Target Platform**: Node.js CLI (macOS/Linux/Windows)  
**Project Type**: single (CLI tool)  
**Performance Goals**: Sync completes in under 2 seconds for typical repos;
list-local completes in under 2 seconds for 50 local items  
**Constraints**: <100MB memory, no network access required, deterministic output
order  
**Scale/Scope**: Up to 1,000 config items across skills/agents/commands

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **CLI-First Compiler Design**: PASS. Feature only changes compilation inputs
  and outputs; no runtime agent orchestration.
- **Markdown-First, Human-Readable Output**: PASS. Outputs remain markdown and
  diffable; ignore prompts are CLI-level only.
- **Explicit Lossy Mapping Transparency**: PASS. No new target mappings; existing
  sync reporting extended to local/shared counts.
- **Test-Driven Validation**: PASS. Changes will add/extend unit and integration
  tests for sync behavior and edge cases.
- **Predictable Resolution Order**: PASS. Local vs shared precedence and
  exclusions are explicit and deterministic; summary/reporting will document
  applied sources.

**Post-Design Re-check**: PASS. Phase 1 artifacts align with CLI-first behavior
and do not introduce runtime or undocumented mapping behavior.

## Project Structure

### Documentation (this feature)

```text
specs/009-local-config-sync/
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
├── lib/
└── index.ts

tests/
├── commands/
├── lib/
└── subagents/
```

**Structure Decision**: Single-project CLI. Changes land in `src/cli/commands/`
for CLI parsing/flow and `src/lib/` for shared sync logic; tests in
`tests/commands/` and `tests/lib/`.
