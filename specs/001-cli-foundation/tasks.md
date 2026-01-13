# Tasks: CLI Foundation

**Input**: Design documents from `/specs/001-cli-foundation/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md

**Tests**: Not requested in spec - skipped.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create project directory structure: `src/cli/`, `dist/`
- [X] T002 Initialize package.json with name "omniagent", type "module", bin field pointing to `./dist/cli.js`
- [X] T003 [P] Install runtime dependency: yargs
- [X] T004 [P] Install dev dependencies: typescript, vite, @types/yargs, @types/node
- [X] T005 [P] Create tsconfig.json with ES module target, strict mode, Node.js types in project root
- [X] T006 Create vite.config.ts with SSR library mode, entry `src/cli/index.ts`, external yargs, shebang banner in project root

**Checkpoint**: Build toolchain ready - can now implement CLI

---

## Phase 2: User Story 1 - Run CLI Command (Priority: P1) 🎯 MVP

**Goal**: A developer runs the omniagent CLI and sees a hello world response

**Independent Test**: Run `node dist/cli.js` and verify "Hello from omniagent!" appears

### Implementation for User Story 1

- [X] T007 [US1] Create CLI entry point with yargs setup (scriptName, version, help, default command) in src/cli/index.ts
- [X] T008 [US1] Create main export file in src/index.ts (re-exports for library use)
- [X] T009 [US1] Add build script to package.json: `"build": "vite build"`
- [X] T010 [US1] Build the CLI by running `npm run build`
- [X] T011 [US1] Verify CLI runs with `node dist/cli.js` and displays hello world message

**Checkpoint**: User Story 1 complete - CLI prints hello world

---

## Phase 3: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and cleanup

- [X] T012 Verify `--help` flag works: `node dist/cli.js --help`
- [X] T013 Verify `--version` flag works: `node dist/cli.js --version`
- [X] T014 Run quickstart.md validation (npm link and test `omniagent` command)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **User Story 1 (Phase 2)**: Depends on Setup completion
- **Polish (Phase 3)**: Depends on User Story 1 completion

### Within Phase 1 (Setup)

- T001 must complete first (creates directories)
- T002 must complete before T003, T004 (package.json needed for npm install)
- T003, T004, T005, T006 can run in parallel after T002

### Within Phase 2 (User Story 1)

- T007, T008 can run in parallel (different files)
- T009 depends on T007, T008 (need source files before build script)
- T010 depends on T009 (build script must exist)
- T011 depends on T010 (must build before running)

### Parallel Opportunities

```bash
# After T002 completes, run these in parallel:
T003: Install yargs
T004: Install dev dependencies
T005: Create tsconfig.json
T006: Create vite.config.ts

# After setup, run these in parallel:
T007: Create src/cli/index.ts
T008: Create src/index.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T006)
2. Complete Phase 2: User Story 1 (T007-T011)
3. **STOP and VALIDATE**: Run `node dist/cli.js` - should print hello world
4. Proceed to Polish (T012-T014)

### Success Criteria Verification

| Criteria | Task | Verification |
|----------|------|--------------|
| SC-001: `npm run build` produces working bundle | T010 | Build completes without errors |
| SC-002: Running omniagent displays output | T011 | "Hello from omniagent!" appears |
| SC-003: Only yargs runtime dependency | T003 | `npm ls --prod` shows only yargs |

---

## Notes

- [P] tasks = different files, no dependencies
- [US1] label maps task to User Story 1
- This is a minimal hello world - no complex dependencies
- Commit after each phase completion
- Total tasks: 14
