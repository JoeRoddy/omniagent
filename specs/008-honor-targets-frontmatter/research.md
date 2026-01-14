# Research: Honor Targets Frontmatter

**Date**: 2026-01-14  
**Feature**: `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/specs/008-honor-targets-frontmatter/spec.md`

## Decisions

### 1) Extend existing frontmatter parsing across all syncable features

- **Decision**: Reuse current frontmatter parsing and target selection logic, extending it to
  skills and subagents with shared normalization for `targets` and `targetAgents`.
- **Rationale**: The system already parses frontmatter and applies target filtering for slash
  commands; extending the same normalization minimizes divergence and keeps behavior consistent.
- **Alternatives considered**: Implement feature-specific target logic per file type (rejected due
  to duplication and higher risk of inconsistent behavior).

### 2) Unified effective-target resolution with CLI overrides

- **Decision**: Define a single resolution step: if `--only` is provided, it replaces defaults; then
  apply `--skip`. If `--only` is absent, start from per-file defaults (or all supported if none),
  then apply `--skip`.
- **Rationale**: Matches clarified CLI semantics while keeping the override logic centralized and
  testable.
- **Alternatives considered**: Filtering only within frontmatter (rejected; conflicts with clarified
  override behavior).

### 3) Strip target metadata from generated outputs

- **Decision**: Remove `targets` and `targetAgents` from all generated outputs and conversions.
- **Rationale**: Prevents leaking targeting metadata into target tools and enforces a clean output
  contract.
- **Alternatives considered**: Preserve metadata for debugging (rejected; violates spec requirement
  and could confuse target tools).
