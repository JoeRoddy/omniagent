# Feature Specification: Agent-Specific Templating

**Feature Branch**: `007-agent-templating`  
**Created**: 2026-01-12  
**Status**: Draft  
**Input**: User description: "add support for agent specific templating to all syncable features. this should allow users to inject blocks of text anywhere in their config files and apply those only to specific agents, or to omit agents. an example could be something like: regular file text <agents claude,codex>some tokens that only get added to the above agents</agents> <agents not:claude,gemini>some tokens that get added to all agents EXCEPT the above</agents> later we can discuss the potential templating options. this should work on all current features (commands, skills, agents) AND all future features, so AGENTS.md and similar should make a note that this system must be supported everywhere."

## Clarifications

### Session 2026-01-12

- Q: What should happen when a file contains an invalid or unknown agent selector? → A: Fail the entire sync run; no outputs changed.
- Q: What should define the set of valid agent identifiers for selector validation? → A: Only agents currently configured in the project; when invalid, list the valid identifiers.
- Q: Should nested agent-scoped blocks be supported? → A: No, nested blocks are treated as invalid selectors.
- Q: How should a scoped block with an empty agent list be handled? → A: Treat as invalid selector; fail the sync run.
- Q: If a block’s selector both includes and excludes the same agent, how should conflicts be resolved? → A: Treat as invalid selector; fail the sync run.
- Q: What delimiter style should define an agent-scoped block? → A: Tag-style block `<agents claude,codex> ... </agents>` as in the example.
- Q: How should “exclude” be expressed inside the selector list? → A: Use the `not:` prefix (e.g., `<agents not:claude,gemini> ... </agents>`).
- Q: How is the end of the block determined for `<agents selector-list> ... </agents>`? → A: The block ends at a matching unescaped `</agents>`; `\</agents>` is allowed inside content.
- Q: Can the block content include newlines? → A: Yes, content may span multiple lines until the closing `</agents>`.
- Q: Are agent identifiers in selectors case-sensitive? → A: No, matching is case-insensitive.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Include or Exclude Agent-Specific Blocks (Priority: P1)

As a user managing shared configuration, I can add agent-scoped blocks anywhere in a config file so each agent receives only the text intended for it.

**Why this priority**: This is the core value: tailoring one source config to multiple agents without manual duplication.

**Independent Test**: Can be fully tested by syncing a single config file for two agents and verifying the resulting files include or exclude the scoped blocks correctly.

**Acceptance Scenarios**:

1. **Given** a config file with a block scoped to Agent A, **When** I sync for Agent A, **Then** the output includes that block.
2. **Given** the same config file, **When** I sync for Agent B, **Then** the output excludes that block.
3. **Given** a block that explicitly excludes Agent A, **When** I sync for Agent A, **Then** the output excludes that block and includes it for other agents.

---

### User Story 2 - Consistent Behavior Across All Syncable Features (Priority: P2)

As a user, I can use the same agent-scoped templating rules in any current or future syncable feature without learning a different system per feature.

**Why this priority**: Consistency avoids surprises and ensures the feature scales as new syncable content types are added.

**Independent Test**: Can be fully tested by syncing multiple feature types for one agent and verifying the scoped blocks are resolved the same way in each output.

**Acceptance Scenarios**:

1. **Given** templated content in commands, skills, and agents files, **When** I sync for a single agent, **Then** all outputs apply the same include/exclude rules.

---

### User Story 3 - Safe Handling of Invalid or Unknown Selectors (Priority: P3)

As a user, I receive clear feedback if a template selector is invalid or references unknown agents, and my original content is not silently corrupted.

**Why this priority**: Prevents silent misconfiguration and makes it safe to adopt templating in existing files.

**Independent Test**: Can be fully tested by introducing an invalid selector and confirming the system reports it while preserving the original file content.

**Acceptance Scenarios**:

1. **Given** a config file with an invalid or malformed selector, **When** I sync, **Then** the sync fails, a clear error is shown, and no outputs are changed.
2. **Given** a selector referencing an unknown agent identifier, **When** I sync, **Then** the sync fails, a clear error lists the valid agent identifiers, and no outputs are changed.

---

### Edge Cases

- What happens when multiple scoped blocks target the same agent in different locations?
- How does the system handle overlapping include and exclude blocks in a single file?
- What happens when a scoped block targets an empty agent list?
- How does the system handle partially formed templating markers?
- What happens when a file contains no templating at all?

## Scope & Non-Goals

**In scope**:
- Agent-scoped inclusion and exclusion of text blocks within any syncable config content.
- Consistent behavior across all current and future syncable features.
- Documentation that makes the cross-feature support explicit.
- Define the agent-scoped block syntax (tag-style `<agents ...> ... </agents>` block).

**Out of scope**:
- Creating or managing new agent types beyond existing identifiers.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow users to mark blocks of text in any syncable config file as scoped to one or more specific agents.
- **FR-002**: The system MUST allow users to mark blocks of text as excluded from one or more specific agents.
- **FR-003**: Scoped blocks MUST be usable anywhere in the file content and can appear multiple times.
- **FR-004**: When syncing for a specific agent, the system MUST include or exclude each scoped block based solely on that agent's identifier.
- **FR-005**: Non-templated content MUST be preserved exactly for all agents.
- **FR-006**: Files with no templating markers MUST sync with no content changes.
- **FR-007**: The system MUST support mixing include and exclude scoped blocks within the same file.
- **FR-008**: If any file contains an invalid or unknown selector, the system MUST fail the entire sync run, show a clear error, and leave all outputs unchanged.
- **FR-008a**: Nested agent-scoped blocks MUST be treated as invalid selectors and fail the sync run.
- **FR-008b**: A scoped block with an empty agent list MUST be treated as an invalid selector and fail the sync run.
- **FR-008c**: A selector that both includes and excludes the same agent MUST be treated as invalid and fail the sync run.
- **FR-009**: Agent-scoped templating MUST behave consistently across all current syncable features (commands, skills, agents).
- **FR-010**: The system MUST ensure the same templating capability is supported by any future syncable feature.
- **FR-011**: Documentation for syncable features MUST state that agent-scoped templating is supported everywhere.
- **FR-012**: Valid agent identifiers MUST be limited to agents currently configured in the project, and error messages for invalid or unknown identifiers MUST list the valid identifiers.
- **FR-013**: The agent-scoped block format MUST use a tag-style block with a selector list followed by content, matching the form `<agents selector-list> ... </agents>` (e.g., `<agents claude,codex> ... </agents>`).
- **FR-014**: Exclusions MUST be expressed by a `not:` prefix within the selector list (e.g., `<agents not:claude,gemini> ... </agents>`).
- **FR-015**: The end of a block MUST be the first unescaped `</agents>`; `\</agents>` within content MUST be treated as literal text.
- **FR-016**: Block content MUST allow newlines and continue until the closing unescaped `</agents>`.
- **FR-017**: Agent identifier matching MUST be case-insensitive.

### Acceptance Coverage

- **FR-001 – FR-007**: Validated by User Story 1 acceptance scenarios.
- **FR-008**: Validated by User Story 3 acceptance scenarios.
- **FR-009 – FR-010**: Validated by User Story 2 acceptance scenario.
- **FR-011 – FR-012**: Validated by documentation review and identifier reference confirmation.

### Key Entities *(include if feature involves data)*

- **Agent Identifier**: The canonical name used to match a target agent in scoped blocks.
- **Template Block**: A segment of content paired with a scope rule that targets or excludes agents.

### Assumptions

- Agent identifiers are stable and already known to users through existing configuration or documentation.
- Templating is applied during sync for each agent, producing agent-specific outputs.
- If templating is not used, current sync behavior remains unchanged.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can configure a single file with at least three scoped blocks and correctly generate outputs for three different agents within 5 minutes using documented steps.
- **SC-002**: In acceptance test suites covering include and exclude rules, 100% of generated outputs contain no unintended scoped content for any agent.
- **SC-003**: Existing files without templating markers produce identical outputs before and after this feature (0 content diffs in regression tests).
- **SC-004**: Documentation for every syncable feature explicitly mentions agent-scoped templating support (100% coverage).
