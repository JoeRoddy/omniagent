# Data Model: Sync Default Agent Generation

## Entities

### AgentPlatform

**Represents**: A supported target surface that can receive synced outputs.

**Fields**:
- `name` (string, required, unique)
- `availabilityStatus` (enum: `available`, `unavailable`)
- `availabilityReason` (string, optional; human-readable reason when unavailable)

**Validation rules**:
- `name` must match a supported platform identifier.
- `availabilityStatus` must be set for all platforms in a sync run.

---

### AvailabilityCheck

**Represents**: The local evidence used to determine platform availability.

**Fields**:
- `platformName` (string, required; references `AgentPlatform.name`)
- `signalType` (enum: `cli_on_path`)
- `result` (enum: `available`, `unavailable`, `inconclusive`)
- `warning` (string, optional; populated when result is `inconclusive`)

**Validation rules**:
- `signalType` is `cli_on_path` for this feature.
- `result` of `inconclusive` must include a `warning` message.

---

### SyncRequest

**Represents**: A user invocation of `sync` and the effective targets chosen.

**Fields**:
- `explicitTargets` (array of string, optional)
- `effectiveTargets` (array of string, required)
- `usedAvailabilityDetection` (boolean, required)

**Validation rules**:
- If `explicitTargets` is provided, `effectiveTargets` must match it exactly.
- If `explicitTargets` is omitted, `effectiveTargets` must include only platforms with `availabilityStatus = available`.

---

### SyncSummary

**Represents**: The user-facing summary of results.

**Fields**:
- `syncedTargets` (array of string, required)
- `skippedTargets` (array of objects: `name`, `reason`, required)
- `warnings` (array of string, optional)
- `exitStatus` (enum: `success`, `failed`, required)

**Validation rules**:
- `skippedTargets` entries must include a non-empty `reason`.
- `exitStatus` is `success` when no explicit error occurs, even if nothing is synced.

## Relationships

- `AvailabilityCheck.platformName` references `AgentPlatform.name`.
- `SyncRequest.effectiveTargets` should reference existing `AgentPlatform.name` values.
- `SyncSummary` is derived from the selected `effectiveTargets` and the availability checks.

## State Transitions

- `AvailabilityCheck.result`: `inconclusive` → `available` or `unavailable` on a subsequent run.
- `AgentPlatform.availabilityStatus`: `available` ↔ `unavailable` across runs based on detection.
