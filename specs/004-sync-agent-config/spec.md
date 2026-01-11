# Feature Specification: Sync Agent Config

**Feature Branch**: `004-sync-agent-config`  
**Created**: January 10, 2026  
**Status**: Draft  
**Input**: User description: "create a cli command called sync that synchronizes the agent config to all target agents. here is an example shell script from another project that inspired this oss project: set -euo pipefail ROOT_DIR=$(cd $(dirname ${BASH_SOURCE[0]})/.. && pwd) SRC=$ROOT_DIR/agents/skills usage() { cat <<EOF Sync shared coding agent configs to multiple destinations. Usage: ./agents/sync.sh Options: --skip Skip one or more destinations (names: codex, claude, copilot) ./agents/sync.sh --skip codex,copilot --only Sync only the listed destinations (names: codex, claude, copilot) ./agents/sync.sh --only claude --help Show this help text EOF } if [[ ! -d $SRC ]]; then echo Source skills directory not found: $SRC >&2 exit 1 fi DESTS=( codex:$ROOT_DIR/.codex/skills claude:$ROOT_DIR/.claude/skills copilot:$ROOT_DIR/.github/skills ) SKIP=() ONLY=() while [[ $# -gt 0 ]]; do case $1 in --skip) shift IFS=, read -r -a SKIP <<< ${1:-} ;; --only) shift IFS=, read -r -a ONLY <<< ${1:-} ;; -h|--help) usage exit 0 ;; *) echo Unknown option: $1 >&2 usage >&2 exit 2 ;; esac shift done if [[ ${#SKIP[@]} -gt 0 && ${#ONLY[@]} -gt 0 ]]; then echo Use either --skip or --only, not both. >&2 exit 2 fi should_sync() { local name=$1 if [[ ${#ONLY[@]} -gt 0 ]]; then for item in ${ONLY[@]}; do [[ $item == $name ]] && return 0 done return 1 fi if [[ ${#SKIP[@]} -gt 0 ]]; then for item in ${SKIP[@]}; do [[ $item == $name ]] && return 1 done fi return 0 } for entry in ${DESTS[@]}; do name=${entry%%:*} dest=${entry#*:} if [[ $SRC == $ROOT_DIR/* ]]; then src_display=${SRC#$ROOT_DIR/} else src_display=$SRC fi if [[ $dest == $ROOT_DIR/* ]]; then dest_display=${dest#$ROOT_DIR/} else dest_display=$dest fi if ! should_sync $name; then echo Skipped $src_display -> $dest_display continue fi mkdir -p $dest rsync -a $SRC/ $dest/ echo Synced $src_display -> $dest_display done"

## Clarifications

### Session 2026-01-10

- Q: Should sync delete destination-only files? → A: Non-destructive; overwrite source files and keep extra destination files.
- Q: Should the command work from any repo subdirectory? → A: Yes; resolve repo root automatically.
- Q: Should missing-source errors reference the repo root path? → A: Yes; resolve repo root via repo markers (e.g., `.git` or `package.json`) and report `<repo>/agents/skills`.
- Q: If syncing one target fails, should the command continue? → A: Continue other targets; report all results; exit non-zero if any failed.
- Q: How should unknown target names be handled? → A: Error and perform no sync.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sync all target agents (Priority: P1)

As a repo maintainer, I want to run a single sync command that copies the canonical agent configuration to every supported target so all agent runtimes stay aligned.

**Why this priority**: This is the primary value of the command and the most common usage.

**Independent Test**: Run `agentctl sync` with a known source config and verify each supported target is updated.

**Acceptance Scenarios**:

1. **Given** a valid canonical config source and all destinations available, **When** the user runs `agentctl sync`, **Then** each supported target receives the latest config and the command reports a synced outcome for each target.
2. **Given** a valid canonical config source and one or more missing destination directories, **When** the user runs `agentctl sync`, **Then** the command creates the missing destinations and completes the sync for each target.
3. **Given** a destination contains files not present in the canonical config, **When** the user runs `agentctl sync`, **Then** those extra destination files remain intact after syncing.
4. **Given** the user runs the command from a subdirectory of the repository, **When** `agentctl sync` is executed, **Then** the repo root is resolved automatically and the sync succeeds.
5. **Given** syncing one target fails, **When** `agentctl sync` is executed, **Then** the command continues syncing remaining targets and exits non-zero after reporting all results.

---

### User Story 2 - Selective sync by target (Priority: P2)

As a repo maintainer, I want to include or exclude specific targets so I can update only the agents I care about in a given run.

**Why this priority**: Selective updates reduce risk and speed up workflows when only one target needs changes.

**Independent Test**: Run `agentctl sync --skip codex` and `agentctl sync --only claude` and verify only the intended targets update.

**Acceptance Scenarios**:

1. **Given** a valid canonical config source, **When** the user runs `agentctl sync --skip codex`, **Then** all targets except `codex` are synced and the output marks `codex` as skipped.
2. **Given** a valid canonical config source, **When** the user runs `agentctl sync --only claude`, **Then** only `claude` is synced and all other targets are skipped.
3. **Given** the user provides both `--skip` and `--only`, **When** the command runs, **Then** it exits with a clear error explaining the conflict and performs no sync.
4. **Given** the user provides an unknown target name in `--skip` or `--only`, **When** the command runs, **Then** it exits with a clear error and performs no sync.

---

### User Story 3 - Help and error feedback (Priority: P3)

As a user, I want clear help text and actionable error messages so I can correct mistakes quickly.

**Why this priority**: Good feedback prevents misconfiguration and reduces support overhead.

**Independent Test**: Run `agentctl sync --help` and induce a failure (missing source) to validate the messages.

**Acceptance Scenarios**:

1. **Given** the user runs `agentctl sync --help`, **When** the command executes, **Then** it prints usage, options, and the list of supported targets.
2. **Given** the canonical config source is missing, **When** the user runs `agentctl sync`, **Then** the command exits with a non-zero status and a clear message indicating the source path could not be found.

---

### Edge Cases

- What happens when the user provides an unknown target name in `--skip` or `--only`?
- How does the system handle a run where no targets remain after applying `--skip` or `--only`?
- What happens when the user lacks write permission to a destination directory?
- How does the system handle unknown flags or malformed option values?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a `sync` command under the `agentctl` CLI.
- **FR-002**: The system MUST sync the canonical agent configuration to all supported targets when no filters are provided.
- **FR-003**: The system MUST support `--skip` with a comma-separated list of target names to exclude from syncing.
- **FR-004**: The system MUST support `--only` with a comma-separated list of target names to include in syncing.
- **FR-005**: The system MUST reject runs that include both `--skip` and `--only` with a clear error and no sync performed.
- **FR-006**: The system MUST validate that the canonical config source exists before syncing; if it is missing, the command MUST exit non-zero and perform no sync.
- **FR-007**: The system MUST ensure each selected destination exists before copying (creating it if missing).
- **FR-008**: The system MUST emit a per-target outcome message indicating whether each target was synced or skipped.
- **FR-009**: The system MUST reject unknown target names provided to `--skip` or `--only` with a clear error and perform no sync.
- **FR-010**: The system MUST exit non-zero with a clear message if no targets are selected after applying filters.
- **FR-011**: The system MUST provide `--help` output that includes usage, options, and supported target names.
- **FR-012**: The system MUST not remove destination files that are not present in the canonical config.
- **FR-013**: The sync command MUST be portable across supported operating systems and MUST NOT require external command-line tools to perform file operations.
- **FR-014**: The system MUST resolve the repository root automatically when invoked from a subdirectory of the working copy.
- **FR-015**: The system MUST continue syncing remaining targets after a per-target failure and MUST exit non-zero if any target failed.
- **FR-016**: The system MUST report missing-source errors using the repository root path (`<repo>/agents/skills`) when the repo root can be resolved.

### Key Entities *(include if feature involves data)*

- **Canonical Config Set**: The authoritative collection of agent configuration files to be synced.
- **Target Agent**: A named destination that receives the canonical config (e.g., codex, claude, copilot).
- **Sync Request**: A single invocation of the sync command including selected targets and options.
- **Sync Result**: The per-target outcome (synced, skipped, failed) produced by a sync request.

## Assumptions & Dependencies

- The canonical config source is stored at `agents/skills` relative to the repository root.
- Supported targets are fixed to `codex`, `claude`, and `copilot`, with default destinations at `.codex/skills`, `.claude/skills`, and `.github/skills` relative to the repository root.
- Users run the command from a working copy (any subdirectory) with permission to read the source and write to selected destinations.
- Repo root detection relies on repo markers such as `.git` or `package.json` when the canonical source directory is missing.
- No external services are required to complete a sync.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a standard repo with up to 200 config files, users can complete a full sync in under 30 seconds.
- **SC-002**: 100% of supported targets are either synced or explicitly reported as skipped in each run.
- **SC-003**: When invalid flags or conflicts are provided, users receive a corrective error message and a non-zero exit within 2 seconds.
- **SC-004**: In usability checks, at least 90% of users can successfully run a selective sync (`--skip` or `--only`) on the first attempt without external help.
