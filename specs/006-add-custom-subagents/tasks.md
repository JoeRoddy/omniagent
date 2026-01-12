---

description: "Task list for Sync Custom Subagents"
---

# Tasks: Sync Custom Subagents

**Input**: Design documents from `/specs/006-add-custom-subagents/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/
**Tests**: Not requested in spec; no test tasks included.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create subagent module scaffolding in `src/lib/subagents/index.ts` with new files `src/lib/subagents/catalog.ts`, `src/lib/subagents/manifest.ts`, `src/lib/subagents/targets.ts`, `src/lib/subagents/sync.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [x] T002 Implement strict frontmatter parsing + validation (invalid YAML, missing end marker, empty body) in `src/lib/subagents/catalog.ts`
- [x] T003 Implement subagent catalog loader in `src/lib/subagents/catalog.ts` (recursive scan of `agents/agents/`, error on non-.md files, resolve names, case-insensitive uniqueness, treat missing/empty dir as empty)
- [x] T004 [P] Implement subagent sync manifest read/write (TOML) in `src/lib/subagents/manifest.ts` for managed outputs tracking
- [x] T005 [P] Define target path mappings and defaults in `src/lib/subagents/targets.ts` (Claude subagent path + skill paths for others)
- [x] T006 Implement shared sync helpers + summary types in `src/lib/subagents/sync.ts` (hashing, existing file reads, action planning primitives)

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Sync subagents to Claude Code (Priority: P1) 🎯 MVP

**Goal**: Sync canonical subagents to Claude Code’s project-level subagent directory with managed updates/removals.

**Independent Test**: Add one subagent in `agents/agents/`, run sync for Claude only, verify `.claude/agents/<name>.md` is created/updated and summary reports actions.

### Implementation for User Story 1

- [x] T007 [US1] Implement Claude-target plan + apply actions (create/update/remove) in `src/lib/subagents/sync.ts`
- [x] T008 [US1] Wire subagent sync into CLI flow and summary output in `src/cli/commands/sync.ts`

---

## Phase 4: User Story 2 - Convert subagents to skills for unsupported targets (Priority: P2)

**Goal**: Convert subagents into skills for non-Claude targets by default and respect target filters.

**Independent Test**: Add one subagent and sync to Codex; verify `.codex/skills/<name>/SKILL.md` matches source content and summary reports conversion.

### Implementation for User Story 2

- [x] T009 [US2] Implement conversion outputs (write `SKILL.md` with raw contents) for unsupported targets in `src/lib/subagents/sync.ts`
- [x] T010 [US2] Add default conversion warnings + target filter handling in `src/cli/commands/sync.ts`

---

## Phase 5: User Story 3 - Predictable naming and conflict handling (Priority: P3)

**Goal**: Enforce deterministic names and safe conflict behavior with clear errors or warnings.

**Independent Test**: Create subagents with colliding names and conflicting target outputs; verify sync fails on name collisions and skips with warnings on target conflicts.

### Implementation for User Story 3

- [x] T011 [US3] Implement target conflict detection (different existing content) to skip + warn in `src/lib/subagents/sync.ts`
- [x] T012 [US3] Surface catalog validation errors (invalid frontmatter, non-md, empty content, name collisions) in `src/cli/commands/sync.ts`

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T013 [P] Update documentation for canonical subagents and sync behavior in `README.md`
- [x] T014 [P] Validate quickstart instructions and outputs in `specs/006-add-custom-subagents/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
- **Polish (Phase 6)**: Depends on desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational - no dependencies on other stories
- **User Story 2 (P2)**: Starts after Foundational - no dependency on US1, but shares sync helpers
- **User Story 3 (P3)**: Starts after Foundational - no dependency on US1/US2, but uses catalog parsing

### Parallel Opportunities

- **Phase 2**: T004 and T005 can run in parallel
- **Phase 6**: T013 and T014 can run in parallel

---

## Parallel Example: User Story 1

```bash
Task: "Implement Claude-target plan + apply actions in src/lib/subagents/sync.ts"
Task: "Then wire subagent sync into CLI flow in src/cli/commands/sync.ts"
```

---

## Parallel Example: User Story 2

```bash
Task: "Implement conversion outputs in src/lib/subagents/sync.ts"
Task: "Then add conversion warnings in src/cli/commands/sync.ts"
```

---

## Parallel Example: User Story 3

```bash
Task: "Implement conflict detection in src/lib/subagents/sync.ts"
Task: "Then surface catalog validation errors in src/cli/commands/sync.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Validate sync to Claude-only target

### Incremental Delivery

1. Add User Story 2 for conversion outputs
2. Add User Story 3 for naming/conflict handling
3. Finish Polish tasks for documentation and quickstart validation
