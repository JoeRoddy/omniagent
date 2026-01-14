# Data Model: Honor Targets Frontmatter

**Date**: 2026-01-14  
**Feature**: `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/specs/008-honor-targets-frontmatter/spec.md`

## Entities

### Syncable File

- **Description**: A skill, subagent, or slash command with content and optional frontmatter.
- **Fields**:
  - `path`: Location in the repo.
  - `type`: One of `skill`, `subagent`, `command`.
  - `frontmatter`: Parsed metadata block (may include `targets` and `targetAgents`).
  - `content`: Markdown body to sync/convert.
- **Validation Rules**:
  - `targets` and `targetAgents` values normalize to supported target identifiers only.
  - Duplicate targets (case-insensitive) collapse to one value.

### Target Agent

- **Description**: Supported target identifier.
- **Allowed Values**: `claude`, `codex`, `copilot`, `gemini` (case-insensitive).

### Target Selection

- **Description**: Effective target set for a file in a sync run.
- **Fields**:
  - `defaultTargets`: Targets derived from frontmatter (or all supported when absent).
  - `overrideOnly`: Targets from `--only` (optional).
  - `overrideSkip`: Targets from `--skip` (optional).
  - `effectiveTargets`: Final targets after applying override rules.
- **Rules**:
  - If `overrideOnly` exists, it replaces `defaultTargets`.
  - If `overrideSkip` exists, remove those values from the active base set.
  - If no valid targets remain, `effectiveTargets` is empty and a user notice is emitted.

## Relationships

- A **Syncable File** resolves to one **Target Selection** per sync run.
- A **Target Selection** references one or more **Target Agents**.

## State Transitions

- None. Target selection is computed per run without persistent state.
