# Implementation Plan: Dynamic Template Scripts

**Branch**: `017-dynamic-template-scripts` | **Date**: 2026-02-08 | **Spec**: [/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/017-dynamic-template-scripts/spec.md](/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/017-dynamic-template-scripts/spec.md)
**Input**: Feature specification from `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/017-dynamic-template-scripts/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Add dynamic JavaScript script blocks to syncable templates so generated content is rendered at sync
runtime using current repository state. The implementation introduces a shared script-enabled
templating pipeline that evaluates each block once per template per sync run, reuses results across
all targets, fails fast on first script error, emits periodic "still running" warnings for long
scripts, and keeps default output quiet unless `sync --verbose` is enabled.

## Technical Context

**Language/Version**: TypeScript 5.9 (ES2022) on Node.js 18+  
**Primary Dependencies**: yargs, Node.js `fs/promises` + `path` + `child_process`, Vitest, Vite, Biome  
**Storage**: Filesystem (repo-local template sources and generated outputs, user home state under `~/.omniagent/state/`) + in-memory per-run script result cache  
**Testing**: Vitest (unit + integration + command tests)  
**Target Platform**: Node.js 18+ CLI (macOS/Linux/Windows)  
**Project Type**: single  
**Performance Goals**: Preserve existing sync performance for templates without scripts; maintain deterministic script execution ordering; emit progress warnings every 30 seconds for long-running blocks  
**Constraints**: No script sandboxing or timeouts; fail on first script error; zero partial sync-managed writes when script evaluation fails; renderer output remains authoritative for sync-managed paths  
**Scale/Scope**: All syncable template surfaces (`agents`, `skills`, `commands`, instruction templates), typically tens of templates and dozens of script blocks per run

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Compiler-First with Shim Boundaries**: Pass. Script execution is part of template compilation and does not introduce an agent runtime/orchestrator.
- **II. Markdown-First, Human-Readable Output**: Pass. Canonical template sources remain markdown and generated outputs stay target-native.
- **III. Explicit Lossy Mapping Transparency**: Pass. Script failures are surfaced with template/block identity and stop sync immediately.
- **IV. Test-Driven Validation**: Pass. Plan includes parser/execution unit tests plus sync command integration tests for success/failure paths.
- **V. Predictable Resolution Order**: Pass. Scripts execute in deterministic source order per template and cached results are reused across target renders.
- **Performance Standards**: Conditional pass with justified exception. FR-016 explicitly requires waiting indefinitely for hanging scripts, which can exceed the normal "seconds not minutes" target.

**Post-Design Re-check**: Pass with the same justified performance exception only; no additional constitution violations introduced.

## Project Structure

### Documentation (this feature)

```text
/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/017-dynamic-template-scripts/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── tasks.md
```

### Source Code (repository root)

```text
/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/
├── cli/
│   ├── commands/
│   │   └── sync.ts
│   └── index.ts
├── lib/
│   ├── agent-templating.ts
│   ├── template-scripts.ts
│   ├── instructions/
│   │   └── sync.ts
│   ├── slash-commands/
│   │   └── sync.ts
│   ├── skills/
│   │   └── sync.ts
│   ├── subagents/
│   │   └── sync.ts
│   └── targets/
│       └── writers.ts
└── index.ts

/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests/
├── commands/
├── lib/
│   ├── agent-templating.test.ts
│   ├── template-scripts.test.ts
│   ├── instructions/
│   │   └── sync.test.ts
│   └── slash-commands/
│       └── sync.test.ts
└── subagents/
    └── sync.test.ts
```

**Structure Decision**: Single-project CLI layout with a new shared `template-scripts` runtime in
`/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/` consumed by all syncable
surfaces.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Performance standard deviation for potentially unbounded sync duration | FR-016 requires waiting indefinitely for non-terminating scripts while emitting periodic warnings | Enforcing a timeout would violate explicit clarified requirements and change required runtime semantics |
