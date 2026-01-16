# Research: Shared and Local Config Sync

## Decision 1: Source discovery and precedence

- **Decision**: Treat `agents/.local/` paths and `.local` suffixes (file or skill
  directory) as local sources; if both exist for the same item, prefer
  `agents/.local/`.
- **Rationale**: Aligns with the primary path strategy while preserving the
  filename suffix fallback and clear precedence rules.
- **Alternatives considered**: Prefer filename suffix; merge content. Rejected to
  avoid ambiguity and merge complexity.

## Decision 2: Local exclusion behavior

- **Decision**: `--exclude-local` excludes all local sources; category filtering
  excludes only specified categories and errors on unknown categories.
- **Rationale**: Preserves a predictable baseline and prevents silent partial
  exclusions when input is invalid.
- **Alternatives considered**: Ignore unknown categories; warn and proceed.
  Rejected to keep behavior deterministic and testable.

## Decision 3: Ignore-rule prompt scope and location

- **Decision**: Offer to add ignore rules to repo `.gitignore` only when missing,
  only during interactive sync, and only if the user has not previously declined
  for that project.
- **Rationale**: Repo-wide `.gitignore` prevents accidental commits for all team
  members while avoiding repeated prompts or CI hangs.
- **Alternatives considered**: Always prompt, auto-apply ignores, or use
  `.git/info/exclude`. Rejected to avoid unwanted file edits or non-interactive
  blocking.

## Decision 4: Project preference identity

- **Decision**: Store the “declined ignore prompt” preference using the existing
  repo-root hash project identity used in current state storage.
- **Rationale**: Reuses established per-project state behavior and avoids
  introducing a new identity scheme.
- **Alternatives considered**: Remote URL or repo name. Rejected due to
  inconsistency with existing state scoping.

## Decision 5: Non-interactive behavior

- **Decision**: In non-interactive runs, never prompt; report missing ignore rules
  in the summary only.
- **Rationale**: Prevents blocking in CI while still surfacing missing ignores.
- **Alternatives considered**: Auto-apply ignore rules or skip reporting.
  Rejected due to side effects or loss of visibility.
