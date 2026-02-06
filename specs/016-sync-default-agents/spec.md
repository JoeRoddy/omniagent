# Feature Specification: Sync Default Agent Generation

**Feature Branch**: `016-sync-default-agents`  
**Created**: 2026-02-06  
**Status**: Draft  
**Input**: User description: "read github issue 26 and base your specification off of that. use the gh cli"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Default to installed agents (Priority: P1)

As a user running the `sync` command without an explicit target filter, I want the system to sync only the agent platforms available on my machine so I do not get unused configuration outputs.

**Why this priority**: This is the default path and directly affects every user who runs `sync` without extra flags.

**Independent Test**: Can be fully tested by running `sync` on a machine with a known set of installed agent platforms and confirming only those outputs are generated.

**Acceptance Scenarios**:

1. **Given** two supported agent platforms are available and one is not, **When** I run `sync` without an explicit target filter, **Then** outputs are generated only for the available platforms, the unavailable platform is skipped, and the summary explains the skip reason.
2. **Given** exactly one supported agent platform is available, **When** I run `sync` without an explicit target filter, **Then** only that platform is synced and no other outputs are created.

---

### User Story 2 - Explicitly request unavailable targets (Priority: P2)

As a user, I want to explicitly request specific targets even if they are not detected on my machine so I can prepare configurations ahead of time or for another environment.

**Why this priority**: Explicit intent should override auto-detection to keep the command flexible for advanced workflows.

**Independent Test**: Can be fully tested by running `sync` with an explicit target list that includes a not-detected platform and verifying the requested outputs are still produced.

**Acceptance Scenarios**:

1. **Given** a supported target is not detected as available, **When** I run `sync` with an explicit target list including that target, **Then** the system syncs that target and does not sync any targets not in the list.

---

### User Story 3 - No available targets (Priority: P3)

As a user on a machine without any supported agent platforms, I want a clear, actionable result when I run `sync` so I understand why nothing was generated.

**Why this priority**: A clear outcome prevents confusion and reduces support requests.

**Independent Test**: Can be fully tested by running `sync` on a machine with no detectable agent platforms and confirming no outputs are created while a clear message is provided.

**Acceptance Scenarios**:

1. **Given** no supported agent platforms are available, **When** I run `sync` without an explicit target filter, **Then** the system makes no output changes and reports that no available targets were found with guidance to install an agent or use an explicit target list.

---

### Edge Cases

- Availability checks are inconclusive (for example, missing permissions or inaccessible user directories).
- The user explicitly requests a target name that is not recognized as a supported platform.
- Availability changes between runs (an agent is installed or removed after a prior sync).
- Multiple supported agent platforms are available, and only a subset is explicitly requested.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When `sync` is invoked without an explicit target filter, the system MUST determine which supported agent platforms are available on the user's system using local signals.
- **FR-002**: When no explicit target filter is provided, the system MUST sync only the available platforms and MUST NOT generate outputs for unavailable platforms.
- **FR-003**: When an explicit target list is provided, the system MUST sync exactly those targets regardless of availability detection results.
- **FR-004**: The system MUST provide a clear summary showing which targets were synced and which were skipped, including the reason for any skips.
- **FR-005**: If no targets are available and no explicit target list is provided, the system MUST make no output changes and MUST provide an actionable message.

### Key Entities *(include if feature involves data)*

- **Agent Platform**: A supported target surface that can receive synced outputs, identified by name and availability status.
- **Availability Check**: The local evidence used to determine whether a platform is present on the user's system.
- **Sync Request**: The user's invocation, including any explicit target list and the resulting effective targets.
- **Sync Summary**: The user-facing report of synced and skipped targets with reasons.

## Assumptions

- The `sync` command already supports an explicit target filter (for example, via an `--only` flag).
- Supported agent platforms are defined by the product and are discoverable by local, offline signals.
- The system can present user-facing messages alongside sync results without changing the core sync workflow.
- If a user explicitly requests an unsupported target name, existing validation will surface a clear error.

## Dependencies

- A maintained list of supported agent platforms is available to the sync workflow.
- Each supported platform has a reliable local signal that indicates availability on the user's system.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a test matrix covering all supported platforms, running `sync` without an explicit target filter results in zero outputs created for platforms that are not detected as available.
- **SC-002**: When no supported platforms are available, 100% of test runs complete without output changes and provide a clear, actionable message.
- **SC-003**: When an explicit target list is provided, 100% of requested targets are synced, even if they are not detected as available.
- **SC-004**: In usability testing, at least 90% of participants can correctly explain why a target was or was not synced based on the summary output.
