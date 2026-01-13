---

description: "Task list template for feature implementation"
---

# Tasks: Sync Custom Slash Commands

**Input**: Design documents from `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/005-sync-slash-commands/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Not requested in the feature specification.

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

- [X] T001 Create slash-command module barrel exports in `src/lib/slash-commands/index.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 Implement canonical catalog loader + Markdown/YAML parsing in `src/lib/slash-commands/catalog.ts`
- [X] T003 [P] Define target capability profiles + destination paths (Claude canonical) in `src/lib/slash-commands/targets.ts`
- [X] T004 [P] Implement target renderers (Claude Markdown, Gemini TOML, Codex Markdown) in `src/lib/slash-commands/formatting.ts`
- [X] T005 [P] Implement managed manifest read/write + diff helpers in `src/lib/slash-commands/manifest.ts`
- [X] T006 Implement core sync planning/apply logic + summary shaping in `src/lib/slash-commands/sync.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Sync commands to supported agents (Priority: P1) 🎯 MVP

**Goal**: Sync canonical Claude Code-format commands to supported agents (Claude + Gemini) with default local scope, conflict handling, and previews.

**Independent Test**: Run `sync-commands` with two commands and verify Claude/Gemini outputs are created at the default local scope with a correct summary.

### Implementation for User Story 1

- [X] T007 [US1] Implement CLI options + prompt flow (targets, conflicts, preview/confirm, --yes, --json) in `src/cli/commands/sync-commands.ts`
- [X] T008 [P] [US1] Register `sync-commands` in `src/cli/index.ts`
- [X] T009 [US1] Invoke sync engine + print per-target summary in `src/cli/commands/sync-commands.ts`

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Default fallback for unsupported agents (Priority: P2)

**Goal**: Provide a fallback path for unsupported agents (Copilot) via default skill conversion (skip by excluding the target).

**Independent Test**: Select Copilot in `sync-commands`, choose convert-to-skills, and verify skills are created with a conversion summary.

### Implementation for User Story 2

- [X] T010 [US2] Add unsupported-target default conversion in `src/cli/commands/sync-commands.ts`
- [X] T011 [US2] Implement slash-command-to-skill conversion + summary updates in `src/lib/slash-commands/sync.ts`

**Checkpoint**: User Story 2 should be independently testable with unsupported targets

---

## Phase 5: User Story 3 - Make the Codex-specific choice (Priority: P3)

**Goal**: Warn about Codex project-scope limits and offer global prompts or skill conversion.

**Independent Test**: Select Codex, observe warning, choose global prompts, and verify prompts are written under the Codex home directory with summary updates.

### Implementation for User Story 3

- [X] T012 [US3] Add Codex warning + option selection (global prompts vs convert to skills) in `src/cli/commands/sync-commands.ts`
- [X] T013 [US3] Implement Codex prompt writer + integration in `src/lib/slash-commands/formatting.ts`
- [X] T014 [US3] Apply Codex conversion defaults in `src/lib/slash-commands/sync.ts`

**Checkpoint**: User Story 3 should be independently testable for Codex flows

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T015 [P] Update docs for `sync-commands` + Claude canonical standard in `README.md`
- [X] T016 [P] Validate and adjust examples in `specs/005-sync-slash-commands/quickstart.md`
- [X] T017 [P] Add usage examples in `src/cli/commands/sync-commands.ts`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: Depend on Foundational completion
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational - no dependencies on other stories
- **User Story 2 (P2)**: Builds on the `sync-commands` flow from US1
- **User Story 3 (P3)**: Builds on the `sync-commands` flow from US1

### Within Each User Story

- CLI prompts before sync engine invocation
- Core sync implementation before summaries and docs

---

## Parallel Example: User Story 1

```bash
Task: "Register sync-commands in src/cli/index.ts"
Task: "Implement CLI options + prompt flow in src/cli/commands/sync-commands.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Run the US1 independent test

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deliver MVP
3. Add User Story 2 → Test independently → Deliver
4. Add User Story 3 → Test independently → Deliver

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Avoid cross-story dependencies that break independence
