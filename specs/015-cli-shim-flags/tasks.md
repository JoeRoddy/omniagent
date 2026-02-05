---
description: "Task list template for feature implementation"
---

# Tasks: CLI Shim Surface

**Input**: Design documents from `/specs/015-cli-shim-flags/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md
**Tests**: Included (spec requires automated validation for valid/invalid flag combinations).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- Paths below assume single project layout from plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and shim module scaffolding

- [X] T001 Create shim entrypoint and exports in `src/cli/shim/index.ts`
- [X] T002 [P] Define shim domain types/constants in `src/cli/shim/types.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Add `defaultAgent?: AgentId` to config types and export `AgentId` in `src/lib/targets/config-types.ts`
- [X] T004 Validate `defaultAgent` against supported agent IDs in `src/lib/targets/config-validate.ts`
- [X] T005 [P] Implement default-agent resolver (id, source, configPath) in `src/lib/targets/default-agent.ts`
- [X] T006 [P] Add shim error + exit-code helpers (0/1/2/3 mapping) in `src/cli/shim/errors.ts`
- [X] T007 Implement shared flag parsing + normalization (approval/sandbox/output/web/model aliases, last-output wins, sandboxExplicit) in `src/cli/shim/flags.ts`
- [X] T008 [P] Define per-agent capability matrix and flag mappings in `src/cli/shim/agent-capabilities.ts`
- [X] T009 Implement invocation resolution core (mode selection, prompt precedence, agent selection, delimiter validation) in `src/cli/shim/resolve-invocation.ts`
- [X] T010 Implement shim-to-agent argument builder with capability gating + unsupported-flag warnings in `src/cli/shim/build-args.ts`
- [X] T011 Implement agent execution wrapper with warning emission + output passthrough (stdio inherit, exit code mapping) in `src/cli/shim/execute.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Start interactive REPL with shared flags (Priority: P1) 🎯 MVP

**Goal**: Default `omniagent` starts interactive mode with shared flags applied.

**Independent Test**: Run `omniagent` with stdin as TTY and no `--prompt`; verify interactive session starts and shared flags (model/output/approval) are applied.

### Tests for User Story 1 ⚠️

- [X] T012 [P] [US1] Add interactive shim tests for default mode and shared flags in `tests/commands/cli-shim-interactive.test.ts`

### Implementation for User Story 1

- [X] T013 [US1] Implement interactive mode resolution rules (TTY + no prompt) in `src/cli/shim/resolve-invocation.ts`
- [X] T014 [P] [US1] Wire root CLI to shim execution while preserving subcommands/help/version in `src/cli/index.ts`
- [X] T015 [P] [US1] Ensure interactive execution passes agent output unmodified in `src/cli/shim/execute.ts`

**Checkpoint**: User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Run a one-shot prompt reliably (Priority: P2)

**Goal**: `--prompt` or piped stdin triggers non-interactive one-shot execution.

**Independent Test**: Run `omniagent -p "..."` and `echo "..." | omniagent`; verify one-shot mode, prompt precedence, and exit behavior.

### Tests for User Story 2 ⚠️

- [X] T016 [P] [US2] Add one-shot tests for `--prompt` and piped stdin in `tests/commands/cli-shim-oneshot.test.ts`

### Implementation for User Story 2

- [X] T017 [US2] Implement one-shot prompt resolution (stdin non-TTY, `--prompt` wins) in `src/cli/shim/resolve-invocation.ts`
- [X] T018 [P] [US2] Add `-p/--prompt` flag wiring and shared-flag support in `src/cli/shim/flags.ts`
- [X] T019 [P] [US2] Implement one-shot execution path (send prompt, no REPL) in `src/cli/shim/execute.ts`

**Checkpoint**: User Story 2 should be fully functional and testable independently

---

## Phase 5: User Story 3 - Pass agent-specific flags through safely (Priority: P3)

**Goal**: Support `--` passthrough only after `--agent`, rejecting unknown pre-`--` flags.

**Independent Test**: Run `omniagent --agent codex -- --some-flag` (passes) and `omniagent --unknown-flag --agent codex` (invalid usage).

### Tests for User Story 3 ⚠️

- [X] T020 [P] [US3] Add passthrough/unknown-flag tests in `tests/commands/cli-shim-passthrough.test.ts`

### Implementation for User Story 3

- [X] T021 [P] [US3] Configure yargs `populate--` + strict parsing in `src/cli/index.ts`
- [X] T022 [US3] Enforce passthrough validation rules (delimiter requires agent) in `src/cli/shim/resolve-invocation.ts`
- [X] T023 [P] [US3] Ensure passthrough args are appended verbatim after shim args in `src/cli/shim/build-args.ts`

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T024 [P] Add CLI usage/examples and capability notes for shim flags in `src/cli/index.ts`
- [X] T025 [P] Update CLI documentation and capability matrix in `README.md`
- [X] T026 [P] Add unsupported-flag warning tests in `tests/commands/cli-shim-capabilities.test.ts`
- [X] T027 [P] Validate quickstart scenarios and update notes in `specs/015-cli-shim-flags/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
- **Polish (Phase 6)**: Depends on desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - No dependencies on other stories

### Within Each User Story

- Tests (if included) should be written first and fail before implementation
- Core resolution logic before CLI wiring and execution
- Story complete before moving to next priority

---

## Parallel Opportunities

- Foundational tasks marked [P] can run in parallel (T005, T006, T008)
- User story tasks marked [P] can run in parallel once Phase 2 completes
- Documentation and capability tests in Phase 6 can run in parallel

---

## Parallel Example: User Story 1

```bash
Task: "T012 [P] [US1] Add interactive shim tests in tests/commands/cli-shim-interactive.test.ts"
Task: "T014 [P] [US1] Wire root CLI to shim execution in src/cli/index.ts"
Task: "T015 [P] [US1] Ensure interactive execution passthrough in src/cli/shim/execute.ts"
```

---

## Parallel Example: User Story 2

```bash
Task: "T016 [P] [US2] Add one-shot tests in tests/commands/cli-shim-oneshot.test.ts"
Task: "T018 [P] [US2] Add prompt flag wiring in src/cli/shim/flags.ts"
Task: "T019 [P] [US2] Implement one-shot execution path in src/cli/shim/execute.ts"
```

---

## Parallel Example: User Story 3

```bash
Task: "T020 [P] [US3] Add passthrough tests in tests/commands/cli-shim-passthrough.test.ts"
Task: "T021 [P] [US3] Configure yargs populate-- in src/cli/index.ts"
Task: "T023 [P] [US3] Ensure passthrough ordering in src/cli/shim/build-args.ts"
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
2. Add User Story 1 → Test independently → MVP ready
3. Add User Story 2 → Test independently
4. Add User Story 3 → Test independently
5. Finish Polish tasks and documentation

### Parallel Team Strategy

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1
   - Developer B: User Story 2
   - Developer C: User Story 3
3. Stories complete and integrate independently
