# Phase 0 Research: Custom Agents Directory Override

**Date**: 2026-01-18  
**Context**: Allow CLI commands to use a custom agents directory while preserving the default
`agents/` behavior.

## Decision 1: Keep the existing default agents directory

**Decision**: When `--agentsDir` is not provided, use the existing `agents/` directory with no
behavior changes.

**Rationale**: Preserves current workflows and avoids breaking existing setups.

**Alternatives considered**: Changing the default path (breaks users); prompting for a directory
(non-deterministic CLI behavior).

## Decision 2: Resolve relative overrides from the project root

**Decision**: Resolve relative `--agentsDir` paths from the project root (same base as the default
`agents/` directory).

**Rationale**: Ensures consistent behavior regardless of the current working directory and matches
existing path assumptions.

**Alternatives considered**: Resolve from current working directory (inconsistent across commands);
require absolute paths (adds friction for users).

## Decision 3: Fail fast on invalid directories

**Decision**: If the provided directory is missing, inaccessible, or not a directory, stop with a
clear error and do not fall back to any other path.

**Rationale**: Prevents accidental reads/writes in unexpected locations and makes mistakes obvious.

**Alternatives considered**: Silent fallback to default (hides misconfiguration); auto-create
missing directories (could create unwanted folders).
