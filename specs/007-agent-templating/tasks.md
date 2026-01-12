---

description: "Task list for Agent-Specific Templating implementation"
---

# Tasks: Agent-Specific Templating

**Input**: Design documents from `/specs/007-agent-templating/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Not requested in the spec; no test tasks included.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and shared scaffolding

- [X] T001 Create shared templating module scaffold in `src/lib/agent-templating.ts` (export API + error type)
- [X] T002 [P] Extract reusable frontmatter parsing helpers into `src/lib/slash-commands/frontmatter.ts` and update `src/lib/slash-commands/catalog.ts` to use them

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Implement agent-templating parsing/validation in `src/lib/agent-templating.ts` (selectors, `not:`, case-insensitive match, `\</agents>` escaping, multi-line, invalid cases)
- [X] T004 [P] Add preflight templating validation in `src/cli/commands/sync.ts` to scan `agents/commands/`, `agents/agents/`, and `agents/skills/` for selected targets before any sync writes

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Include or Exclude Agent-Specific Blocks (Priority: P1) 🎯 MVP

**Goal**: Users can place scoped blocks anywhere in config files and get correct per-agent outputs.

**Independent Test**: Sync a single config file for two agents and verify scoped blocks are included/excluded correctly.

### Implementation for User Story 1

- [X] T005 [P] [US1] Apply `applyAgentTemplating` per target when rendering slash commands in `src/lib/slash-commands/sync.ts` using helpers from `src/lib/slash-commands/frontmatter.ts`
- [X] T006 [P] [US1] Apply templating to subagent outputs in `src/lib/subagents/sync.ts` before writing or conversion
- [X] T007 [P] [US1] Add templating-aware copy in `src/lib/sync-copy.ts` and switch `syncSkills` in `src/cli/commands/sync.ts` to use it per target

**Checkpoint**: User Story 1 fully functional and testable independently

---

## Phase 4: User Story 2 - Consistent Behavior Across All Syncable Features (Priority: P2)

**Goal**: The same templating rules are documented and consistently applied across commands, skills, and subagents.

**Independent Test**: Sync commands, skills, and subagents for one agent and verify identical include/exclude behavior.

### Implementation for User Story 2

- [X] T008 [P] [US2] Document templating support and syntax in `README.md` under Skills, Subagents, and Slash commands
- [X] T009 [P] [US2] Add manual note in `AGENTS.md` (between MANUAL ADDITIONS markers) that templating applies to all syncable features and future features must support it

**Checkpoint**: Documentation reflects universal templating support

---

## Phase 5: User Story 3 - Safe Handling of Invalid or Unknown Selectors (Priority: P3)

**Goal**: Invalid selectors fail the entire sync run with clear errors and no outputs changed.

**Independent Test**: Introduce an invalid selector and confirm sync fails with valid identifiers listed and no outputs written.

### Implementation for User Story 3

- [X] T010 [P] [US3] Propagate `AgentTemplatingError` as a hard failure in `src/lib/slash-commands/sync.ts` and `src/lib/subagents/sync.ts` (abort plan/apply on error)
- [X] T011 [P] [US3] Ensure `src/cli/commands/sync.ts` surfaces valid agent identifiers when templating validation fails

**Checkpoint**: Invalid selectors reliably stop the full sync with actionable errors

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Cross-story polish and documentation validation

- [X] T012 [P] Validate examples against implementation and adjust `specs/007-agent-templating/quickstart.md` if needed

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can proceed in parallel or sequentially (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational; no dependency on other stories
- **User Story 2 (P2)**: Starts after Foundational; no dependency on other stories
- **User Story 3 (P3)**: Starts after Foundational; no dependency on other stories

---

## Parallel Execution Examples

### User Story 1

- Task: "Apply templating to slash commands" in `src/lib/slash-commands/sync.ts`
- Task: "Apply templating to subagents" in `src/lib/subagents/sync.ts`
- Task: "Templating-aware skills copy" in `src/lib/sync-copy.ts`

### User Story 2

- Task: "Document templating in README" in `README.md`
- Task: "Add universal templating note" in `AGENTS.md`

### User Story 3

- Task: "Propagate templating errors" in `src/lib/slash-commands/sync.ts` and `src/lib/subagents/sync.ts`
- Task: "Surface valid identifiers in sync errors" in `src/cli/commands/sync.ts`

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Validate User Story 1 independently

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. User Story 1 → Validate → MVP ready
3. User Story 2 → Validate docs and consistency
4. User Story 3 → Validate fail-fast behavior
5. Polish → Validate quickstart examples

---

## Notes

- [P] tasks = different files, no dependencies
- Story labels map tasks to user stories for traceability
- Each user story should be independently completable and testable
- Avoid cross-story coupling unless required by validation flow
