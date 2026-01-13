# Feature Specification: Sync Custom Slash Commands

**Feature Branch**: `005-sync-slash-commands`  
**Created**: 2026-01-11  
**Status**: Draft  
**Input**: User description: "add support for syncing custom slash commands for each ai agent. do research into how each agent lets users define slash commands, if at all: https://cloud.google.com/blog/topics/developers-practitioners/gemini-cli-custom-slash-commands https://code.claude.com/docs/en/slash-commands#custom-slash-commands https://github.com/github/copilot-cli/issues/618 maybe unsupported? not sure for codex theyre stored and pulled from ~/.codex/prompts note that codex does NOT support custom prompts (slash commands) on a per project basis, only via global config: https://github.com/openai/codex/issues/4734 for agents that dont support custom slash commands, we should allow the user to opt in to mapping them to skills. for the codex issue, we should warn the user that custom slash commands dont work on a project level, and give them a multiselect option: configure globally, convert to a skill, skip (dont configure slash commands for codex)"

## Clarifications

### Session 2026-01-11

- Q: Should command catalogs be shared across agents or separate per agent? → A: One shared command catalog synced to selected agents (no per-agent variants).
- Q: For Codex only, when converting slash commands to skills, should the user choose scope? → A: Use global scope by default (no scope prompt in the CLI for now).
- Q: For unsupported agents (Copilot), should conversion be opt-in? → A: Convert to skills by default; skip by excluding the target.
- Q: Should sync remove commands that are no longer in the shared catalog? → A: Remove only previously-synced commands that are no longer in the catalog, leaving unrelated commands untouched.
- Q: Should command names be unique case-insensitively? → A: Yes, command names must be unique case-insensitively.
- Q: Should sync support non-interactive confirmation? → A: Yes, support both preview + confirmation and a --yes flag that accepts defaults.
- Q: How should canonical slash commands be stored in the repo? → A: One Markdown file per command under agents/commands/, with the filename defining the command name.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sync commands to supported agents (Priority: P1)

As a developer using omniagent, I want my custom slash commands to sync to each AI agent that supports them, so I can reuse consistent workflows across tools.

**Why this priority**: This is the core value of the feature and enables cross-agent consistency.

**Independent Test**: Can be fully tested by defining a small set of commands and running a sync to two supported agents, then confirming the commands appear in each agent at the default scope.

**Acceptance Scenarios**:

1. **Given** a set of custom slash commands and two agents that support custom commands, **When** I run sync, **Then** the commands are available using the default local scope for Claude/Gemini (project) and the summary reports the actions taken.
2. **Given** no changes since the last successful sync, **When** I run sync again, **Then** no additional changes are made and the summary reports that nothing changed.

---

### User Story 2 - Default fallback for unsupported agents (Priority: P2)

As a user, when an agent does not support custom slash commands, I want commands converted to skills by default so I still get value, and I can skip that agent by excluding it from the sync.

**Why this priority**: Users need a graceful path for agents without support to avoid confusion and lost work.

**Independent Test**: Can be fully tested by selecting an unsupported agent and verifying skills are created, then excluding the target and confirming no outputs are produced.

**Acceptance Scenarios**:

1. **Given** an agent that does not support custom slash commands, **When** I include it in a sync, **Then** those commands are converted into skills and listed with the original command names.
2. **Given** an agent that does not support custom slash commands, **When** I exclude it from the sync, **Then** no commands are applied for that agent and no output is produced for that target.

---

### User Story 3 - Make the Codex-specific choice (Priority: P3)

As a user syncing to Codex, I need a clear warning that project-level custom slash commands are not supported, along with options to proceed in a supported way.

**Why this priority**: Codex has a known limitation that affects how users should configure commands.

**Independent Test**: Can be fully tested by syncing to Codex and confirming the warning plus each option behaves as expected.

**Acceptance Scenarios**:

1. **Given** Codex is selected as a sync target, **When** sync starts, **Then** I am warned about the lack of project-level custom commands and offered options to configure globally or convert to skills.
2. **Given** I choose one of the options, **When** sync completes, **Then** the result matches my choice and the summary reflects the action.
3. **Given** I choose to convert to skills for Codex, **When** sync completes, **Then** the conversion uses global scope by default (no scope prompt in the CLI).

---

### Edge Cases

- What happens when a custom slash command name conflicts with a built-in command in a target agent?
- How does the system handle duplicate command names across the user's command set?
- What happens when a target agent already has a command with the same name but different content?
- How does the system behave when one agent fails to sync but others succeed?
- What happens if a user selects a project-level scope for an agent that only supports global commands?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow users to define a single shared catalog of custom slash commands intended for syncing, stored as one Markdown file per command under `agents/commands/` with the filename defining the command name.
- **FR-002**: The system MUST let users select which agents should receive synced commands.
- **FR-003**: The system MUST default to project scope for agents that support both project and global (Claude/Gemini), unless explicitly overridden by input parameters.
- **FR-004**: The system MUST surface each agent's custom command support and scope limitations before applying changes.
- **FR-005**: The system MUST sync commands only to agents that support custom slash commands and report what was created, updated, or skipped.
- **FR-006**: The system MUST provide conflict resolution choices (overwrite, rename, or skip) when a target agent already has a command with the same name but different content.
- **FR-006a**: The system MUST remove previously-synced commands that are no longer present in the shared catalog, while leaving unrelated commands untouched.
- **FR-007**: For agents that do not support custom slash commands (Copilot), the system MUST convert commands into skills by default; skipping is done by excluding the target.
- **FR-008**: For Codex, the system MUST warn that project-level custom slash commands are not supported and provide options to configure globally or convert to skills.
- **FR-009**: The system MUST ensure that running sync without changes results in no modifications and a "no changes" summary.
- **FR-010**: The system MUST provide a preview or summary of planned actions before applying changes, including counts of commands to create, update, convert, or skip per agent.
- **FR-011**: The system MUST not support per-agent command variants or overrides within the shared catalog.
- **FR-012**: When Codex conversion to skills is selected, the system MUST use global scope by default (no scope prompt in the CLI).
- **FR-013**: The system MUST enforce unique command names in the shared catalog using case-insensitive comparison.
- **FR-014**: The system MUST support a non-interactive confirmation mode that accepts defaults (e.g., a --yes flag) while still producing the preview or summary.
- **FR-015**: The system MUST treat Claude Code slash command definitions as the source of truth when target agents differ, and map that canonical definition to other targets.

### Key Entities *(include if feature involves data)*

- **Slash Command Definition**: A user-defined command in the shared catalog stored as a Markdown file under `agents/commands/` with a filename-derived name, content, and selected target agents.
- **Agent Capability Profile**: A record of whether an agent supports custom slash commands and what scopes are available.
- **Sync Decision**: The per-agent defaults and choices made during a sync (scope defaults, conversion behavior, or exclusion).
- **Skill Mapping**: The representation of a slash command converted into a skill, retaining the original command name and the applied scope (project or global) when applicable.

## Assumptions

- Sync is one-way from omniagent configuration to each agent's command configuration; importing existing agent commands is out of scope.
- When an agent supports both project and personal/global scopes, the default choice is project scope (local) for now.
- Skill conversions create project-scoped skills by default; for Codex, conversions default to global scope in the CLI.

## Constraints & Dependencies

- Initial sync targets in scope: Gemini CLI, Claude Code, GitHub Copilot CLI, and Codex.
- Known capability differences: Gemini CLI and Claude Code support both project and personal/global commands, Codex supports global commands only, and GitHub Copilot CLI does not support custom slash commands.
- When agent definitions differ, Claude Code command standards are the source of truth for canonical command formatting.
- The sync experience must adapt to changes in agent capabilities over time without breaking existing user workflows.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can sync a set of up to 25 custom slash commands to at least two supported agents in under 2 minutes.
- **SC-002**: Re-running sync without changes results in no additional prompts or modifications in 100% of test cases.
- **SC-003**: At least 90% of users successfully complete a fallback flow for unsupported agents (automatic conversion) on the first attempt.
- **SC-004**: At least 95% of sync runs complete with a clear per-agent outcome summary (created, updated, converted, skipped, failed).
