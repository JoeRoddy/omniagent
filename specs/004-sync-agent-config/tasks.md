---

description: "Task list for Sync Agent Config"
---

# Tasks: Sync Agent Config

**Input**: Design documents from `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/specs/004-sync-agent-config/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Added coverage for sync command behavior and error paths.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Each task includes an exact file path

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create sync command module scaffold in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/cli/commands/sync.ts
- [X] T002 Register sync command in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/cli/index.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 [P] Define supported target names and destination mapping in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/sync-targets.ts
- [X] T004 [P] Implement repo root discovery helper in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/repo-root.ts

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Sync all target agents (Priority: P1) 🎯 MVP

**Goal**: Sync the canonical agent config to all supported targets when no filters are provided.

**Independent Test**: Run `agentctl sync` from a repo subdirectory and verify each target is updated and reported.

### Implementation for User Story 1

- [X] T005 [P] [US1] Implement non-destructive copy helper in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/sync-copy.ts
- [X] T006 [P] [US1] Implement sync result formatting (human + JSON) in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/sync-results.ts
- [X] T007 [US1] Implement core sync flow in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/cli/commands/sync.ts (resolve repo root, validate source, sync all targets, continue after failures, set exit code, support --json)

**Checkpoint**: User Story 1 is fully functional and independently testable

---

## Phase 4: User Story 2 - Selective sync by target (Priority: P2)

**Goal**: Allow users to include or exclude specific targets with `--skip` or `--only`.

**Independent Test**: Run `agentctl sync --skip codex` and `agentctl sync --only claude` and verify only intended targets update.

### Implementation for User Story 2

- [X] T008 [US2] Add `--skip`/`--only` parsing and filtering logic in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/cli/commands/sync.ts
- [X] T009 [US2] Validate unknown targets, conflicting flags, and empty selection with clear errors in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/cli/commands/sync.ts

**Checkpoint**: User Story 2 is fully functional and independently testable

---

## Phase 5: User Story 3 - Help and error feedback (Priority: P3)

**Goal**: Provide clear help text and actionable error messages for sync usage.

**Independent Test**: Run `agentctl sync --help` and a missing-source scenario to confirm output clarity.

### Implementation for User Story 3

- [X] T010 [US3] Update sync help text and examples in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/cli/commands/sync.ts (include supported targets and flags)
- [X] T011 [US3] Ensure missing source errors include the resolved path in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/cli/commands/sync.ts

**Checkpoint**: User Story 3 is fully functional and independently testable

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T012 [P] Validate quickstart steps and align examples in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/specs/004-sync-agent-config/quickstart.md
- [X] T013 [P] Review CLI error formatting for sync in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/cli/index.ts
- [X] T014 [P] Add sync command tests in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/tests/commands/sync.test.ts
- [X] T015 [P] Resolve repo root via repo markers so missing-source errors use repo-root paths in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/repo-root.ts and /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/cli/commands/sync.ts

---

## Dependencies & Execution Order

### Dependency Graph

Setup → Foundational → US1 → US2 → US3 → Polish

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: Depend on Foundational phase completion
- **Polish (Phase 6)**: Depends on desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational tasks
- **US2 (P2)**: Depends on US1 (extends core sync command flow)
- **US3 (P3)**: Depends on US1 (extends sync command help/errors)

---

## Parallel Execution Examples

### User Story 1

```bash
Task: "Implement non-destructive copy helper in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/sync-copy.ts"
Task: "Implement sync result formatting (human + JSON) in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/sync-results.ts"
```

### User Story 2

```bash
No safe parallel tasks identified (both tasks modify /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/cli/commands/sync.ts)
```

### User Story 3

```bash
No safe parallel tasks identified (both tasks modify /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/cli/commands/sync.ts)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → MVP ready
3. Add User Story 2 → Test independently
4. Add User Story 3 → Test independently
5. Apply Polish tasks for documentation and consistency

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Avoid cross-story dependencies beyond those listed in the dependency graph
