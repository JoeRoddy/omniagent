---

description: "Task list for implementing shared + local config sync"
---

# Tasks: Shared and Local Config Sync

**Input**: Design documents from `/specs/009-local-config-sync/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Not requested in the feature specification. No test tasks included.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Includes exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and shared utilities

- [X] T001 Create local source helper utilities in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/local-sources.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core source discovery that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 [P] Load shared + local skills with source metadata in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/skills/catalog.ts`
- [X] T003 [P] Load shared + local commands with normalized names in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/slash-commands/catalog.ts`
- [X] T004 [P] Load shared + local subagents with normalized names in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/subagents/catalog.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Default sync includes local overrides (Priority: P1) 🎯 MVP

**Goal**: Default sync uses local overrides and produces clean output names without `.local`.

**Independent Test**: Run `omniagent sync` with shared + local entries and verify local wins and outputs contain no `.local`.

### Implementation for User Story 1

- [X] T005 [P] [US1] Extend shared sync summary types for shared/local counts in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/sync-results.ts`
- [X] T006 [P] [US1] Apply local precedence and count shared/local skills in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/skills/sync.ts`
- [X] T007 [P] [US1] Apply local precedence and normalize command outputs in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/slash-commands/sync.ts`
- [X] T008 [P] [US1] Apply local precedence and normalize subagent outputs in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/subagents/sync.ts`
- [X] T009 [US1] Surface shared/local counts in sync summaries (JSON + text) in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts`

**Checkpoint**: User Story 1 is fully functional and independently testable

---

## Phase 4: User Story 2 - Shared-only sync for team checks (Priority: P2)

**Goal**: Allow excluding local sources entirely or by category for shared-only validation.

**Independent Test**: Run `omniagent sync --exclude-local` and `--exclude-local=skills,commands` and verify outputs exclude local sources.

### Implementation for User Story 2

- [X] T010 [US2] Add `--exclude-local` option parsing and validation in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts`
- [X] T011 [US2] Filter local skills when excluded in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/skills/sync.ts`
- [X] T012 [US2] Filter local commands when excluded in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/slash-commands/sync.ts`
- [X] T013 [US2] Filter local subagents when excluded in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/subagents/sync.ts`

**Checkpoint**: User Stories 1 and 2 are independently functional

---

## Phase 5: User Story 3 - Inspect local items and ignore guidance (Priority: P3)

**Goal**: List local items and safely offer ignore-rule updates with per-project suppression.

**Independent Test**: Run `omniagent sync --list-local` and verify local items are listed; run `omniagent sync` to confirm ignore prompts are offered once per project.

### Implementation for User Story 3

- [X] T014 [US3] Implement `--list-local` output flow in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts`
- [X] T015 [P] [US3] Detect and append ignore rules in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/ignore-rules.ts`
- [X] T016 [P] [US3] Persist per-project ignore prompt preference in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/ignore-preferences.ts`
- [X] T017 [US3] Wire ignore prompt suppression + non-interactive behavior in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts`

**Checkpoint**: All user stories are independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation and alignment tasks spanning multiple stories

- [X] T018 [P] Update sync CLI help/examples in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/sync.ts`
- [X] T019 [P] Document local config behavior in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/README.md`
- [X] T020 [P] Align quickstart notes with current behavior in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/009-local-config-sync/quickstart.md`

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

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - no dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - relies on US1 summary structure but is independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - relies on local catalog metadata but is independently testable

### Within Each User Story

- Catalog updates from Foundational phase must be complete
- Core implementation before CLI wiring
- Story complete before moving to next priority (for MVP sequencing)

---

## Parallel Example: User Story 1

```bash
Task: "Extend shared sync summary types for shared/local counts in /Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/sync-results.ts"
Task: "Apply local precedence and count shared/local skills in /Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/skills/sync.ts"
Task: "Apply local precedence and normalize command outputs in /Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/slash-commands/sync.ts"
Task: "Apply local precedence and normalize subagent outputs in /Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/subagents/sync.ts"
```

---

## Parallel Example: User Story 2

```bash
Task: "Filter local skills when excluded in /Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/skills/sync.ts"
Task: "Filter local commands when excluded in /Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/slash-commands/sync.ts"
Task: "Filter local subagents when excluded in /Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/subagents/sync.ts"
```

---

## Parallel Example: User Story 3

```bash
Task: "Detect and append ignore rules in /Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/ignore-rules.ts"
Task: "Persist per-project ignore prompt preference in /Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/ignore-preferences.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Run `omniagent sync` against shared + local fixtures

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Validate independently → MVP
3. Add User Story 2 → Validate independently
4. Add User Story 3 → Validate independently
5. Complete Polish tasks

---

## Notes

- [P] tasks = different files, no dependencies
- Each user story is independently completable and testable
- Avoid cross-story dependencies that break independence
