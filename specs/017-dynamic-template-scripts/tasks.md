---

description: "Task list for Dynamic Template Scripts"
---

# Tasks: Dynamic Template Scripts

**Input**: Design documents from `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/017-dynamic-template-scripts/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Tests are required for this feature by the specification and constitution; include unit and integration coverage per user story.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish module and test scaffolding for dynamic script execution

- [X] T001 Create dynamic script runtime module scaffold in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/template-scripts.ts`
- [X] T002 [P] Create template script unit test scaffold in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests/lib/template-scripts.test.ts`
- [X] T003 [P] Add sync command argument scaffolding for `--verbose` script telemetry mode in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core runtime and sync-run plumbing that MUST be complete before user stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Implement `<nodejs>` parsing, block indexing, and validation rules in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/template-scripts.ts`
- [X] T005 Implement isolated Node subprocess execution, CommonJS helpers (`require`, `__dirname`, `__filename`), and return-value normalization helpers in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/template-scripts.ts`
- [X] T006 Implement per-sync-run template script cache and evaluation orchestration in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/template-scripts.ts`
- [X] T007 Add sync-run script metadata types (`runId`, `scriptExecutions`, `warnings`, `partialOutputsWritten`) in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/sync-results.ts`
- [X] T008 Wire script runtime context propagation through sync entry points in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts`, `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/skills/sync.ts`, `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/slash-commands/sync.ts`, `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/subagents/sync.ts`, and `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/instructions/sync.ts`

**Checkpoint**: Foundation ready - dynamic script runtime can be consumed by feature flows

---

## Phase 3: User Story 1 - Generate content from template scripts (Priority: P1) 🎯 MVP

**Goal**: Template authors can embed `<nodejs>` blocks and render generated content from current repository state.

**Independent Test**: Add a docs-list script block to one template, run sync, and verify output contains rendered list content instead of raw script markup.

### Tests for User Story 1

- [X] T009 [P] [US1] Add unit tests for successful script evaluation, block ordering, and repo-state-sensitive output in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests/lib/template-scripts.test.ts`
- [X] T010 [US1] Add sync integration test verifying `<nodejs>` content replaces script markup in generated outputs in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests/commands/sync.test.ts`

### Implementation for User Story 1

- [X] T011 [P] [US1] Evaluate dynamic script blocks before slash-command templating/rendering in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/slash-commands/sync.ts`
- [X] T012 [P] [US1] Evaluate dynamic script blocks before instruction template rendering in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/instructions/sync.ts`
- [X] T013 [P] [US1] Evaluate dynamic script blocks during skill writer processing in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/targets/writers.ts`
- [X] T014 [US1] Evaluate dynamic script blocks before subagent frontmatter stripping in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/subagents/sync.ts`

**Checkpoint**: User Story 1 is fully functional and independently testable

---

## Phase 4: User Story 2 - Keep static template behavior intact (Priority: P2)

**Goal**: Existing templates remain stable while dynamic scripts run once per template and reuse results across targets.

**Independent Test**: Compare sync outputs for templates without scripts before/after feature, then verify multi-target sync executes each script block once per template per run.

### Tests for User Story 2

- [X] T015 [P] [US2] Add regression tests for unchanged output when no `<nodejs>` blocks are present in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests/lib/slash-commands/sync.test.ts`
- [X] T016 [P] [US2] Add regression tests for static text preservation around script blocks in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests/lib/instructions/sync.test.ts`
- [X] T017 [US2] Add integration test proving once-per-template execution and cross-target result reuse in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests/commands/sync.test.ts`
- [X] T018 [US2] Add integration test proving renderer output is authoritative when scripts side-effect managed outputs in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests/commands/sync.test.ts`

### Implementation for User Story 2

- [X] T019 [US2] Reuse cached script results across target renders for command and instruction templates in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/slash-commands/sync.ts` and `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/instructions/sync.ts`
- [X] T020 [US2] Reuse cached script results across skill and subagent sync flows in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/targets/writers.ts`, `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/skills/sync.ts`, and `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/subagents/sync.ts`
- [X] T021 [US2] Enforce rendering contract for script return types (string/json/coerced/empty omission) in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/template-scripts.ts`

**Checkpoint**: User Stories 1 and 2 are independently functional with backward compatibility

---

## Phase 5: User Story 3 - Fail safely on script errors (Priority: P3)

**Goal**: Script failures stop sync immediately with actionable diagnostics, no partial managed writes, and controlled telemetry.

**Independent Test**: Introduce a failing script and a long-running script, run sync, and verify fail-fast behavior, no partial managed outputs, periodic warnings, and verbose-only telemetry.

### Tests for User Story 3

- [X] T022 [US3] Add integration tests for first-error abort and zero partial sync-managed writes in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests/commands/sync.test.ts`
- [X] T023 [P] [US3] Add runtime tests for long-running script heartbeat warnings and no-timeout execution in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests/lib/template-scripts.test.ts`
- [X] T024 [US3] Add JSON summary contract assertions (`failedTemplatePath`, `failedBlockId`, warnings, status) in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests/commands/sync.test.ts`

### Implementation for User Story 3

- [X] T025 [US3] Propagate structured script failures (template path + block identity) through sync reporting in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/template-scripts.ts` and `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts`
- [X] T026 [US3] Stage script evaluation before sync-managed writes in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/skills/sync.ts`, `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/slash-commands/sync.ts`, `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/subagents/sync.ts`, and `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/instructions/sync.ts`
- [X] T027 [US3] Emit periodic `still running` warnings every 30 seconds without execution timeouts in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/template-scripts.ts`
- [X] T028 [US3] Gate routine per-script telemetry behind `sync --verbose` and keep default output quiet in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts` and `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/template-scripts.ts`
- [X] T029 [US3] Execute every script block in an isolated Node subprocess with no shared in-memory state in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/template-scripts.ts`

**Checkpoint**: All user stories are independently functional with safety and telemetry requirements met

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation and final cross-feature alignment

- [X] T030 [P] Document `<nodejs>` authoring, return handling, side-effect expectations, and verbose telemetry in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/README.md`
- [X] T031 [P] Add maintainer guidance that dynamic scripts apply to all current/future syncable surfaces in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/AGENTS.md`
- [X] T032 [P] Align end-to-end validation steps for docs-list generation, failure mode, and long-running warnings in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/017-dynamic-template-scripts/quickstart.md`
- [X] T033 [P] Reconcile contract examples and schema details with implemented sync telemetry/failure payloads in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/017-dynamic-template-scripts/contracts/sync-dynamic-scripts.yaml`

---

## Dependencies & Execution Order

### Dependency Graph

`Phase 1 Setup -> Phase 2 Foundational -> US1 (Phase 3) -> US2 (Phase 4) -> US3 (Phase 5) -> Phase 6 Polish`

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational completion - MVP delivery slice
- **User Story 2 (Phase 4)**: Depends on User Story 1 for shared runtime integration
- **User Story 3 (Phase 5)**: Depends on User Story 2 for cached/runtime behavior baseline
- **Polish (Phase 6)**: Depends on completion of all user story phases

### User Story Dependencies

- **US1 (P1)**: Starts after Foundational; no dependency on other stories
- **US2 (P2)**: Builds on US1 runtime integration and cache wiring
- **US3 (P3)**: Builds on US1/US2 execution pipeline for fail-fast and telemetry guarantees

### Within Each User Story

- Test tasks are defined before implementation tasks
- Shared runtime behavior is implemented before per-surface integration
- Integration assertions complete before story checkpoint

---

## Parallel Execution Examples

### Parallel Example: User Story 1

```bash
Task T009: tests/lib/template-scripts.test.ts
Task T010: tests/commands/sync.test.ts
Task T011: src/lib/slash-commands/sync.ts
Task T012: src/lib/instructions/sync.ts
Task T013: src/lib/targets/writers.ts
```

### Parallel Example: User Story 2

```bash
Task T015: tests/lib/slash-commands/sync.test.ts
Task T016: tests/lib/instructions/sync.test.ts
Task T019: src/lib/slash-commands/sync.ts + src/lib/instructions/sync.ts
Task T020: src/lib/targets/writers.ts + src/lib/skills/sync.ts + src/lib/subagents/sync.ts
```

### Parallel Example: User Story 3

```bash
Task T023: tests/lib/template-scripts.test.ts
Task T024: tests/commands/sync.test.ts
Task T027: src/lib/template-scripts.ts
Task T028: src/cli/commands/sync.ts + src/lib/template-scripts.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Validate User Story 1 independently before expanding scope

### Incremental Delivery

1. Ship Setup + Foundational runtime support
2. Deliver US1 for baseline dynamic script rendering
3. Deliver US2 for backward compatibility and cache reuse guarantees
4. Deliver US3 for failure safety and telemetry behavior
5. Finish Polish updates across docs, quickstart, and contract artifacts

### Parallel Team Strategy

1. Team completes Phase 1 and Phase 2 together
2. After Phase 2, split work by story and [P] tasks
3. Rejoin for Phase 6 documentation and contract alignment

---

## Notes

- [P] tasks target different files and can be implemented concurrently
- [US#] labels map each task to a single user story for traceability
- Every task includes explicit absolute file paths for execution clarity
- Validate each story independently at its checkpoint before moving forward
