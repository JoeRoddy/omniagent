---

description: "Task list for Instruction File Sync"
---

# Tasks: Instruction File Sync

**Input**: Design documents from `/specs/010-instruction-file-sync/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Not requested in the feature specification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish instruction sync module structure and shared types

- [X] T001 Create instruction source/output types in `src/lib/instructions/types.ts`
- [X] T002 [P] Add target filename mapping helpers in `src/lib/instructions/targets.ts`
- [X] T003 [P] Export instruction modules from `src/lib/instructions/index.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Cross-feature prerequisites required before any user story work

- [X] T004 Create shared local precedence helper in `src/lib/local-precedence.ts`
- [X] T005 [P] Refactor slash command local precedence to helper in `src/lib/slash-commands/catalog.ts`
- [X] T006 [P] Refactor subagent local precedence to helper in `src/lib/subagents/catalog.ts`
- [X] T007 [P] Refactor skills local precedence to helper in `src/lib/skills/sync.ts`
- [X] T008 Add instruction category handling in `src/lib/local-sources.ts`
- [X] T009 Update exclude-local, list-local, and local detection for instructions in `src/cli/commands/sync.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Sync repo instruction sources (Priority: P1) 🎯 MVP

**Goal**: Repo `AGENTS.md` files outside `/agents` act as plain-text sources and generate target
outputs next to them without modifying the originals.

**Independent Test**: Run sync on a repo with `docs/AGENTS.md` outside `/agents` and targets
Claude+Gemini; verify `docs/CLAUDE.md` and `docs/GEMINI.md` are created and `docs/AGENTS.md` is
unchanged (Codex/Copilot selected should still leave the source file untouched).

### Implementation for User Story 1

- [X] T010 [P] [US1] Implement repo `AGENTS.md` walker with `.gitignore` + skip list in `src/lib/instructions/scan.ts`
- [X] T011 [P] [US1] Implement repo output path resolver per target in `src/lib/instructions/paths.ts`
- [X] T012 [US1] Integrate repo source discovery + output generation in `src/lib/instructions/sync.ts`
- [X] T013 [US1] Ensure repo `AGENTS.md` satisfies Codex/Copilot output without overwrite in `src/lib/instructions/sync.ts`

**Checkpoint**: User Story 1 delivers repo-based instruction outputs end-to-end

---

## Phase 4: User Story 2 - Use `/agents` templates for advanced control (Priority: P2)

**Goal**: `/agents/**` templates (including non-prefixed `AGENTS.md`) generate outputs to
`outPutPath` directories with templating, and override repo sources for the same output path/target.

**Independent Test**: Add `/agents/AGENTS.md` and root `AGENTS.md`, run sync for Claude, and verify
`CLAUDE.md` is generated from `/agents/AGENTS.md`; add `/agents/sub/foo.AGENTS.md` with `outPutPath:
"docs/"` and confirm outputs land in `docs/` with the filename portion stripped.

### Implementation for User Story 2

- [X] T014 [P] [US2] Implement frontmatter parsing + `outPutPath` normalization in `src/lib/instructions/frontmatter.ts`
- [X] T015 [P] [US2] Implement `/agents/**` template discovery (including non-prefixed `AGENTS.md`) in `src/lib/instructions/catalog.ts`
- [X] T016 [US2] Apply templating + strip metadata for template outputs in `src/lib/instructions/sync.ts`
- [X] T017 [US2] Resolve template-over-repo precedence and overwrite behavior in `src/lib/instructions/sync.ts`

**Checkpoint**: User Story 2 delivers templated outputs with deterministic precedence

---

## Phase 5: User Story 3 - Safe cleanup and visibility (Priority: P3)

**Goal**: Generated instruction outputs are tracked and safely deleted only when unchanged; summary
and JSON outputs include instruction counts.

**Independent Test**: Generate outputs, edit one, remove the source, then run sync in non-interactive
mode and confirm the edited file is retained with a warning while summaries show correct counts.

### Implementation for User Story 3

- [X] T018 [P] [US3] Define instruction summary/aggregation types in `src/lib/instructions/summary.ts`
- [X] T019 [P] [US3] Add instruction output manifest read/write in `src/lib/instructions/manifest.ts`
- [X] T020 [US3] Track output hashes and enforce safe deletion rules in `src/lib/instructions/sync.ts`
- [X] T021 [US3] Wire instruction sync + summary counts into CLI output in `src/cli/commands/sync.ts`

**Checkpoint**: User Story 3 delivers safe cleanup and reporting

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation and cross-feature consistency

- [X] T022 [P] Update instruction sync docs (template naming, `outPutPath`, target mapping, `--exclude-local`) in `README.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational completion - MVP foundation for instruction sync
- **User Story 2 (Phase 4)**: Depends on User Story 1 (builds on instruction sync pipeline)
- **User Story 3 (Phase 5)**: Depends on User Story 1 (uses instruction outputs/state)
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: Starts after Foundational; no other story dependencies
- **US2 (P2)**: Builds on US1 for shared instruction sync pipeline
- **US3 (P3)**: Builds on US1 for output tracking and sync summaries

---

## Parallel Examples

### Parallel Example: User Story 1

```bash
Task: "Implement repo AGENTS walker in src/lib/instructions/scan.ts"
Task: "Implement repo output path resolver in src/lib/instructions/paths.ts"
```

### Parallel Example: User Story 2

```bash
Task: "Implement frontmatter parsing in src/lib/instructions/frontmatter.ts"
Task: "Implement /agents template discovery in src/lib/instructions/catalog.ts"
```

### Parallel Example: User Story 3

```bash
Task: "Define summary types in src/lib/instructions/summary.ts"
Task: "Add manifest read/write in src/lib/instructions/manifest.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Validate User Story 1 independently

### Incremental Delivery

1. Setup + Foundational → baseline ready
2. User Story 1 → repo instruction sync MVP
3. User Story 2 → advanced templating + precedence
4. User Story 3 → safe cleanup + reporting
5. Polish documentation updates

### Parallel Team Strategy

- After Foundational, US1 starts first; US2 and US3 can begin once US1’s pipeline is in place.
- Within each story, tasks marked [P] can proceed in parallel on separate files.
