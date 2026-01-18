# Implementation Plan: Custom Agents Directory Override

**Branch**: `012-agents-dir-override` | **Date**: 2026-01-18 | **Spec**: `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/012-agents-dir-override/spec.md`
**Input**: Feature specification from `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/012-agents-dir-override/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add an optional `--agentsDir` CLI flag for commands that read/write agent configs, defaulting to the
existing `agents/` directory, resolving relative paths from the project root, and surfacing clear
errors and help documentation without changing current behavior.

## Technical Context

**Language/Version**: TypeScript 5.9 (ES2022) on Node.js 18+  
**Primary Dependencies**: yargs, Node.js `fs/promises`, `path`, Vitest, Vite, Biome  
**Storage**: Filesystem (repo-local `agents/` directory or user-supplied agents directory)  
**Testing**: Vitest  
**Target Platform**: Node.js CLI (macOS/Linux/Windows)  
**Project Type**: single (CLI tool)  
**Performance Goals**: No regression to CLI benchmarks; remain within existing standards
(`validate` <500ms, `compile` <2s, <100MB memory).  
**Constraints**: No behavior change without the flag; deterministic path resolution from project
root; clear errors on invalid directories; consistent default across commands.  
**Scale/Scope**: Repos with up to ~1,000 agent config files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. CLI-First Compiler Design**: PASS. This change only affects configuration discovery paths
  used by the compiler; it does not add any runtime agent behavior.
- **II. Markdown-First, Human-Readable Output**: PASS. Config files remain markdown; error/help
  output stays user-readable with actionable guidance.
- **III. Explicit Lossy Mapping Transparency**: PASS. No new target mappings or lossy conversions
  are introduced.
- **IV. Test-Driven Validation**: PASS. Plan includes unit/integration tests for flag parsing,
  resolution, and error handling.
- **V. Predictable Resolution Order**: PASS. Default path remains unchanged; override resolution is
  explicit, deterministic, and documented in help.
- **Performance Standards**: PASS. Path resolution adds negligible overhead and stays within
  existing CLI performance thresholds.

**Post-Design Re-check**: PASS. Phase 1 artifacts preserve CLI-first behavior and do not introduce
additional compliance risks.

## Project Structure

### Documentation (this feature)

```text
/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/012-agents-dir-override/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
/Users/joeroddy/Documents/dev/projects/open-source/omniagent/
src/
├── cli/
│   ├── commands/
│   └── index.ts
├── lib/
└── index.ts

tests/
├── commands/
├── lib/
└── subagents/
```

**Structure Decision**: Single-project CLI. CLI flag parsing lives in `src/cli/commands/`, shared
path resolution in `src/lib/`, with tests in `tests/commands/` and `tests/lib/`.

## Complexity Tracking

No constitution violations to justify.
