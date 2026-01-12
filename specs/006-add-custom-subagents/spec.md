# Feature Specification: Sync Custom Subagents

**Feature Branch**: `006-add-custom-subagents`  
**Created**: 2026-01-11  
**Status**: Draft  
**Input**: User description: "implement support for custom subagents. currently, i believe only claude code supports sub agents (research our supported targets to confirm this). our format will be the exact same as claude code. for non-supported targets, we will translate them into an equivalent skill. the translation will be simply making it a SKILL.md file, with the same contents. we will take the name from the agent frontmatter first, and fallback to the file name if the frontmatter doesnt have one. we will then apply that to .<providertarget>/<agentname>/SKILL.md you can see an example claude code subagent here: .claude/agents/code-improver.md claude code custom subagent docs are here: https://code.claude.com/docs/en/sub-agents"

## Clarifications

### Session 2026-01-11

- Q: Where is the canonical subagent catalog stored? → A: `agents/agents/`.
- Q: Should removed subagents be deleted from targets? → A: Remove only previously managed subagent/skill outputs no longer in the canonical catalog.
- Q: How should unsupported targets be handled by default? → A: Always convert subagents to skills unless the target is excluded.
- Q: How should name collisions be handled? → A: Fail the sync with a clear error listing the conflicting files.
- Q: How should invalid/unreadable frontmatter be handled? → A: Fail the sync with a clear error.
- Q: How should conflicts with existing target subagent/skill files be handled? → A: Skip and warn about the conflict.
- Q: How should a missing/empty canonical catalog be handled? → A: Treat as no subagents and remove previously managed outputs.
- Q: How should non-Markdown or empty subagent files be handled? → A: Fail the sync with a clear error.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sync subagents to Claude Code (Priority: P1)

As a developer using agentctrl, I want to define custom subagents once and sync them to Claude Code so my team can use consistent specialized agents inside the project.

**Why this priority**: This is the core value of subagent support and enables shared, project-level agent behavior.

**Independent Test**: Can be fully tested by adding one subagent to the canonical catalog, running sync for Claude Code only, and verifying the subagent appears in the project with matching content.

**Acceptance Scenarios**:

1. **Given** a canonical subagent catalog and Claude Code selected as a target, **When** I run sync, **Then** each subagent is created/updated in the project-level Claude subagent directory with its resolved name.
2. **Given** no changes in the canonical catalog, **When** I run sync again, **Then** no files change and the summary reports no changes.

---

### User Story 2 - Convert subagents to skills for unsupported targets (Priority: P2)

As a developer, when a target does not support Claude-format subagents, I want those subagents converted into skills so I still get the instructions on that platform.

**Why this priority**: Users need a graceful fallback for targets without subagent support to avoid losing value.

**Independent Test**: Can be fully tested by selecting a non-supported target and confirming a SKILL.md is created with the same content as the subagent definition.

**Acceptance Scenarios**:

1. **Given** a target that does not support Claude-format subagents, **When** I run sync, **Then** each subagent is converted to a skill at the target’s standard skills location with identical content.
2. **Given** I exclude a non-supported target from sync, **When** sync completes, **Then** no subagent-derived files are created for that target.

---

### User Story 3 - Predictable naming and conflict handling (Priority: P3)

As a user, I want predictable subagent naming and clear error messages if names conflict, so I can manage and update subagents reliably.

**Why this priority**: Consistent naming prevents ambiguous updates and accidental overwrites.

**Independent Test**: Can be fully tested by creating a subagent with a frontmatter name and another without, then ensuring names resolve correctly and conflicts are detected.

**Acceptance Scenarios**:

1. **Given** a subagent file with a frontmatter name, **When** sync runs, **Then** the derived subagent name matches the frontmatter name rather than the filename.
2. **Given** a subagent file with no frontmatter name, **When** sync runs, **Then** the derived subagent name matches the filename (without extension).
3. **Given** two subagent files that resolve to the same name, **When** sync starts, **Then** the run fails with a clear error listing the conflicting files.

---

### Edge Cases

- Invalid or unreadable YAML frontmatter causes sync to fail with a clear error.
- Subagent names that differ only by case are treated as collisions and cause sync to fail.
- If a target already has a subagent/skill with the same name but different content, sync skips that item and warns the user.
- When the canonical subagent directory is missing or empty, sync treats it as “no subagents” and removes previously managed outputs.
- Non-Markdown or empty subagent files cause sync to fail with a clear error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow a canonical catalog of custom subagents stored in `agents/agents/`, with one Markdown file per subagent using the Claude Code subagent format (YAML frontmatter + prompt body).
- **FR-002**: The system MUST derive the subagent identifier from the frontmatter `name` field when present; otherwise it MUST use the filename without extension.
- **FR-003**: The system MUST enforce unique subagent identifiers using case-insensitive comparison and fail the sync with a clear error if collisions exist.
- **FR-003a**: The system MUST fail the sync with a clear error when subagent frontmatter is invalid or unreadable.
- **FR-004**: The system MUST sync subagents to targets that support Claude-format subagents by writing them to the target’s project-level subagent directory using the derived name.
- **FR-005**: For targets that do not support Claude-format subagents, the system MUST create an equivalent skill by writing a `SKILL.md` with identical content in the target’s standard skills location (for example, `.codex/skills/<agentname>/SKILL.md`).
- **FR-006**: The system MUST preserve subagent content verbatim during sync and conversion, including frontmatter and body.
- **FR-007**: The system MUST include subagent actions in the sync preview/summary with per-target counts of created, updated, converted, and skipped items.
- **FR-008**: The system MUST respect existing target filters (only/skip) when syncing subagents.
- **FR-009**: The system MUST avoid modifying unrelated target files and only update subagent/skill files previously managed by agentctrl, removing previously managed outputs that are no longer in the canonical catalog.
- **FR-010**: The system MUST warn when a selected target does not support Claude-format subagents and indicate that conversion to skills will occur.
- **FR-011**: The system MUST default to converting subagents into skills for targets that do not support Claude-format subagents; skipping is done by excluding the target.
- **FR-012**: When a target already has a subagent/skill with the same name but different content, the system MUST skip that item and warn the user.
- **FR-013**: When the canonical subagent catalog is missing or empty, the system MUST treat it as “no subagents” and remove previously managed subagent/skill outputs.
- **FR-014**: The system MUST fail the sync with a clear error when a subagent file is not Markdown or has empty content.

### Key Entities *(include if feature involves data)*

- **Subagent Definition**: A Markdown file in the canonical catalog that defines a subagent’s configuration and prompt.
- **Derived Subagent Name**: The resolved identifier for a subagent, taken from frontmatter `name` or the filename fallback.
- **Target Subagent Output**: The project-level subagent file written for a supported target.
- **Converted Skill Output**: The skill artifact created from a subagent for unsupported targets.
- **Sync Summary**: The per-target record of created, updated, converted, and skipped subagent actions.

## Assumptions

- Canonical subagent definitions are project-scoped and version-controlled in the repository.
- Subagent sync is one-way from the canonical catalog to target configurations; importing from targets is out of scope.
- Skill conversions use each target’s existing skills directory structure and naming conventions.

## Constraints & Dependencies

- Supported targets remain Claude Code, OpenAI Codex, GitHub Copilot CLI, and Gemini CLI.
- Only Claude Code is treated as supporting the Claude-format subagent files; other targets use skill conversion.
- When target formats differ, the Claude Code subagent definition is the source of truth.
- The feature integrates with the existing sync workflow, including target selection and summary reporting.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can sync up to 20 subagents to at least one target in under 2 minutes.
- **SC-002**: 100% of subagent names resolve deterministically according to frontmatter-first, filename-fallback rules in test cases.
- **SC-003**: Re-running sync without catalog changes results in zero file modifications in 100% of test runs.
- **SC-004**: At least 90% of users successfully complete a conversion flow for unsupported targets on the first attempt in usability tests.
