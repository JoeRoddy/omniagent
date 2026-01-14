# Feature Specification: Honor Targets Frontmatter

**Feature Branch**: `008-honor-targets-frontmatter`  
**Created**: 2026-01-14  
**Status**: Draft  
**Input**: User description: "look at readme and lets implement the described targets feature in frontmatter for all supported features. this should be used as the default, but can be overwritten by cli args. this will be spec 8 btw. not 001."

## Clarifications

### Session 2026-01-14

- Q: How should CLI target flags interact with frontmatter defaults? → A: `--only` replaces
  frontmatter; `--skip` filters the current base (frontmatter if present, otherwise all). If both,
  apply `--only` then `--skip`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Default per-file targeting (Priority: P1)

As a user, I can declare targets in frontmatter (the metadata block at the top of a file) for
skills, subagents, and slash commands so a standard sync only sends each file to those targets by
default.

**Why this priority**: This is the core behavior that enables a single canonical config to sync to
the right agents without manual filtering every time.

**Independent Test**: Create one file of each type with explicit targets and run a default sync; the
outputs appear only for the specified targets.

**Acceptance Scenarios**:

1. **Given** a skill with `targets: [claude, codex]`, **When** I run sync with no target overrides,
   **Then** outputs are created only for Claude and Codex.
2. **Given** a subagent with `targetAgents: gemini`, **When** I run sync with no target overrides,
   **Then** outputs are created only for Gemini (including any required conversion).
3. **Given** a slash command with no targets frontmatter, **When** I run sync with no target
   overrides, **Then** it syncs to all supported targets.

---

### User Story 2 - Override targets per run (Priority: P2)

As a user, I can override frontmatter defaults with command-line target arguments when I want a
one-off sync to a different set of targets.

**Why this priority**: Users need a fast, run-level override without editing files.

**Independent Test**: Use a file with targets set, run sync with an override, and confirm outputs
match the override.

**Acceptance Scenarios**:

1. **Given** files with varied frontmatter targets, **When** I run sync with an explicit target
   override, **Then** outputs match the override and not the per-file defaults.
2. **Given** a file that targets Claude only, **When** I run sync with a skip list that excludes
   Claude, **Then** that file produces no outputs for this run.

---

### User Story 3 - Handle mixed or invalid targets (Priority: P3)

As a user, I get clear feedback when targets are mixed or invalid so I can correct them without
unintended sync results.

**Why this priority**: Prevents silent misconfiguration and reduces trust issues.

**Independent Test**: Add invalid target values and mixed fields, run sync, and verify the reported
results and outputs.

**Acceptance Scenarios**:

1. **Given** a file with both `targets` and `targetAgents`, **When** I run sync, **Then** the
   effective target set is the combined unique values.
2. **Given** a file that includes an unsupported target value, **When** I run sync, **Then** the
   sync fails with an error that names the file and unsupported values, and no outputs are produced
   for that file.

---

### Edge Cases

- A file declares an empty targets list or an empty string (sync should error).
- A file declares only unsupported targets (sync should error).
- A file includes duplicate targets with different casing.
- A subagent targets a non-Claude agent (conversion still applies) while another targets Claude
  only.
- Command-line overrides specify a target not supported by this release.
- Both `--only` and `--skip` are provided in the same sync run.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST recognize `targets` and `targetAgents` frontmatter fields in skills,
  subagents, and slash commands to define each file's default target set.
- **FR-002**: When no targets frontmatter is present, the default target set is all supported
  targets.
- **FR-003**: When a sync run includes explicit target overrides, `--only` replaces per-file
  defaults and `--skip` filters the active target set; if both are present, apply `--only` then
  `--skip`.
- **FR-004**: Supported target values are `claude`, `codex`, `copilot`, and `gemini`, and matching
  is case-insensitive.
- **FR-005**: Targets MAY be provided as a single value or a list; duplicates are ignored.
- **FR-006**: If both `targets` and `targetAgents` are present, the effective target set is the
  combined unique values.
- **FR-007**: If a file's effective target set is empty or only includes unsupported values, the
  sync MUST fail with an error that identifies the file and invalid targets.
- **FR-008**: Generated outputs and converted artifacts MUST NOT include `targets` or
  `targetAgents` metadata.
- **FR-009**: Targeting behavior MUST apply consistently to all supported syncable features and
  their conversions.

### Requirement Acceptance Criteria

- **FR-001**: For each file type, frontmatter targets change the default sync destinations.
- **FR-002**: Files without targets sync to all supported targets in a default run.
- **FR-003**: `--only` replaces per-file defaults and `--skip` filters the active set; if both are
  present, apply `--only` then `--skip`.
- **FR-004**: Target values are accepted in any casing and resolve to the supported set only.
- **FR-005**: Single-value and list formats both resolve to the same effective targets.
- **FR-006**: Files with both fields produce a combined, de-duplicated target set.
- **FR-007**: Files with no valid targets cause the sync to exit with a non-zero error and a clear
  message referencing the file and invalid/empty targets.
- **FR-008**: Outputs do not contain target-related metadata in any generated file.
- **FR-009**: The same target selection logic applies to skills, subagents, and slash commands.

### Key Entities *(include if feature involves data)*

- **Syncable File**: A skill, subagent, or slash command with content plus optional frontmatter
  targets.
- **File Metadata (Frontmatter)**: The metadata block at the top of a file used to define targets
  and other attributes.
- **Target Agent**: One of the supported agent identifiers (Claude, Codex, Copilot, Gemini).
- **Target Selection**: The effective target set for a file in a sync run, derived from frontmatter
  defaults or CLI overrides.
- **Sync Run**: A single user-initiated sync operation with optional target overrides.

## Assumptions

- Command-line target selection applies globally to the sync run and is intended as an override of
  per-file defaults.
- Existing non-target frontmatter fields continue to behave as they do today.

## Out of Scope

- Adding new target types beyond the currently supported agents.
- Changing target output locations or naming conventions beyond removing target metadata.
- Redefining non-sync commands or unrelated CLI behaviors.

## Dependencies

- None beyond the existing supported targets and sync flow.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a test repo with at least one skill, subagent, and slash command using targets,
  100% of outputs are produced only for the declared targets during a default sync.
- **SC-002**: In a sync run with explicit target overrides, 100% of outputs match the override
  selection regardless of frontmatter defaults.
- **SC-003**: 0 generated output files contain `targets` or `targetAgents` metadata.
- **SC-004**: For every file containing unsupported or empty target values, the sync fails with a
  clear error and non-zero exit status, and no outputs are produced for that file.
