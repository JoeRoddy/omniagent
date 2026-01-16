# Feature Specification: Shared and Local Config Sync

**Feature Branch**: `009-local-config-sync`  
**Created**: January 15, 2026  
**Status**: Draft  
**Input**: User description: "User-Facing Proposal: Shared + Local Config. Goals: keep team-shared
config in the repo, keep personal/local config out of the repo, and make sync behave
sensibly by default with easy overrides. Shared (team, committed): agents/skills/,
agents/agents/, agents/commands/. Local (personal, not committed):
agents/.local/skills/, agents/.local/agents/, agents/.local/commands/. Secondary
option: .local suffixes as a fallback (skill directory suffixes like
review-helper.local/SKILL.md, or file-level suffixes like SKILL.local.md,
deploy.local.md). Default behavior: omniagent sync includes shared + local and
reports local counts. Exclude local when needed: omniagent sync --exclude-local
for shared only; --exclude-local=skills,commands to exclude some categories. Local
is a source marker only: outputs are clean (no .local). If local matches shared by
name, local wins when included. When local is present, tool can offer to add ignore
rules for agents/.local/, **/*.local/, and **/*.local.md. omniagent sync --list-local
shows which files are considered local."

## Clarifications

### Session 2026-01-15

- Q: Which ignore file should be updated when offering to add local ignore rules?
  → A: Repo .gitignore (team-wide)
- Q: When should the ignore-rule prompt appear?
  → A: During sync only when ignore rules are missing and the user has not
  previously declined for that project.
- Q: What project identity should be used to store the “declined” preference?
  → A: Same per-project identifier used by existing repo state (repo root path
  hash).
- Q: Should ignore prompts appear in non-interactive runs?
  → A: No; report missing ignores in summary only.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Default sync includes local overrides (Priority: P1)

As a developer, I want a single sync command to apply both shared and my local
config so my machine behaves as expected without extra flags.

**Why this priority**: This is the default behavior and affects every sync run.

**Independent Test**: Run sync in a repo with shared items and local overrides;
verify local content is applied and outputs are normalized without .local.

**Acceptance Scenarios**:

1. **Given** shared and local items with the same name, **When** I run
   `omniagent sync` with no flags, **Then** the local item is used in outputs and
   the output filename contains no ".local" marker.
2. **Given** local items are present, **When** I run `omniagent sync`, **Then** the
   summary reports how many local items were applied.
3. **Given** the same local item exists in agents/.local/ and as a .local suffix
   (file or skill directory), **When** I run `omniagent sync`, **Then** the
   agents/.local/ version is used in outputs.

---

### User Story 2 - Shared-only sync for team checks (Priority: P2)

As a team member or CI runner, I want to exclude local items so I can verify the
shared baseline without personal overrides.

**Why this priority**: Teams need a predictable shared-only view for reviews and
automation.

**Independent Test**: Run sync with `--exclude-local` and confirm only shared
items are applied.

**Acceptance Scenarios**:

1. **Given** local items exist, **When** I run `omniagent sync --exclude-local`,
   **Then** only shared items are applied and the summary indicates local items
   were excluded.
2. **Given** local items exist across categories, **When** I run
   `omniagent sync --exclude-local=skills,commands`, **Then** local items for
   skills and commands are excluded while other local categories still apply.
3. **Given** I pass an unknown category to `--exclude-local`, **When** I run
   `omniagent sync`, **Then** the tool reports the invalid category and does not
   apply any partial exclusions.

---

### User Story 3 - Inspect local items and ignore guidance (Priority: P3)

As a developer, I want to list local items and optionally add ignore rules so I do
not accidentally commit personal content.

**Why this priority**: Visibility and safe defaults reduce accidental commits.

**Independent Test**: Use `--list-local` and confirm all local items are reported;
accept the ignore suggestion to confirm rules are added.

**Acceptance Scenarios**:

1. **Given** local items exist, **When** I run `omniagent sync --list-local`,
   **Then** I see every local item listed with its category.
2. **Given** local items exist and ignore rules are missing, **When** I run
   `omniagent sync`, **Then** the tool offers to add ignore rules and only updates
   ignores after I confirm.
3. **Given** I previously declined the ignore offer for this project, **When** I
   run `omniagent sync` and ignore rules are still missing, **Then** I am not
   prompted again.
4. **Given** sync runs non-interactively and ignore rules are missing, **When**
   `omniagent sync` completes, **Then** no prompt appears and the summary reports
   missing ignore rules.

---

### Edge Cases

- Local and shared items share the same name in multiple categories.
- A local item exists both in agents/.local/ and as a .local suffix (file or skill
  directory).
- No local items exist; list-local should report none and no ignore suggestion is
  shown.
- A user passes an unknown category in --exclude-local; the tool should report the
  invalid category and not apply partial exclusions.
- A user previously declined the ignore prompt; sync should not prompt again even
  if ignore rules are still missing.
- A repo cloned into a new path does not reuse the prior decline preference.
- A non-interactive sync run should not block on ignore prompts.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST treat items under agents/skills/, agents/agents/, and
  agents/commands/ as shared sources.
- **FR-002**: System MUST treat items under agents/.local/skills/,
  agents/.local/agents/, and agents/.local/commands/ as local sources.
- **FR-003**: System MUST treat .local suffixes in shared directories as local
  sources (file-level suffixes for commands and subagents, and skill directory
  suffixes for skills).
- **FR-004**: System MUST include both shared and local sources by default when
  running `omniagent sync`.
- **FR-005**: When a local item matches a shared item by name, the local item MUST
  take precedence when local sources are included.
- **FR-006**: When `--exclude-local` is provided, the system MUST exclude all local
  items from the sync output.
- **FR-007**: When `--exclude-local` specifies categories, the system MUST exclude
  local items only for those categories while including other local categories.
- **FR-008**: Sync outputs MUST never include the .local marker in filenames or
  paths, regardless of source.
- **FR-009**: Sync summaries MUST report how many shared and local items were
  applied and whether local sources were excluded.
- **FR-010**: The system MUST provide `omniagent sync --list-local` to enumerate
  all local items with their categories and source paths.
- **FR-011**: When local items are detected and ignore rules are missing, the
  system MUST offer to add ignore rules to the repo .gitignore for agents/.local/,
  **/*.local/, and **/*.local.md ONLY if the user has not previously declined for
  that project, and MUST only apply changes after explicit user confirmation.
- **FR-012**: If the same local item is defined via both agents/.local/ and a
  .local filename suffix, the agents/.local/ version MUST take precedence.
- **FR-013**: If `--exclude-local` includes an unknown category, the system MUST
  report the invalid category and avoid applying partial exclusions.
- **FR-014**: If a user declines the ignore-rule offer, the system MUST record a
  per-project preference that suppresses future ignore prompts for that project.
- **FR-015**: The per-project preference MUST be keyed using the existing repo
  state identifier derived from the repo root path.
- **FR-016**: In non-interactive runs, the system MUST not prompt for ignore
  rules and MUST instead report missing ignore rules in the summary.

### Key Entities *(include if feature involves data)*

- **Config Item**: A skill, agent, or command with name, category, source type
  (shared or local), and content.
- **Local Source Marker**: The indicator that a config item is local, either a
  agents/.local/ path or a .local suffix (file or skill directory).
- **Sync Run**: One execution of sync with options and a resulting summary of
  applied items.
- **Ignore Suggestion**: A proposed set of ignore rules and the user's decision to
  accept or decline.
- **Project Preference**: A per-project record of whether the user declined the
  ignore-rule offer, keyed by the repo root path hash.

### Assumptions

- Shared sources always live under the agents/ directory with the three supported
  categories.
- The ignore suggestion is only offered when local items exist and the ignore
  rules are not already present.
- Local sources are intended to affect only the current user's environment and do
  not change shared outputs for others.

### Dependencies

- The existing sync command can enumerate items from the shared agents/ structure.
- The repo already uses the agents/ directory as the shared configuration root.

### Out of Scope

- Sharing or syncing local items across team members.
- Automatic modification of ignore files without user confirmation.
- Managing local items outside the defined directories or .local suffix
  (file/directory).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a repo with both shared and local items, 100% of local overrides
  are applied during `omniagent sync`, and 0 output files contain the .local marker.
- **SC-002**: Running `omniagent sync --exclude-local` produces outputs that match
  the shared-only baseline and reports 0 local items applied.
- **SC-003**: Running `omniagent sync --exclude-local=skills,commands` excludes
  only local skills and commands while still applying other local categories.
- **SC-004**: `omniagent sync --list-local` lists all local items and categories
  with zero omissions for a test set of at least 50 local items, completing in
  under 2 seconds.
- **SC-005**: When local items are present and ignore rules are missing, the tool
  presents a single ignore suggestion per run and does not re-prompt once the
  rules are accepted.
- **SC-006**: After a user declines the ignore offer for a project, subsequent
  sync runs for that project show zero ignore prompts.
- **SC-007**: In non-interactive runs, zero ignore prompts appear and missing
  ignore rules are reported in the summary.
