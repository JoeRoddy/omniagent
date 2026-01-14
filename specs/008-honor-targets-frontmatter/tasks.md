---

description: "Task list for Honor Targets Frontmatter"
---

# Tasks: Honor Targets Frontmatter

**Input**: Design documents from `/specs/008-honor-targets-frontmatter/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Not requested in the specification; omit test tasks.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing
of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared utilities used by all stories

- [X] T001 Add target normalization + validation helpers in `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/sync-targets.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core plumbing needed before any user story work

- [X] T002 [P] Extend slash command catalog to combine `targets`/`targetAgents` and track invalids in `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/slash-commands/catalog.ts`
- [X] T003 [P] Extend subagent catalog to parse `targets`/`targetAgents` defaults + invalids in `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/subagents/catalog.ts`
- [X] T004 [P] Add skill catalog loader to parse `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/agents/skills/**/SKILL.md` targets in `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/skills/catalog.ts`
- [X] T005 Add effective target resolution helper (defaults + `--only`/`--skip`) in `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/sync-targets.ts`

**Checkpoint**: Target normalization and catalogs ready; user story work can begin

---

## Phase 3: User Story 1 - Default per-file targeting (Priority: P1) 🎯 MVP

**Goal**: Per-file frontmatter defaults determine sync targets when no CLI override is provided.

**Independent Test**: Create one skill, subagent, and slash command with explicit targets and run
sync without overrides; outputs appear only for those targets.

### Implementation for User Story 1

- [X] T006 [P] [US1] Apply per-file target defaults for slash commands in `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/slash-commands/sync.ts`
- [X] T007 [P] [US1] Apply per-file target defaults for subagents in `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/subagents/sync.ts`
- [X] T008 [US1] Implement per-file skill selection in `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/skills/sync.ts` and wire it into `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/cli/commands/sync.ts`

**Checkpoint**: Default targeting works across skills, subagents, and slash commands

---

## Phase 4: User Story 2 - Override targets per run (Priority: P2)

**Goal**: CLI `--only` overrides frontmatter defaults and `--skip` filters the active target set.

**Independent Test**: Use files with targets set, run sync with `--only` and `--skip`, and confirm
outputs match override behavior.

### Implementation for User Story 2

- [X] T009 [US2] Pass raw `--only`/`--skip` lists through `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/cli/commands/sync.ts` into skill, subagent, and command sync calls
- [X] T010 [P] [US2] Update slash command selection to ignore defaults when `--only` is set and apply `--skip` after base in `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/slash-commands/sync.ts`
- [X] T011 [P] [US2] Update subagent selection to ignore defaults when `--only` is set and apply `--skip` after base in `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/subagents/sync.ts`
- [X] T012 [US2] Update skill selection to honor `--only`/`--skip` in `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/skills/sync.ts`

**Checkpoint**: CLI overrides deterministically replace/filter per-file defaults

---

## Phase 5: User Story 3 - Handle mixed or invalid targets (Priority: P3)

**Goal**: Mixed fields are combined, unsupported targets are reported, and outputs strip target
metadata.

**Independent Test**: Add invalid targets and mixed `targets`/`targetAgents`, run sync, and verify
warnings plus correct output filtering.

### Implementation for User Story 3

- [X] T013 [P] [US3] Surface invalid-target warnings for slash commands in `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/slash-commands/sync.ts`
- [X] T014 [P] [US3] Surface invalid-target warnings for subagents and skills in `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/subagents/sync.ts` and `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/skills/sync.ts`, then print them in `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/cli/commands/sync.ts`
- [X] T015 [US3] Strip `targets`/`targetAgents` from all generated outputs in `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/slash-commands/formatting.ts`, `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/subagents/sync.ts`, and `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/skills/sync.ts`

**Checkpoint**: Invalid targets are visible to users and target metadata is removed from outputs

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation and verification

- [X] T016 [P] Document targets for skills/subagents and override behavior in `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/README.md`
- [X] T017 Run quickstart steps and update `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/specs/008-honor-targets-frontmatter/quickstart.md` if needed

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
- **Polish (Phase 6)**: Depends on completion of desired user stories

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational - no dependency on other stories
- **User Story 2 (P2)**: Can start after Foundational - no dependency on other stories
- **User Story 3 (P3)**: Can start after Foundational - no dependency on other stories

### Parallel Opportunities

- T002, T003, T004 can run in parallel after T001
- T006, T007 can run in parallel for US1
- T010, T011 can run in parallel for US2
- T013, T014 can run in parallel for US3

---

## Parallel Example: User Story 1

```bash
Task: "Apply per-file target defaults for slash commands in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/slash-commands/sync.ts"
Task: "Apply per-file target defaults for subagents in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/subagents/sync.ts"
```

---

## Parallel Example: User Story 2

```bash
Task: "Update slash command selection to ignore defaults when --only is set in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/slash-commands/sync.ts"
Task: "Update subagent selection to ignore defaults when --only is set in /Users/joeroddy/Documents/dev/projects/open-source/agentctl/src/lib/subagents/sync.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Validate default per-file targeting across all three feature types

### Incremental Delivery

1. Setup + Foundational → Shared targeting utilities ready
2. User Story 1 → Default per-file targeting
3. User Story 2 → CLI override behavior
4. User Story 3 → Invalid target warnings + metadata stripping
5. Polish → Docs and quickstart verification
