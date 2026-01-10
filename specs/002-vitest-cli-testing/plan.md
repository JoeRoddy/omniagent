# Implementation Plan: Vitest CLI Testing

**Branch**: `002-vitest-cli-testing` | **Date**: 2026-01-10 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-vitest-cli-testing/spec.md`

## Summary

Add Vitest as the testing framework for agentctl CLI. Create 2-3 example CLI commands demonstrating common patterns (simple output, argument handling, options/flags) and write comprehensive tests for each command using Vitest.

## Technical Context

**Language/Version**: TypeScript 5.x, ES2022 target
**Primary Dependencies**: yargs (CLI parsing), Vitest (testing)
**Storage**: N/A
**Testing**: Vitest
**Target Platform**: Node.js 18+
**Project Type**: Single CLI project
**Performance Goals**: Test suite completes in under 30 seconds
**Constraints**: Tests must run headlessly without manual interaction
**Scale/Scope**: 2-3 example commands with 2+ test cases each

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CLI-First Compiler Design | ✅ PASS | Testing infrastructure supports CLI validation; example commands demonstrate patterns |
| II. Markdown-First, Human-Readable | ✅ PASS | N/A for testing infra; test output is human-readable |
| III. Explicit Lossy Mapping Transparency | ✅ N/A | Not applicable to testing feature |
| IV. Test-Driven Validation | ✅ PASS | This feature directly implements constitution requirement for testing |
| V. Predictable Resolution Order | ✅ N/A | Not applicable to testing feature |
| Performance Standards | ✅ PASS | 30s test completion aligns with responsive CLI expectation |
| Code Quality Gates (>80% coverage) | ✅ PASS | Feature establishes testing foundation for coverage requirements |

**Constitution Verdict**: All applicable gates pass. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/002-vitest-cli-testing/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── index.ts             # Main exports
└── cli/
    ├── index.ts         # CLI entry point with yargs
    └── commands/        # NEW: Command modules
        ├── hello.ts     # Example: simple output
        ├── greet.ts     # Example: positional argument
        └── echo.ts      # Example: options/flags

tests/
└── commands/            # NEW: Command tests
    ├── hello.test.ts
    ├── greet.test.ts
    └── echo.test.ts
```

**Structure Decision**: Single project structure following existing `src/cli/` pattern. Tests in `tests/` directory at repo root mirroring source structure.

## Complexity Tracking

> No violations to justify. Feature aligns with constitution principles.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | - | - |
