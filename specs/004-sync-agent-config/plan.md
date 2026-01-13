# Implementation Plan: Sync Agent Config

**Branch**: `004-sync-agent-config` | **Date**: January 10, 2026 | **Spec**: `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/004-sync-agent-config/spec.md`
**Input**: Feature specification from `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/004-sync-agent-config/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add an `omniagent sync` command that copies the canonical agent config from
`/Users/joeroddy/Documents/dev/projects/open-source/omniagent/agents/skills` to
all supported targets with `--skip`/`--only` filters, non-destructive behavior,
per-target status reporting, and repo-root auto-resolution.

## Technical Context

**Language/Version**: TypeScript 5.9 (ES2022) on Node.js 18+
**Primary Dependencies**: yargs, Node.js fs/promises + path
**Storage**: Filesystem (repo-local directories)
**Testing**: Vitest
**Target Platform**: Node.js 18+ CLI (macOS/Linux/Windows)
**Project Type**: Single CLI project
**Performance Goals**: Sync up to ~200 files in <30s; invalid usage errors in <2s
**Constraints**: No external CLI tools; non-destructive sync; continue after per-target failures; auto-resolve repo root; exit non-zero on any failure
**Scale/Scope**: Fixed 3 targets (codex, claude, copilot) and a single canonical source directory

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. CLI-First Compiler Design**: PASS. Sync is a CLI-only file operation that validates canonical source existence and does not run agents or external services.
- **II. Markdown-First, Human-Readable Output**: PASS. Sync will emit human-readable output and provide a `--json` option for structured results; canonical files remain human-readable.
- **III. Explicit Lossy Mapping Transparency**: PASS (N/A). Sync performs no mapping or transformation.
- **IV. Test-Driven Validation**: PASS. Plan includes unit/integration tests for filters, errors, and per-target outcomes.
- **V. Predictable Resolution Order**: PASS (N/A). Sync does not resolve overrides; it copies from the canonical source.

**Post-Phase 1 Re-check**: PASS. The design artifacts include structured output (`--json`),
non-destructive copy behavior, and contract/test coverage aligned with the
constitution principles.

## Project Structure

### Documentation (this feature)

```text
/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/004-sync-agent-config/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/
├── cli/
│   ├── commands/
│   │   ├── echo.ts
│   │   ├── greet.ts
│   │   ├── hello.ts
│   │   └── sync.ts        # to add
│   └── index.ts
└── index.ts

/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests/
└── commands/
    ├── echo.test.ts
    ├── greet.test.ts
    ├── hello.test.ts
    └── sync.test.ts       # to add
```

**Structure Decision**: Single CLI project. Add the new command under
`/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/`
with tests in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests/commands/`.

## Complexity Tracking

No constitution violations identified.
