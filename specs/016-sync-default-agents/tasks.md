---

description: "Task list for Sync Default Agent Generation"
---

# Tasks: Sync Default Agent Generation

**Input**: Design documents from `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/016-sync-default-agents/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Not requested in the feature specification; no test tasks included.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm existing target metadata supports availability detection

- [X] T001 Ensure each built-in target declares a CLI command in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/targets/builtins/codex/target.ts`, `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/targets/builtins/claude-code/target.ts`, `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/targets/builtins/gemini-cli/target.ts`, and `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/targets/builtins/copilot-cli/target.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared availability detection utilities required by all stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 Add CLI-on-PATH availability detection helper in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/targets/availability.ts`
- [X] T003 Export availability helper from `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/targets/index.ts`

**Checkpoint**: Availability detection utilities are ready for sync command integration

---

## Phase 3: User Story 1 - Default to installed agents (Priority: P1) 🎯 MVP

**Goal**: Default `sync` to only targets with detected CLIs and clearly report skipped targets

**Independent Test**: Run `sync` with no explicit target filter on a machine with a known set of installed agent CLIs and confirm only those targets are synced with clear skip reasons for unavailable targets.

### Implementation for User Story 1

- [X] T004 [US1] Compute availability (available/unavailable + reasons) for resolved targets when `--only` is not provided in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts`
- [X] T005 [US1] Apply availability-filtered targets as the default selection and retain skip reasons for unavailable targets in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts`
- [X] T006 [US1] Surface availability skips and warnings in human and JSON summaries in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts`

**Checkpoint**: User Story 1 is fully functional and independently testable

---

## Phase 4: User Story 2 - Explicitly request unavailable targets (Priority: P2)

**Goal**: Explicit target lists override availability detection

**Independent Test**: Run `sync --only <target>` where the target CLI is not on `PATH` and confirm it is still synced.

### Implementation for User Story 2

- [X] T007 [US2] Bypass availability filtering when `--only` is provided and ensure explicit targets are selected in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts`
- [X] T008 [US2] Preserve existing unknown-target validation and summary behavior for explicit targets in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts`

**Checkpoint**: User Stories 1 and 2 are independently functional

---

## Phase 5: User Story 3 - No available targets (Priority: P3)

**Goal**: Successful no-op when no targets are available and no explicit list is provided

**Independent Test**: Run `sync` on a machine with no supported agent CLIs on `PATH` and confirm it exits successfully with an actionable message and no output changes.

### Implementation for User Story 3

- [ ] T009 [US3] When no targets are available and no explicit list is provided, exit successfully with a clear message and no sync actions in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts`
- [ ] T010 [US3] Leave previously synced outputs untouched by ensuring unavailable targets are excluded from sync/remove flows and clearly marked as skipped in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts`

**Checkpoint**: All user stories are independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: User-facing clarity and validation

- [ ] T011 [P] Update `sync` help/examples to mention availability-based default selection in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts`
- [ ] T012 [P] Validate and adjust steps in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/016-sync-default-agents/quickstart.md`

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
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Independent of US1 once availability logic exists
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Depends on availability logic and selection flow

### Within Each User Story

- Availability computation before selection
- Selection before summary/warnings
- Message/summary updates before finishing the story

### Parallel Opportunities

- Phase 1 and 2 are sequential
- After Phase 2 completes, US1/US2/US3 can proceed in parallel if staffed
- Polish tasks T011 and T012 can run in parallel

---

## Parallel Examples

### User Story 1

No parallelizable tasks within US1 because all changes are concentrated in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts`.

### User Story 2

No parallelizable tasks within US2 because both tasks update `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts`.

### User Story 3

No parallelizable tasks within US3 because both tasks update `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts`.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Validate independently (MVP)
3. Add User Story 2 → Validate independently
4. Add User Story 3 → Validate independently
5. Finish Polish phase

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Avoid cross-story dependencies that break independence
