# Feature Specification: Custom Agents Directory Override

**Feature Branch**: `[012-agents-dir-override]`  
**Created**: 2026-01-18  
**Status**: Draft  
**Input**: User description: "lets refactor our supported agents/ directory where users can place config files. the user should be able to pass a custom directory with --agentsDir ./mycustompath this means we need to look at every place we reference agents/ in the cli code and change it to a variable. the agentsDir flag should be optional and should default to our previous agents/ directory. so this change should break nothing for anyone who already is using agents/ - that should still be the default. this default agents/ path should be a single constant defined once."

## Clarifications

### Session 2026-01-18

- Q: How should relative `--agentsDir` paths be resolved? → A: Resolve relative paths from the project root.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preserve default behavior (Priority: P1)

Users who do not provide a custom directory continue to use the existing default agents directory
without any behavior changes.

**Why this priority**: Protects existing users and workflows from regressions.

**Independent Test**: Run any supported command without providing an override and verify it uses the
same default directory as before.

**Acceptance Scenarios**:

1. **Given** a project with existing agent config files in the default `agents/` directory, **When**
   a user runs a command without `--agentsDir`, **Then** the command reads from and writes to the
   default `agents/` directory.
2. **Given** no override is provided, **When** a command creates a new agent config file, **Then**
   the file is created in the default `agents/` directory.

---

### User Story 2 - Use a custom agents directory (Priority: P2)

Users can point the CLI at a different folder to read and write agent config files.

**Why this priority**: Enables custom project layouts and shared configuration folders.

**Independent Test**: Provide a custom directory and verify all agent config operations occur within
that directory.

**Acceptance Scenarios**:

1. **Given** a valid custom path provided via `--agentsDir`, **When** a command reads or writes agent
   configs, **Then** it uses the custom directory for all such operations.
2. **Given** existing agent config files in the custom directory, **When** a command runs with
   `--agentsDir`, **Then** the command discovers and uses those files.
3. **Given** a custom path that is missing or inaccessible, **When** a command runs with
   `--agentsDir`, **Then** the command stops with a clear error and does not write to any other
   directory.

---

### User Story 3 - Discover the override option (Priority: P3)

Users can learn how to set a custom agents directory from CLI help or docs.

**Why this priority**: Reduces trial-and-error and support requests.

**Independent Test**: View help output or documentation and identify the override option and its
default value.

**Acceptance Scenarios**:

1. **Given** a user views CLI help, **When** they scan options, **Then** they see `--agentsDir` and
   the default directory value.

---

### Edge Cases

- Custom directory path does not exist.
- Custom path points to a file rather than a directory.
- Custom directory exists but cannot be read or written due to permissions.
- Custom directory path includes relative segments (e.g., `.` or `..`) or a trailing slash.
- Custom directory path matches the default `agents/` directory.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST accept an optional `--agentsDir` argument on commands that read or
  write agent config files.
- **FR-002**: When `--agentsDir` is not provided, the system MUST use the existing default agents
  directory (`agents/`) with no behavior changes from previous versions.
- **FR-003**: When `--agentsDir` is provided, the system MUST use that directory consistently for
  all agent config reads and writes within a command invocation.
- **FR-004**: The system MUST present a clear, actionable error when the specified directory is
  missing, inaccessible, or not a directory.
- **FR-005**: The system MUST expose the `--agentsDir` option and its default value in CLI help or
  equivalent user-facing documentation.
- **FR-006**: The default agents directory MUST be consistent across all commands (no
  command-specific defaults).
- **FR-007**: When `--agentsDir` is a relative path, the system MUST resolve it from the project
  root.

### Key Entities *(include if feature involves data)*

- **Agents Directory**: The folder used to store and retrieve agent configuration files; can be the
  default `agents/` directory or a user-provided override.
- **Agent Config File**: A configuration file that defines an agent and is stored within the agents
  directory.

## Assumptions & Dependencies

### Assumptions

- Relative custom directory paths are resolved from the project root, matching the base used for
  the default `agents/` directory.
- Commands that do not interact with agent config files are unaffected.

### Dependencies

- No new external dependencies beyond existing CLI usage and filesystem access.

## Out of Scope

- Changing the agent configuration file format.
- Automatically migrating existing agent configs between directories.
- Enforcing any new directory structure beyond selecting a folder.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In regression testing without `--agentsDir`, 100% of observed agent config reads and
  writes occur in the default `agents/` directory.
- **SC-002**: With `--agentsDir` provided, users can complete core agent-config tasks (create, list,
  update) using a custom directory within 2 minutes per task in usability testing.
- **SC-003**: 100% of invalid custom-path attempts result in a clear error message that includes the
  problematic path and a corrective next step.
- **SC-004**: At least 90% of users can identify how to override the agents directory by consulting
  CLI help or documentation.
