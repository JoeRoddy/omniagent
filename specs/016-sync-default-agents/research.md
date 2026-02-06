# Research: Sync Default Agent Generation

**Date**: 2026-02-06

## Decision 1: Availability signal uses CLI on `PATH`

**Decision**: A platform is considered available only if its CLI executable is found on the user's `PATH`.

**Rationale**: Config directories can be left behind after uninstall; relying on the CLI avoids false positives and matches the user's actual ability to run the agent.

**Alternatives considered**:
- Use config directory presence only (rejected due to stale configs)
- Use either CLI or config (rejected due to false positives)
- Require both CLI and config (rejected because config may not exist yet for new installs)

## Decision 2: Explicit target list overrides availability

**Decision**: When an explicit target list is provided, the system syncs those targets even if the CLI is not detected.

**Rationale**: Explicit intent supports preparing configs for another environment or pre-install scenarios.

**Alternatives considered**:
- Skip unavailable targets even when explicitly requested (rejected due to reduced flexibility)
- Fail the command for unavailable explicit targets (rejected as too strict for preparation workflows)

## Decision 3: No available targets results in a successful no-op

**Decision**: If no platforms are available and no explicit target list is provided, the command exits successfully, makes no changes, and provides an actionable message.

**Rationale**: This avoids breaking automation while still guiding the user to install an agent or use explicit targets.

**Alternatives considered**:
- Fail with an error (rejected due to unnecessary failure for a recoverable state)
- Use a special warning exit code (rejected to keep tooling compatibility)

## Decision 4: Inconclusive availability checks are treated as unavailable

**Decision**: If detection cannot be completed (permissions/inaccessible paths), treat the platform as unavailable, skip it, and warn.

**Rationale**: Conservative behavior prevents unintended output generation while still surfacing the detection problem.

**Alternatives considered**:
- Treat as available and sync (rejected due to risk of syncing without confirmation)
- Fail the command (rejected as too disruptive for partial availability issues)

## Decision 5: Preserve outputs when a platform becomes unavailable

**Decision**: If a previously synced platform becomes unavailable and no explicit target list is provided, existing outputs remain unchanged; the platform is skipped with a warning.

**Rationale**: Avoids destructive changes and preserves user state across environment changes.

**Alternatives considered**:
- Remove outputs for unavailable platforms (rejected due to data loss risk)
- Fail the command (rejected as overly strict)
