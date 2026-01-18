---

description: "Task list for Typecheck and CI Reliability"
---

# Tasks: Typecheck and CI Reliability

**Input**: Design documents from `/specs/013-fix-typecheck-ci/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Not requested in the feature specification (no explicit test tasks included)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- Paths shown below assume single project layout from plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create CI workflow directory if missing at `.github/workflows/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core prerequisites that must be correct before user story validation can pass

- [X] T002 Ensure `typecheck` uses `tsgo --noEmit` and add `@typescript/native-preview` dependency in `package.json` and `package-lock.json`

**Checkpoint**: Foundations ready for user story implementation

---

## Phase 3: User Story 1 - Run typecheck locally (Priority: P1) 🎯 MVP

**Goal**: Maintainers can run the typecheck command locally with zero type errors.

**Independent Test**: Run the typecheck command on the default branch and confirm it exits successfully with no type errors and no new build artifacts.

### Implementation for User Story 1

- [X] T003 [P] [US1] Fix yargs builder options for echo command in `src/cli/commands/echo.ts`
- [X] T004 [P] [US1] Fix yargs builder options for greet command in `src/cli/commands/greet.ts`
- [X] T005 [US1] Update instruction sync types to export `InstructionSyncSummary` and resolve nullable string usage in `src/lib/instructions/sync.ts`
- [X] T006 [US1] Resolve sync command type issues (InstructionSyncSummary import, SubagentSyncResult status, yargs builder options) in `src/cli/commands/sync.ts`
- [X] T007 [US1] Update instruction target group definitions to include required values in `src/lib/instructions/targets.ts`
- [X] T008 [P] [US1] Align instruction catalog target group usage in `src/lib/instructions/catalog.ts`
- [X] T009 [P] [US1] Align instruction scan target group usage in `src/lib/instructions/scan.ts`
- [X] T010 [P] [US1] Align skills catalog target group usage in `src/lib/skills/catalog.ts`
- [X] T011 [P] [US1] Align slash-commands catalog target group usage in `src/lib/slash-commands/catalog.ts`
- [X] T012 [P] [US1] Align subagents catalog target group usage in `src/lib/subagents/catalog.ts`
- [X] T013 [US1] Run `npm run typecheck` per `package.json` to confirm no type errors

**Checkpoint**: User Story 1 fully functional and independently testable

---

## Phase 4: User Story 2 - Changes are guarded by automated checks (Priority: P2)

**Goal**: Pull requests and pushes run automated validation that surfaces pass/fail for each required step.

**Independent Test**: Open a pull request and observe automated validation runs and reports pass/fail for quality check, typecheck, tests, and build.

### Implementation for User Story 2

- [X] T014 [US2] Add GitHub Actions workflow with PR/push triggers and read-only fork permissions in `.github/workflows/ci.yml`
- [X] T015 [US2] Add CI job steps in order (npm ci, npm run check, npm run typecheck, npm test, npm run build) in `.github/workflows/ci.yml`

**Checkpoint**: User Story 2 validation workflow runs with required steps and reports status

---

## Phase 5: User Story 3 - Local and automated validation are aligned (Priority: P3)

**Goal**: Maintainers can reproduce automated validation outcomes locally using the same steps.

**Independent Test**: Run the same validation steps locally that automated validation uses and confirm results match outcomes for the same commit.

### Implementation for User Story 3

- [X] T016 [US3] Document local validation steps (check/typecheck/test/build) to mirror CI in `README.md`

**Checkpoint**: User Story 3 alignment documented and repeatable

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cleanup across stories

- [X] T017 Run full validation sequence (`npm run check`, `npm run typecheck`, `npm test`, `npm run build`) per `package.json`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS user story validation
- **User Story 1 (Phase 3)**: Depends on Foundational completion
- **User Story 2 (Phase 4)**: Can start after Foundational; final validation depends on User Story 1 to ensure green typecheck
- **User Story 3 (Phase 5)**: Best after User Story 2 to mirror CI steps
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational - no dependencies on other stories
- **User Story 2 (P2)**: Depends on US1 for a passing validation run
- **User Story 3 (P3)**: Depends on US2 for final CI step definitions

---

## Parallel Execution Examples

### User Story 1

```bash
Task: "Fix yargs builder options for echo command in src/cli/commands/echo.ts"
Task: "Fix yargs builder options for greet command in src/cli/commands/greet.ts"
Task: "Align instruction catalog target group usage in src/lib/instructions/catalog.ts"
Task: "Align instruction scan target group usage in src/lib/instructions/scan.ts"
Task: "Align skills catalog target group usage in src/lib/skills/catalog.ts"
Task: "Align slash-commands catalog target group usage in src/lib/slash-commands/catalog.ts"
Task: "Align subagents catalog target group usage in src/lib/subagents/catalog.ts"
```

### User Story 2

```bash
Task: "Add GitHub Actions workflow with PR/push triggers and read-only fork permissions in .github/workflows/ci.yml"
Task: "Add CI job steps in order (npm ci, npm run check, npm run typecheck, npm test, npm run build) in .github/workflows/ci.yml"
```

### User Story 3

```bash
Task: "Document local validation steps (check/typecheck/test/build) to mirror CI in README.md"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Run `npm run typecheck`

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. User Story 1 → validate local typecheck
3. User Story 2 → validate CI workflow
4. User Story 3 → document alignment and verify local/CI parity
5. Polish → full validation run

### Parallel Team Strategy

- One contributor can work on US1 type fixes while another sets up CI (US2) after Foundational completes.
- Documentation alignment (US3) can be done after CI steps are finalized.

---

## Notes

- [P] tasks = different files, no dependencies
- Story labels map tasks to user stories for traceability
- Tests are not included because they were not requested in the specification
