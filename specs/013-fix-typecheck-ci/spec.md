# Feature Specification: Typecheck and CI Reliability

**Feature Branch**: `013-fix-typecheck-ci`  
**Created**: January 18, 2026  
**Status**: Draft  
**Input**: User description: "from github issue We added a `typecheck` script using the official TypeScript native preview compiler (`tsgo` via `@typescript/native-preview`), but it currently fails. We should resolve the existing type errors and set up a PR CI pipeline that runs checks/tests/typecheck/build. Current typecheck command: - `npm run typecheck` -> `tsgo --noEmit` Typecheck errors (from latest run): - `src/cli/commands/echo.ts:12` yargs builder type mismatch (missing `times`) - `src/cli/commands/greet.ts:11` yargs builder type mismatch (missing `name`) - `src/cli/commands/sync.ts:21` missing export `InstructionSyncSummary` from `src/lib/instructions/sync.ts` - `src/cli/commands/sync.ts:818` `status: skipped` not assignable to `SubagentSyncResult` - `src/cli/commands/sync.ts:1086` yargs builder type mismatch (missing `removeMissing`, `yes`) - `src/lib/instructions/catalog.ts:82` overload expects `local`, got `shared` - `src/lib/instructions/scan.ts:221` overload expects `local`, got `shared` - `src/lib/instructions/sync.ts:297` `string | null` passed where `string` required - `src/lib/instructions/targets.ts:24` `codex` not assignable to `InstructionTargetGroup` - `src/lib/skills/catalog.ts:96` `shared` vs `local` - `src/lib/slash-commands/catalog.ts:98` `shared` vs `local` - `src/lib/subagents/catalog.ts:220` `shared` vs `local` Tasks: - [ ] Fix type errors so `npm run typecheck` passes. - [ ] Confirm `typecheck` should stay as `tsgo --noEmit`. - [ ] Add GitHub Actions PR workflow (e.g., on PR + push) to run: - `npm ci` - `npm run check` (optional if `build` already runs it) - `npm run typecheck` - `npm test` - `npm run build` Acceptance criteria: - `npm run typecheck` passes on main. - CI runs on PRs and blocks regressions (typecheck + tests + build; plus check if kept). Notes: - Typecheck currently uses `@typescript/native-preview` (`tsgo`)."

## Clarifications

### Session 2026-01-18

- Q: Which typecheck tool is the required standard for local and automated validation? → A: Keep the current typecheck tool as the required standard for local and automated validation.
- Q: How should automated validation handle pull requests from forked repositories? → A: Run automated validation for forked pull requests with read-only permissions and no secrets.
- Q: Should the quality check run as a separate required step in automated validation? → A: Run the quality check as a separate required step in automated validation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run typecheck locally (Priority: P1)

A maintainer runs the project's typecheck command locally to validate changes before sharing them.

**Why this priority**: This is the fastest feedback loop and the primary way to confirm the codebase is type-safe.

**Independent Test**: Run the typecheck command on the default branch and confirm it exits successfully with no type errors and no new build artifacts.

**Acceptance Scenarios**:

1. **Given** the default branch with no local changes, **When** the maintainer runs the typecheck command, **Then** the command exits with status 0 and reports no type errors.
2. **Given** a change that introduces a type error, **When** the maintainer runs the typecheck command, **Then** the command exits non-zero and reports the error.

---

### User Story 2 - Changes are guarded by automated checks (Priority: P2)

A contributor opens a code change request (pull request) and expects automated validation to verify the project before review.

**Why this priority**: Prevents regressions from merging and ensures consistent quality across contributions.

**Independent Test**: Open a pull request and observe that automated validation runs and reports pass or fail based on the quality check, type verification, test suite, and build verification.

**Acceptance Scenarios**:

1. **Given** a pull request with valid changes, **When** the automated validation completes, **Then** all required steps report success.
2. **Given** a pull request with a type error, **When** the automated validation runs, **Then** the type verification step reports failure.

---

### User Story 3 - Local and automated validation are aligned (Priority: P3)

A maintainer wants to reproduce automated validation outcomes locally using the same project validation steps.

**Why this priority**: Reduces time spent debugging discrepancies between local and CI behavior.

**Independent Test**: Run the same validation steps locally that automated validation uses and confirm results match outcomes for the same commit.

**Acceptance Scenarios**:

1. **Given** a commit that passes automated validation, **When** the maintainer runs the local validation steps, **Then** all steps complete successfully.

---

### Edge Cases

- What happens when typecheck is run in a clean repo but the typecheck tool is missing? The command should fail clearly with an actionable error.
- How does the system handle a failure in any validation step? The workflow should report the failure and stop the overall run as failed.
- What happens when a pull request comes from a forked repository? The workflow should run with read-only permissions, no secrets, and report results.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow maintainers to run the typecheck command successfully on the default branch with zero type errors.
- **FR-002**: The typecheck command MUST perform type verification without producing build artifacts.
- **FR-003**: The system MUST resolve all currently reported type errors so the current typecheck configuration completes successfully.
- **FR-004**: The system MUST run automated validation on code change requests (pull requests) and pushes to the default branch.
- **FR-005**: The automated validation MUST execute the project's quality check, type verification, test suite, and build verification steps and report pass or fail for each.
- **FR-006**: The validation workflow MUST fail the overall run when any required step fails and surface the failure in the pull request status.
- **FR-007**: The standard type verification tool for local and automated validation MUST remain the current typecheck command.
- **FR-008**: Automated validation for forked pull requests MUST run with read-only permissions and must not access secrets.
- **FR-009**: Automated validation MUST run the quality check as a separate required step even if other steps perform checks.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the default branch, the typecheck command completes with exit code 0 and reports zero type errors.
- **SC-002**: A code change request (pull request) that intentionally introduces a type error causes automated validation to fail in the type verification step.
- **SC-003**: 100% of code change requests (pull requests) and pushes to the default branch trigger automated validation and produce a visible pass/fail status.
- **SC-004**: Running the project's quality check, type verification, test suite, and build verification locally on the default branch completes successfully without manual cleanup.
