# Feature Specification: Custom Agent Targets

**Feature Branch**: `014-custom-agent-targets`  
**Created**: 2026-01-21  
**Status**: Draft  
**Input**: User description: "Add support for user-defined custom agent targets via an omniagent.config.ts configuration file, migrate built-in targets to this API, and merge built-ins with custom targets at runtime."

## Clarifications

### Session 2026-01-21

- Q: Which standard config locations/precedence should apply when `--config` isn’t provided? → A: Only in the agents dir, with extension fallback (`omniagent.config.(ts|mts|cts|js|mjs|cjs)`), using `--agentsDir` if set (default `agents/`).
- Q: Should the CLI `--config` option still exist, and if so, must it point inside `agentsDir`? → A: Remove `--config`; only auto-discover in `agentsDir`.
- Q: If a custom target ID matches a built-in target and the config does not explicitly mark it as an override/inheritance, what should happen? → A: Validation error; require explicit override/inherits to collide.
- Q: If multiple config files exist in `agentsDir`, which one wins? → A: Fixed extension precedence: `ts → mts → cts → js → mjs → cjs` (first match wins).
- Q: How should the system behave when the config file is invalid? → A: Fail fast with clear validation errors; no outputs written.
- Q: How should missing or unknown template placeholders be handled in output definitions? → A: Validation error; fail fast and write no outputs.
- Q: When multiple targets would write the same output file, how is the writer selected? → A: Use tool-shipped default writer per output type; defaults are exported for reuse; other targets are marked satisfied.
- Q: How should the system handle converter errors (including errors from per-item conversion rules)? → A: Continue other items, log errored items, and exit non-zero if any converter errors occur.
- Q: What happens when an instruction source omits an output directory? → A: Default to the source directory, except `agentsDir/AGENTS.md` which defaults to repo root.
- Q: Which default writers should be used when outputs collide? → A: Use target-agnostic, exported defaults: subagent writer uses the canonical subagent format (currently the Claude-expected format but not named as such), skills use the standard skill directory format, instructions use the standard instruction writer; commands have no default writer and collisions must be resolved explicitly.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Register a simple custom target (Priority: P1)

As a repo maintainer, I can define a custom target in a config file with minimal
settings so my agents sync to a new tool without modifying omniagent core.

**Why this priority**: This is the core promise of the feature and enables the broadest
set of users to adopt new tools quickly.

**Independent Test**: Can be fully tested by adding a minimal target config, running a
sync, and verifying outputs are written in the expected locations.

**Acceptance Scenarios**:

1. **Given** a repo with a config that defines a custom target using short-form settings for
   skills, commands, subagents, and instructions, **When** the user runs sync for that
   target, **Then** outputs are generated in the expected directories and instruction
   files are written to each source-defined output directory.
2. **Given** instruction sources that specify different output directories, **When** sync
   runs for a target with an instruction filename configured, **Then** instruction files
   appear in each specified directory with the correct filename.

---

### User Story 2 - Override and manage built-in targets (Priority: P2)

As a maintainer, I can use the same configuration model for built-in targets and
optionally override or disable them to tailor outputs without losing defaults.

**Why this priority**: Ensures backward compatibility while enabling customization of
first-party targets.

**Independent Test**: Can be fully tested by overriding one built-in target and disabling
another, then validating outputs and target availability.

**Acceptance Scenarios**:

1. **Given** a config that overrides a built-in target's instruction filename, **When**
   sync runs, **Then** that target's instructions use the overridden filename while other
   outputs remain unchanged.
2. **Given** a config that disables a built-in target, **When** sync runs without explicitly
   selecting targets, **Then** no outputs are produced for the disabled target.

---

### User Story 3 - Advanced conversion and routing (Priority: P3)

As an advanced user, I can provide dynamic routing and conversion logic to transform
skills, commands, subagents, or instructions into custom formats or multi-file outputs.

**Why this priority**: Enables complex tools and enterprise workflows without forcing all
users into advanced configuration.

**Independent Test**: Can be fully tested by defining a converter that routes items based
on metadata and produces multiple files from one source.

**Acceptance Scenarios**:

1. **Given** a target with a converter that routes outputs based on source metadata,
   **When** sync runs, **Then** each item is written to the computed location with the
   expected content.
2. **Given** a converter that emits multiple outputs from a single source, **When** sync
   runs, **Then** all expected outputs are created and tracked as managed files.

---

### Edge Cases

- Invalid config or duplicate target IDs/aliases: fail fast with clear errors; no outputs
  are written.
- Custom target ID collision without explicit override/inheritance: validation error; no
  outputs are written.
- Missing or unknown template placeholders: validation error; no outputs are written.
- Converter errors: continue other items, log errored items, and exit non-zero if any
  converter errors occur.
- Output collisions across targets (including instruction grouping): tool-shipped default
  writer per output type writes (subagents/skills/instructions), and commands have no
  default writer so collisions must be resolved explicitly.
- Instruction sources without an output directory default to the source directory, except
  `agentsDir/AGENTS.md` which defaults to repo root.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST load configuration only by auto-discovering in the agents
  directory (default `agents/`, overridden by `--agentsDir`) and MUST NOT support a
  `--config` flag or search the repo root or user home. When auto-discovering, it MUST
  accept `omniagent.config.(ts|mts|cts|js|mjs|cjs)` and use the first match in that
  extension order.
- **FR-002**: System MUST validate configuration and provide actionable errors for invalid
  schemas, duplicate IDs/aliases, or conflicting definitions, and MUST avoid writing
  outputs when validation fails.
- **FR-003**: System MUST allow users to define custom targets with a unique ID, optional
  display name, optional aliases, and optional inheritance from a built-in target.
- **FR-004**: System MUST combine built-in targets with custom targets at runtime, with
  built-ins enabled by default.
- **FR-005**: System MUST allow users to disable built-in targets by ID, removing them
  from the active target set.
- **FR-006**: System MUST allow users to override built-in targets, merging overrides with
  defaults so unspecified settings remain unchanged.
- **FR-006a**: System MUST treat custom targets that collide with built-in IDs as invalid
  unless they explicitly declare an override or inheritance relationship.
- **FR-007**: System MUST infer a target's supported features based on which output
  configurations are provided; omitted outputs MUST disable syncing for that feature.
- **FR-008**: System MUST support short-form output configuration for common cases and
  long-form configuration for advanced behavior across all feature types.
- **FR-009**: For skills, commands, and subagents, the system MUST treat the configured
  value as a full output path template; for instructions, it MUST treat the configured
  value as a filename combined with each source's output directory, supporting deep
  nesting.
- **FR-010**: System MUST resolve placeholders in output definitions for repository root,
  user home, agents source, target ID, item name, and command location.
- **FR-010a**: System MUST treat missing or unknown placeholders in output definitions as
  validation errors and MUST fail fast with no outputs written.
- **FR-011**: System MUST allow output configuration values to be static or computed per
  item via dynamic rules (functions) that receive item and context information.
- **FR-012**: System MUST support command output formats and locations per target (project
  and user-level) and place outputs in the correct location.
- **FR-013**: System MUST support fallback behavior for commands and subagents when a
  target does not natively support them (convert to another supported output or skip), as
  configured.
- **FR-014**: System MUST allow conversion rules to return a single output, multiple
  outputs, a skip/handled decision, or a clear error that stops processing for that item.
- **FR-014a**: When a conversion rule errors for an item, the system MUST log the errored
  item, continue processing other items, and exit non-zero if any converter errors
  occurred.
- **FR-015**: System MUST support instruction grouping so multiple targets can share a
  single output file, with only one target writing and others marked as satisfied.
- **FR-015a**: When multiple targets resolve to the same output file (including
  instruction groups and other output types), the system MUST select the tool-shipped
  default writer for that output type for subagents/skills/instructions and mark the
  others as satisfied; these defaults MUST be exported for reuse in target definitions.
- **FR-015b**: The tool-shipped default writers MUST be target-agnostic exports: the
  canonical subagent writer (Claude-compatible format, but not named "claude"), the
  standard skill directory writer, and the standard instruction writer.
- **FR-015c**: Commands have no default writer; if multiple targets resolve to the same
  command output file, the system MUST treat it as a validation error unless the
  configuration eliminates the collision.
- **FR-016**: System MUST honor per-source instruction targeting and output directories so
  a single repo can emit instruction files to multiple locations.
- **FR-016a**: If an instruction source omits an output directory, the system MUST default
  to the source directory, except for `agentsDir/AGENTS.md` which MUST default to repo
  root.
- **FR-016b**: Instruction processing MUST continue to apply template rendering and
  frontmatter handling (targets, output directory) for sources under `agentsDir`.
- **FR-017**: System MUST track managed outputs per target and remove outputs only when
  removal is requested, the source is missing, and the output is unchanged since the last
  sync.
- **FR-018**: System MUST provide pre- and post-processing hooks for sync and conversion
  steps to enable custom behavior.
- **FR-019**: System MUST preserve backward compatibility so repos without a configuration
  continue to sync built-in targets with existing behavior.

### Key Entities *(include if feature involves data)*

- **Configuration File**: Captures target definitions, built-in overrides, disabled
  built-ins, and global hooks.
- **Target**: A named destination with outputs for skills, commands, subagents, and/or
  instructions plus optional aliases and inheritance.
- **Output Definition**: Rules that map a source item to a destination path/filename,
  format, location, grouping, fallback, and conversion behavior.
- **Source Item**: A parsed skill, command, subagent, or instruction with name, content,
  targets, and (for instructions) a designated output directory.
- **Managed Output Record**: Tracks files created by sync with their source and last
  known content fingerprint to support safe removal.

## Scope Boundaries

**In scope**:
- Config-based definition of custom targets and their outputs.
- Built-in targets expressed through the same model, including overrides and disabling.
- Per-item routing and conversion rules, including instruction grouping and deep nesting.
- Tracking and safe removal of managed outputs for custom targets.

**Out of scope**:
- Creating new agent source content (skills/commands/subagents/instructions) as part of
  this feature.
- Introducing a new UI for configuration beyond file-based configuration.
- Adding new external integrations beyond output file generation.

## Assumptions & Dependencies

- The existing sync command remains the primary entry point for running target syncs.
- Current agent source catalogs (skills, commands, subagents, instructions) remain
  available and are used as inputs to the new target system.
- Users have write access to configured output locations in their repo or home directory.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A maintainer can configure and successfully sync a simple custom target in
  15 minutes or less, using 10 lines of configuration or fewer.
- **SC-002**: For a representative sample repo, 100% of expected outputs are generated for
  built-in and custom targets, with 0 unexpected files created.
- **SC-003**: When removal of missing outputs is enabled, 100% of removed files are
  confirmed to be managed outputs whose sources no longer exist and were unchanged by the
  user.
- **SC-004**: At least 90% of advanced configuration scenarios (conditional routing,
  multi-file outputs, instruction grouping) succeed in acceptance testing without manual
  post-editing.
