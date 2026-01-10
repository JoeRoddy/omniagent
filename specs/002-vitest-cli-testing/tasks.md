# Tasks: Vitest CLI Testing

**Input**: Design documents from `/specs/002-vitest-cli-testing/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included - explicitly requested in feature specification (FR-003, FR-004, FR-005, SC-003)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root (per plan.md)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and Vitest configuration

- [X] T001 Install vitest as dev dependency via `npm install -D vitest`
- [X] T002 Create vitest.config.ts at repository root with node environment and TypeScript support
- [X] T003 Update package.json scripts: replace placeholder test script with `vitest run`, add `test:watch` script
- [X] T004 [P] Create tests/ directory structure: `mkdir -p tests/commands`
- [X] T005 [P] Add "vitest/globals" to tsconfig.json types array for global test APIs

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Command module infrastructure that all example commands will use

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T006 Create src/cli/commands/ directory for modular command structure
- [X] T007 Update src/cli/index.ts to import and register commands from commands/ directory

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Run Tests for CLI Commands (Priority: P1) 🎯 MVP

**Goal**: Developers can run `npm test` and see test results with pass/fail status

**Independent Test**: Run `npm test` and verify it executes tests and reports results

### Implementation for User Story 1

- [X] T008 [US1] Create a minimal placeholder test in tests/commands/smoke.test.ts to verify Vitest runs
- [X] T009 [US1] Verify `npm test` executes successfully and shows test summary
- [X] T010 [US1] Verify test failure reporting by temporarily breaking a test and checking error output

**Checkpoint**: User Story 1 complete - `npm test` works and reports pass/fail

---

## Phase 4: User Story 2 - Example CLI Commands (Priority: P2)

**Goal**: Provide 3 example CLI commands demonstrating common patterns (simple output, positional args, options/flags)

**Independent Test**: Run each command (`agentctl hello`, `agentctl greet Alice`, `agentctl echo "test"`) and verify output

### Implementation for User Story 2

- [X] T011 [P] [US2] Create hello command module in src/cli/commands/hello.ts (simple output, no args)
- [X] T012 [P] [US2] Create greet command module in src/cli/commands/greet.ts (required positional arg, --uppercase flag)
- [X] T013 [P] [US2] Create echo command module in src/cli/commands/echo.ts (optional arg, --times and --prefix options)
- [X] T014 [US2] Register all three commands in src/cli/index.ts
- [X] T015 [US2] Build project with `npm run build` and manually verify each command works

**Checkpoint**: User Story 2 complete - all 3 example commands functional via CLI

---

## Phase 5: User Story 3 - Test Coverage for Example Commands (Priority: P3)

**Goal**: Each example command has corresponding tests demonstrating testing patterns

**Independent Test**: Run `npm test` and verify all command tests pass with 2+ test cases per command

### Tests for User Story 3

- [X] T016 [P] [US3] Create tests/commands/hello.test.ts with happy path and help flag tests
- [X] T017 [P] [US3] Create tests/commands/greet.test.ts with happy path, uppercase option, and missing arg error tests
- [X] T018 [P] [US3] Create tests/commands/echo.test.ts with happy path, --times option, --prefix option, and invalid times error tests
- [X] T019 [US3] Remove placeholder smoke test from tests/commands/smoke.test.ts (no longer needed)
- [X] T020 [US3] Run full test suite and verify all tests pass

**Checkpoint**: User Story 3 complete - each command has 2+ tests demonstrating patterns

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and cleanup

- [X] T021 Verify test execution completes in under 30 seconds (SC-004)
- [X] T022 Review test output format for clarity (SC-005: pass/fail counts visible)
- [X] T023 Run quickstart.md validation: follow quickstart steps and verify they work

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational - establishes testing works
- **User Story 2 (Phase 4)**: Depends on Foundational - creates commands to test
- **User Story 3 (Phase 5)**: Depends on User Story 2 (needs commands to test)
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Can run in parallel with US1
- **User Story 3 (P3)**: Depends on User Story 2 (needs commands to exist before testing them)

### Within Each User Story

- Models/modules before integration
- Build before manual verification
- All tests for a story can run in parallel

### Parallel Opportunities

- Setup tasks T004 and T005 can run in parallel
- User Story 2 commands (T011, T012, T013) can all be created in parallel
- User Story 3 tests (T016, T017, T018) can all be created in parallel
- User Stories 1 and 2 can run in parallel after Foundational phase

---

## Parallel Example: User Story 2

```bash
# Launch all command modules together:
Task: "Create hello command module in src/cli/commands/hello.ts"
Task: "Create greet command module in src/cli/commands/greet.ts"
Task: "Create echo command module in src/cli/commands/echo.ts"
```

## Parallel Example: User Story 3

```bash
# Launch all test files together:
Task: "Create tests/commands/hello.test.ts"
Task: "Create tests/commands/greet.test.ts"
Task: "Create tests/commands/echo.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (Vitest installed, configured)
2. Complete Phase 2: Foundational (command structure ready)
3. Complete Phase 3: User Story 1 (`npm test` works)
4. **STOP and VALIDATE**: Verify test runner works
5. Proceed to User Story 2

### Incremental Delivery

1. Setup + Foundational → Testing infrastructure ready
2. User Story 1 → `npm test` works → Verify
3. User Story 2 → Example commands work → Verify CLI
4. User Story 3 → All commands tested → Full coverage
5. Polish → Performance and documentation validation

### Recommended Execution

Since US3 depends on US2, the recommended order is:
1. Phase 1 (Setup)
2. Phase 2 (Foundational)
3. Phase 3 (US1) and Phase 4 (US2) in parallel
4. Phase 5 (US3) - after US2 complete
5. Phase 6 (Polish)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Tests use direct `runCli()` invocation pattern from research.md
- Mock `console.log` to capture output, mock `process.exit` for error cases
- Commands follow contracts in contracts/cli-commands.md
- Commit after each task or logical group
