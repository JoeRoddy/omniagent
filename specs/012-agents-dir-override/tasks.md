---

description: "Task list template for feature implementation"
---

# Tasks: Custom Agents Directory Override

**Input**: Design documents from `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/012-agents-dir-override/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Not requested in the feature specification; no test tasks included.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Create shared agents directory helper with default constant in `src/lib/agents-dir.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T002 Update `src/lib/local-sources.ts` to resolve shared/local roots from a passed-in agents directory
- [ ] T003 Update `src/lib/ignore-rules.ts` to build ignore rules from the agents directory instead of hardcoded `agents/`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Preserve default behavior (Priority: P1) 🎯 MVP

**Goal**: Default behavior remains unchanged and continues to use the existing `agents/` directory.

**Independent Test**: Run a command without `--agentsDir` and verify all reads/writes stay in the default `agents/` directory.

### Implementation for User Story 1

- [ ] T004 [P] [US1] Add `agentsDir` option plumbing to skills catalog/sync in `src/lib/skills/catalog.ts` and `src/lib/skills/sync.ts`
- [ ] T005 [P] [US1] Add `agentsDir` option plumbing to slash command catalog/sync in `src/lib/slash-commands/catalog.ts` and `src/lib/slash-commands/sync.ts`
- [ ] T006 [P] [US1] Add `agentsDir` option plumbing to subagent catalog/sync in `src/lib/subagents/catalog.ts` and `src/lib/subagents/sync.ts`
- [ ] T007 [P] [US1] Add `agentsDir` option plumbing to instruction catalog/scan/sync in `src/lib/instructions/catalog.ts`, `src/lib/instructions/scan.ts`, and `src/lib/instructions/sync.ts`
- [ ] T008 [US1] Resolve default agents directory and replace hardcoded `agents/` joins in `src/cli/commands/sync.ts`

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Use a custom agents directory (Priority: P2)

**Goal**: Users can override the agents directory via `--agentsDir` and all operations use that directory.

**Independent Test**: Run a command with `--agentsDir` and verify all reads/writes stay within the custom directory; invalid paths error.

### Implementation for User Story 2

- [ ] T009 [US2] Add `agentsDir` to `SyncArgs` and yargs options in `src/cli/commands/sync.ts` with default `agents/` described
- [ ] T010 [US2] Extend `src/lib/agents-dir.ts` to resolve overrides (relative to repo root) and return validation errors
- [ ] T011 [US2] Validate `--agentsDir` override and surface clear errors in `src/cli/commands/sync.ts`, then pass resolved path to all sync flows

**Checkpoint**: User Stories 1 AND 2 should now work independently

---

## Phase 5: User Story 3 - Discover the override option (Priority: P3)

**Goal**: Users can find the `--agentsDir` option and its default via help or documentation.

**Independent Test**: View CLI help or README and confirm the option and default are described.

### Implementation for User Story 3

- [ ] T012 [US3] Add `--agentsDir` usage example and description in `src/cli/commands/sync.ts`
- [ ] T013 [P] [US3] Document `--agentsDir` in `README.md` (usage section, default path, relative resolution base)

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T014 [P] Verify quickstart instructions against actual CLI behavior and adjust `README.md` if needed

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Requires US1’s plumbing for default path behavior
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - No dependencies on other stories

### Parallel Opportunities

- All [P] tasks in Phase 3 (T004–T007) can run in parallel after Phase 2 completes
- T013 can run in parallel with Phase 4 tasks (documentation only)
- T014 can run after User Stories complete without blocking other work

---

## Parallel Example: User Story 1

```bash
Task: "Add agentsDir option plumbing to skills catalog/sync in src/lib/skills/catalog.ts and src/lib/skills/sync.ts"
Task: "Add agentsDir option plumbing to slash command catalog/sync in src/lib/slash-commands/catalog.ts and src/lib/slash-commands/sync.ts"
Task: "Add agentsDir option plumbing to subagent catalog/sync in src/lib/subagents/catalog.ts and src/lib/subagents/sync.ts"
Task: "Add agentsDir option plumbing to instruction catalog/scan/sync in src/lib/instructions/catalog.ts, src/lib/instructions/scan.ts, and src/lib/instructions/sync.ts"
```

---

## Parallel Example: User Story 2

```bash
Task: "Add agentsDir to SyncArgs and yargs options in src/cli/commands/sync.ts"
Task: "Extend src/lib/agents-dir.ts to resolve overrides and validation errors"
```

---

## Parallel Example: User Story 3

```bash
Task: "Document --agentsDir in README.md (usage section, default path, relative resolution base)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Demo
3. Add User Story 2 → Test independently → Demo
4. Add User Story 3 → Test independently → Demo
5. Polish & cross-cutting updates

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
