# Data Model: Shared and Local Config Sync

## Config Item

Represents a single skill, agent, or command in shared or local sources.

- **Fields**:
  - `name` (string): Canonical item name used for conflict resolution.
  - `category` (enum): `skills`, `agents`, `commands`.
  - `sourceType` (enum): `shared`, `local`.
  - `sourcePath` (string): Absolute or repo-relative origin path.
  - `contentHash` (string): Hash used for change detection.
  - `isLocalFallback` (boolean): True when sourced via a `.local` suffix (file or
    skill directory).

- **Relationships**:
  - Belongs to one **Sync Run**.

## Local Source Marker

Describes how an item was designated as local.

- **Fields**:
  - `markerType` (enum): `path`, `suffix`.
  - `path` (string): `agents/.local/...` directory or filename/directory with
    `.local`.

- **Relationships**:
  - Applies to one or more **Config Items**.

## Sync Run

Represents a single invocation of `omniagent sync`.

- **Fields**:
  - `startedAt` (timestamp)
  - `mode` (enum): `default`, `excludeAllLocal`, `excludeLocalByCategory`,
    `listLocal`.
  - `excludedCategories` (string[]): Categories omitted when using
    `excludeLocalByCategory`.
  - `summaryCounts` (object): Counts for shared and local items applied.
  - `missingIgnoreRules` (boolean): Whether ignore rules are missing at run time.
  - `promptSuppressed` (boolean): True when prompts are skipped due to
    non-interactive mode or prior decline.

- **Relationships**:
  - Contains many **Config Items**.

## Ignore Suggestion

Captures the proposed ignore rules and user decision.

- **Fields**:
  - `rules` (string[]): `agents/.local/`, `**/*.local/`, `**/*.local.md`.
  - `decision` (enum): `accepted`, `declined`, `notShown`.

- **Relationships**:
  - Associated with one **Sync Run**.

## Project Preference

Stores per-project user choices about ignore prompts.

- **Fields**:
  - `projectId` (string): Hash of repo root path.
  - `ignorePromptDeclined` (boolean)
  - `updatedAt` (timestamp)

- **Relationships**:
  - Applied to multiple **Sync Runs** for the same project.
