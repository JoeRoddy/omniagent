---

description: "Task list for Custom Agent Targets implementation"
---

# Tasks: Custom Agent Targets

**Input**: Design documents from `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/014-custom-agent-targets/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/targets.openapi.yaml

**Tests**: Not explicitly requested in the feature spec; no test tasks included.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and baseline dependencies

- [ ] T001 Add jiti dependency for TS/JS config loading in package.json and package-lock.json
- [ ] T002 Create target config type definitions and exports in src/lib/targets/config-types.ts and src/lib/targets/index.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T003 Implement agentsDir config discovery + loader (extension precedence, jiti) in src/lib/targets/config-loader.ts
- [ ] T004 Implement placeholder definitions and validation utilities in src/lib/targets/placeholders.ts
- [ ] T005 Implement config schema validation + aggregated errors (IDs/aliases/output shapes/placeholders) in src/lib/targets/config-validate.ts
- [ ] T006 Define built-in targets in the new schema (codex/claude/gemini/copilot) in src/lib/targets/builtins.ts
- [ ] T007 Implement target resolution/merge + alias map in src/lib/targets/resolve-targets.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Register a simple custom target (Priority: P1) 🎯 MVP

**Goal**: Define a minimal custom target config that syncs skills, commands, subagents, and instructions without core code changes.

**Independent Test**: Add a minimal target config, run sync for that target, and verify outputs are written to the expected locations (including per-source instruction output directories).

### Implementation for User Story 1

- [ ] T008 [US1] Wire config discovery/validation/resolution into sync command and target selection in src/cli/commands/sync.ts
- [ ] T009 [US1] Update dynamic target utilities + frontmatter parsing for skills/subagents/commands in src/lib/sync-targets.ts, src/lib/skills/catalog.ts, src/lib/subagents/catalog.ts, src/lib/slash-commands/catalog.ts
- [ ] T010 [P] [US1] Write skills to configured output templates with placeholder expansion in src/lib/skills/sync.ts
- [ ] T011 [P] [US1] Write subagents to configured output templates and skip when output missing in src/lib/subagents/sync.ts
- [ ] T012 [P] [US1] Route slash commands to configured project/user paths in src/lib/slash-commands/sync.ts and src/lib/slash-commands/targets.ts
- [ ] T013 [P] [US1] Apply instruction target validation + default output dir rules in src/lib/instructions/frontmatter.ts and src/lib/instructions/catalog.ts
- [ ] T014 [US1] Resolve instruction output filenames per target and per-source output directories in src/lib/instructions/paths.ts and src/lib/instructions/sync.ts

**Checkpoint**: User Story 1 should be fully functional and independently testable

---

## Phase 4: User Story 2 - Override and manage built-in targets (Priority: P2)

**Goal**: Use the same config model for built-ins, including override and disable behavior without losing defaults.

**Independent Test**: Override a built-in instruction filename and disable another built-in; sync and verify outputs and target availability.

### Implementation for User Story 2

- [ ] T015 [US2] Enforce override/inherits + disableTargets validation rules in src/lib/targets/config-validate.ts
- [ ] T016 [US2] Implement built-in override/disable merge semantics in src/lib/targets/resolve-targets.ts
- [ ] T017 [US2] Update supported target listing and CLI validation to exclude disabled targets and use displayName in src/lib/supported-targets.ts and src/cli/commands/sync.ts

**Checkpoint**: User Stories 1 and 2 both work independently

---

## Phase 5: User Story 3 - Advanced conversion and routing (Priority: P3)

**Goal**: Support dynamic routing/conversion logic, multi-output conversion, and instruction grouping for advanced targets.

**Independent Test**: Define a converter that routes by metadata and emits multiple outputs; sync and verify all outputs plus error handling behavior.

### Implementation for User Story 3

- [ ] T018 [P] [US3] Add converter/writer interfaces and default writer exports in src/lib/targets/converters.ts and src/lib/targets/writers.ts
- [ ] T019 [P] [US3] Implement output definition normalization + placeholder resolution (short/long forms) in src/lib/targets/output-resolver.ts
- [ ] T020 [US3] Integrate converter execution + fallback handling across sync pipelines in src/lib/skills/sync.ts, src/lib/subagents/sync.ts, src/lib/slash-commands/sync.ts, src/lib/instructions/sync.ts
- [ ] T021 [US3] Implement output collision detection + instruction grouping resolution using default writers in src/lib/targets/resolve-targets.ts and src/lib/instructions/sync.ts
- [ ] T022 [US3] Implement sync/conversion hooks (global + target) and wire into pipelines in src/lib/targets/hooks.ts, src/cli/commands/sync.ts, src/lib/skills/sync.ts, src/lib/subagents/sync.ts, src/lib/slash-commands/sync.ts, src/lib/instructions/sync.ts
- [ ] T023 [US3] Add managed output tracking with checksum-based removal for custom targets in src/lib/targets/managed-outputs.ts and integrate with manifests in src/lib/skills/sync.ts, src/lib/subagents/sync.ts, src/lib/slash-commands/sync.ts, src/lib/instructions/sync.ts

**Checkpoint**: All user stories are independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation updates and final touch-ups

- [ ] T024 [P] Update README with config discovery, placeholders, override/disable semantics, and default writers in README.md
- [ ] T025 Update CLI help/examples to mention config auto-discovery in src/cli/commands/sync.ts

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: Depend on Foundational completion
- **Polish (Final Phase)**: Depends on desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational; no dependencies on other stories
- **User Story 2 (P2)**: Starts after Foundational; builds on resolved targets and may follow US1 for stability
- **User Story 3 (P3)**: Starts after Foundational; can proceed after US1 once output resolution is in place

### Parallel Opportunities

- US1 parallel tasks: T010, T011, T012, T013
- US3 parallel tasks: T018, T019
- Polish parallel tasks: T024 (docs) can run alongside other story work

---

## Parallel Example: User Story 1

```bash
# After Foundations complete, these can run in parallel:
Task: "Write skills to configured output templates with placeholder expansion in src/lib/skills/sync.ts"
Task: "Write subagents to configured output templates and skip when output missing in src/lib/subagents/sync.ts"
Task: "Route slash commands to configured project/user paths in src/lib/slash-commands/sync.ts and src/lib/slash-commands/targets.ts"
Task: "Apply instruction target validation + default output dir rules in src/lib/instructions/frontmatter.ts and src/lib/instructions/catalog.ts"
```

---

## Parallel Example: User Story 2

```bash
# US2 tasks are sequential because they touch the same resolution/validation modules.
```

---

## Parallel Example: User Story 3

```bash
# After Foundations/US1, these can run in parallel:
Task: "Add converter/writer interfaces and default writer exports in src/lib/targets/converters.ts and src/lib/targets/writers.ts"
Task: "Implement output definition normalization + placeholder resolution (short/long forms) in src/lib/targets/output-resolver.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Run the US1 independent test scenario

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. User Story 1 → Test independently → Demo MVP
3. User Story 2 → Test independently → Demo override/disable
4. User Story 3 → Test independently → Demo advanced routing
5. Polish updates

### Parallel Team Strategy

1. Team completes Setup + Foundational together
2. After Foundations:
   - Developer A: US1 sync updates (T010–T014)
   - Developer B: US1 CLI/validation wiring (T008–T009)
   - Developer C: US3 foundation modules (T018–T019)
