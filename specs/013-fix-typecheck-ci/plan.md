# Implementation Plan: Typecheck and CI Reliability

**Branch**: `013-fix-typecheck-ci` | **Date**: January 18, 2026 | **Spec**: /Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/013-fix-typecheck-ci/spec.md
**Input**: Feature specification from `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/013-fix-typecheck-ci/spec.md`

## Summary

Resolve current TypeScript type errors so the existing typecheck command (tsgo --noEmit) passes, and add CI validation on PRs and pushes that runs quality check, typecheck, tests, and build with fork-safe permissions.

## Technical Context

**Language/Version**: TypeScript 5.9 (ES2022) on Node.js 18+  
**Primary Dependencies**: yargs, @typescript/native-preview (tsgo), Vitest, Vite, Biome  
**Storage**: Filesystem (repo-local config and user home state)  
**Testing**: Vitest  
**Target Platform**: Node.js CLI (cross-platform)  
**Project Type**: single project (CLI + library)  
**Performance Goals**: No new runtime performance requirements; CI should complete within standard job timeouts  
**Constraints**: Keep typecheck command as tsgo --noEmit; run quality check as a separate CI step; CI runs on PRs and pushes; forked PRs run read-only with no secrets  
**Scale/Scope**: Single-package CLI repo with src/ and tests/; changes limited to type fixes and CI workflow

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- CLI-First Compiler Design: PASS (no runtime or orchestration changes)
- Markdown-First, Human-Readable Output: PASS (no changes to output formats)
- Explicit Lossy Mapping Transparency: N/A (no mapping changes)
- Test-Driven Validation: PASS (adds or preserves validation gates)
- Predictable Resolution Order: N/A (no resolution logic changes)
- Performance Standards: PASS (no runtime path changes)
- Development Workflow Gates: PASS (quality gates remain enforced)
- Governance: PASS

**Post-Design Check**: PASS (research and design artifacts introduce no new constitutional risks)

## Project Structure

### Documentation (this feature)

```text
/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/013-fix-typecheck-ci/
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
├── lib/
└── index.ts

/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests/
├── commands/
├── docs/
├── lib/
└── subagents/
```

**Structure Decision**: Single project layout with `src/` and `tests/` as shown.
