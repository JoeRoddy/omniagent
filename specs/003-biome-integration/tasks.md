---
description: "Task list for Biome integration implementation"
---

# Tasks: Biome Integration for Code Quality

**Input**: Design documents from `/specs/003-biome-integration/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: This feature includes integration tests to verify Biome functionality.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project structure**: `src/`, `tests/` at repository root
- Configuration files at repository root: `biome.json`, `package.json`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install Biome and create base configuration

- [X] T001 Install @biomejs/biome as devDependency in package.json
- [X] T002 Create biome.json configuration file at repository root with formatting and linting rules
- [X] T003 Update package.json with Biome npm scripts (format, format:check, lint, lint:check, check, fix)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None - this is a tooling feature with no blocking infrastructure needs. User stories can proceed immediately after Setup.

**Checkpoint**: Setup complete - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Automated Code Quality Checks (Priority: P1) 🎯 MVP

**Goal**: Integrate Biome checks into the build script so that code quality is automatically enforced during builds

**Independent Test**: Run `npm run build` with intentionally unformatted/linted code and verify that Biome checks execute, report issues, and prevent the build from completing successfully

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T004 [P] [US1] Create integration test file tests/biome-integration.test.ts for build integration tests
- [X] T005 [P] [US1] Write test case "should run Biome checks during build" that verifies `npm run build` executes Biome
- [X] T006 [P] [US1] Write test case "should fail build when formatting issues exist" that creates unformatted code and verifies build fails
- [X] T007 [P] [US1] Write test case "should fail build when linting issues exist" that creates code with lint errors and verifies build fails

### Implementation for User Story 1

- [X] T008 [US1] Update package.json build script to run `npm run check &&` before existing build command
- [X] T009 [US1] Verify Biome check command executes correctly and returns appropriate exit codes (0=pass, 1=fail)
- [X] T010 [US1] Test build integration by running `npm run build` on existing codebase
- [X] T011 [US1] Run `npm run fix` to format and fix existing code to establish clean baseline
- [X] T012 [US1] Verify all integration tests pass for User Story 1

**Checkpoint**: At this point, builds automatically include code quality checks. Users can run `npm run build` and see Biome enforce standards.

---

## Phase 4: User Story 2 - Manual Code Formatting (Priority: P2)

**Goal**: Enable developers to manually format code using Biome commands

**Independent Test**: Create a file with formatting issues, run `npm run format`, and verify the file is automatically formatted according to biome.json rules

### Tests for User Story 2

- [X] T013 [P] [US2] Create test file tests/biome-format.test.ts for format command tests
- [X] T014 [P] [US2] Write test case "should format unformatted code" that creates test file with formatting issues and verifies `npm run format` fixes them
- [X] T015 [P] [US2] Write test case "should not modify correctly formatted code" that verifies format command on clean code makes no changes
- [X] T016 [P] [US2] Write test case "should organize imports" that verifies import sorting and unused import removal

### Implementation for User Story 2

- [X] T017 [US2] Verify `npm run format` command (configured in T003) works correctly
- [X] T018 [US2] Test format command on sample unformatted TypeScript file in src/
- [X] T019 [US2] Verify format command respects biome.json configuration (line width, quotes, semicolons, indentation)
- [X] T020 [US2] Verify format command excludes ignored patterns (node_modules, dist, coverage, .specify)
- [X] T021 [US2] Verify all tests pass for User Story 2

**Checkpoint**: At this point, developers can manually format their code with `npm run format` before committing.

---

## Phase 5: User Story 3 - Code Quality Validation (Priority: P3)

**Goal**: Enable developers to check code quality without modifying files (dry-run validation)

**Independent Test**: Create files with quality issues, run `npm run check` (or format:check/lint:check), and verify issues are reported but no files are modified

### Tests for User Story 3

- [X] T022 [P] [US3] Create test file tests/biome-check.test.ts for check command tests
- [X] T023 [P] [US3] Write test case "should detect formatting issues without modifying files" that verifies format:check reports issues but makes no changes
- [X] T024 [P] [US3] Write test case "should detect linting issues without modifying files" that verifies lint:check reports issues but makes no changes
- [X] T025 [P] [US3] Write test case "should return success for compliant code" that verifies check commands return exit code 0 for clean code

### Implementation for User Story 3

- [X] T026 [US3] Verify `npm run format:check` command works correctly (read-only format check)
- [X] T027 [US3] Verify `npm run lint:check` command works correctly (read-only lint check)
- [X] T028 [US3] Verify `npm run check` command works correctly (combined check)
- [X] T029 [US3] Test check commands on files with intentional issues and verify no modifications occur
- [X] T030 [US3] Test check commands on clean files and verify exit code 0
- [X] T031 [US3] Verify all tests pass for User Story 3

**Checkpoint**: All user stories should now be independently functional. Developers have format, check, and build integration workflows.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, validation, and final touches

- [ ] T032 [P] Update README.md to mention Biome as the code quality tool
- [ ] T033 [P] Update CONTRIBUTING.md (if exists) with code quality workflow (format before commit)
- [X] T034 Verify quickstart.md instructions work correctly by following them step-by-step
- [X] T035 Run full test suite (`npm test`) to ensure no regressions
- [X] T036 Run final `npm run check` on entire codebase to verify all code meets standards
- [X] T037 Update AGENTS.md with Biome integration (already done during planning, verify accuracy)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: N/A for this feature (no blocking infrastructure)
- **User Stories (Phase 3+)**: All depend on Setup (Phase 1) completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Depends only on Setup (Phase 1) - build integration
- **User Story 2 (P2)**: Depends only on Setup (Phase 1) - format commands (independent of US1)
- **User Story 3 (P3)**: Depends only on Setup (Phase 1) - check commands (independent of US1 and US2)

All three user stories are completely independent and can be implemented in parallel after Setup.

### Within Each User Story

1. Tests written first (T004-T007, T013-T016, T022-T025)
2. Implementation tasks follow (T008-T012, T017-T021, T026-T031)
3. Tests must FAIL before implementation
4. Tests must PASS after implementation

### Parallel Opportunities

**Phase 1 (Setup)**: All 3 tasks (T001-T003) can run sequentially (same files: package.json, biome.json)

**User Story Tests**: Within each story, all test tasks marked [P] can be written in parallel:
- US1: T004, T005, T006, T007 (different test cases in same file - can write in parallel if structured properly)
- US2: T013, T014, T015, T016 (different test cases)
- US3: T022, T023, T024, T025 (different test cases)

**User Stories**: After Setup, all three user stories (Phase 3, 4, 5) can be worked on in parallel by different developers

**Polish**: Tasks T032, T033 can run in parallel (different documentation files)

---

## Parallel Example: All User Stories After Setup

```bash
# After Phase 1 (Setup) completes, launch all three user stories in parallel:

# Developer A: User Story 1 (Build Integration)
Task: "Create integration test file tests/biome-integration.test.ts"
Task: "Write test cases for build integration"
Task: "Update package.json build script"
Task: "Verify build integration works"

# Developer B: User Story 2 (Manual Formatting)
Task: "Create test file tests/biome-format.test.ts"
Task: "Write test cases for format command"
Task: "Verify format command works correctly"

# Developer C: User Story 3 (Quality Validation)
Task: "Create test file tests/biome-check.test.ts"
Task: "Write test cases for check commands"
Task: "Verify check commands work correctly"
```

---

## Parallel Example: User Story 1 Tests

```bash
# Launch all test-writing tasks for User Story 1 together:
Task: "Create integration test file tests/biome-integration.test.ts"
Task: "Write test case: should run Biome checks during build"
Task: "Write test case: should fail build when formatting issues exist"
Task: "Write test case: should fail build when linting issues exist"

# Then implement after tests are written and failing:
Task: "Update package.json build script"
Task: "Verify Biome check command executes correctly"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 3: User Story 1 (T004-T012)
3. **STOP and VALIDATE**: Run `npm run build` and verify Biome checks execute
4. Test with intentionally bad code and verify build fails
5. MVP is complete - builds now enforce code quality

### Incremental Delivery

1. Complete Setup (Phase 1) → Biome installed and configured
2. Add User Story 1 → Build integration → Test independently → **MVP COMPLETE**
3. Add User Story 2 → Format commands → Test independently → Enhanced developer workflow
4. Add User Story 3 → Check commands → Test independently → Full validation suite
5. Complete Polish → Documentation and final validation

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup (Phase 1) together (3 quick tasks)
2. Once Setup is done, split work:
   - **Developer A**: User Story 1 (Build integration) - 9 tasks
   - **Developer B**: User Story 2 (Format commands) - 9 tasks
   - **Developer C**: User Story 3 (Check commands) - 10 tasks
3. All stories complete independently and integrate seamlessly
4. Team reconvenes for Polish phase

---

## Task Count Summary

- **Phase 1 (Setup)**: 3 tasks
- **Phase 3 (US1)**: 9 tasks (4 tests + 5 implementation)
- **Phase 4 (US2)**: 9 tasks (4 tests + 5 implementation)
- **Phase 5 (US3)**: 10 tasks (4 tests + 6 implementation)
- **Phase 6 (Polish)**: 6 tasks
- **Total**: 37 tasks

### Per-Story Breakdown

- **User Story 1 (P1 - MVP)**: 9 tasks → Build integration with automated checks
- **User Story 2 (P2)**: 9 tasks → Manual formatting workflow
- **User Story 3 (P3)**: 10 tasks → Validation without modification
- **Overhead**: 9 tasks (setup + polish)

---

## Notes

- [P] tasks = different files/test cases, no dependencies
- [Story] label (US1, US2, US3) maps task to specific user story for traceability
- Each user story is independently completable and testable
- Tests must be written FIRST and FAIL before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- This is a tooling feature: no data models, no API contracts, just configuration and scripts
- All user stories are independent - no cross-story dependencies
- MVP (User Story 1) provides core value: automated quality checks in builds
