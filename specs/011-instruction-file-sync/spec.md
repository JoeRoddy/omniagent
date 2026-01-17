# Feature Specification: Instruction File Sync

**Feature Branch**: `011-instruction-file-sync`  
**Created**: 2026-01-17  
**Status**: Draft  
**Input**: User description: "ask any clarifying questions about spec 010-instruction-file-sync"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sync repo instruction sources (Priority: P1)

Repo maintainers want existing `AGENTS.md` files across the codebase to act as the source of truth so
instruction targets are generated next to those files without changing the originals.

**Why this priority**: This is the most common workflow and avoids forcing migrations or new folders.

**Independent Test**: Can be fully tested by running sync on a repo with `AGENTS.md` files outside
`/agents` and verifying target files are created next to them while originals remain unchanged.

**Acceptance Scenarios**:

1. **Given** a repo contains `docs/AGENTS.md` outside `/agents` and targets include Claude and Gemini,
   **When** sync runs, **Then** `docs/CLAUDE.md` and `docs/GEMINI.md` are generated with the same
   content as `docs/AGENTS.md`.
2. **Given** a repo contains `docs/AGENTS.md` outside `/agents` and targets include Codex or Copilot,
   **When** sync runs, **Then** `docs/AGENTS.md` is left untouched and treated as satisfying the
   AGENTS-target output.
3. **Given** `AGENTS.md` files exist under excluded directories or ignored paths, **When** sync runs,
   **Then** those files are ignored and no outputs are generated there.

---

### User Story 2 - Use `/agents` templates for advanced control (Priority: P2)

Power users want templated sources under `/agents/**` to generate instruction files to specific
output directories, with predictable overrides when both template and repo sources target the same
output.

**Why this priority**: Advanced teams need templating and explicit output control, but it should not
block the default path.

**Independent Test**: Can be tested by adding `/agents` templates with metadata and confirming
outputs land in the specified directories with correct override behavior.

**Acceptance Scenarios**:

1. **Given** `/agents/AGENTS.md` exists and a root `AGENTS.md` exists, **When** sync runs for Claude,
   **Then** `CLAUDE.md` is generated at the repo root from `/agents/AGENTS.md` and the root
   `AGENTS.md` is not used for that target.
2. **Given** `/agents/sub/foo.AGENTS.md` with an `outPutPath` set to `docs/` (or a path that includes
   a filename), **When** sync runs, **Then** outputs are generated in `docs/` and any filename
   portion of `outPutPath` is ignored.
3. **Given** a repo source and a `/agents` template map to the same output path and target, **When**
   sync runs, **Then** the `/agents` template output replaces any existing target file at that
   location.
4. **Given** `/agents/team/AGENTS.md` includes a valid `outPutPath`, **When** sync runs, **Then**
   outputs are generated using that template even without the `*.AGENTS.md` filename prefix.

---

### User Story 3 - Safe cleanup and visibility (Priority: P3)

Operators want sync to track generated instruction files, clean up only what it created, and
surface counts in summaries so they can trust automation.

**Why this priority**: Prevents accidental deletion and provides operational confidence.

**Independent Test**: Can be tested by generating outputs, modifying one, and verifying deletion
behavior and summary counts.

**Acceptance Scenarios**:

1. **Given** an output file was generated and tracked by omniagent, **When** the source is removed
   and sync runs, **Then** the output is deleted only if it still matches the last generated hash.
2. **Given** a tracked output file has been edited since generation, **When** sync runs in
   non-interactive mode, **Then** a warning is emitted and the file is not deleted.
3. **Given** sync completes, **When** viewing the summary and JSON output, **Then** instruction
   source and output counts are included.

---

### Edge Cases

- A `/agents/**` template outside `agents/AGENTS.md` is missing the required `outPutPath`; the
  system warns and skips outputs for that template.
- How does the system behave when both local and non-local sources target the same output path and
  target?
- When both Codex and Copilot are selected and map to a single `AGENTS.md` output, the file is
  written once and counted once in summaries.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST discover instruction templates under `/agents/**` matching
  `*.AGENTS.md` and MUST also support `AGENTS.md` files under `/agents/**`, including
  `/agents/AGENTS.md`.
- **FR-002**: Documentation MUST recommend the `*.AGENTS.md` filename pattern for `/agents`
  templates to improve searchability and MUST NOT present non-prefixed subdirectory `AGENTS.md`
  files as a documented pattern, while the system still supports them.
- **FR-003**: System MUST discover plain `AGENTS.md` files anywhere in the repo outside `/agents`,
  respecting repository ignore rules and a default skip list of common generated/tooling directories
  (for example: `.git`, `node_modules`, `dist`, `.claude`, `.codex`, `.gemini`, `.github`,
  `.omniagent`, `coverage`).
- **FR-004**: `/agents` templates MUST support a metadata header and target-conditional content so
  per-target outputs can be rendered.
- **FR-005**: For `/agents/**` templates outside `agents/AGENTS.md`, `outPutPath` metadata MUST be
  provided and treated as a directory; if a filename is supplied, the filename portion MUST be
  ignored.
- **FR-006**: When `outPutPath` is missing or invalid for `/agents/**` templates outside
  `agents/AGENTS.md`, the system MUST emit a warning and skip outputs for that template.
- **FR-007**: For `agents/AGENTS.md`, `outPutPath` MUST default to the repo root when not provided.
- **FR-008**: Repo `AGENTS.md` sources outside `/agents` MUST be treated as plain text (no metadata
  parsing or templating) and generate outputs next to the source file.
- **FR-009**: Target filename mapping MUST be: Claude → `CLAUDE.md`, Gemini → `GEMINI.md`,
  Codex → `AGENTS.md`, Copilot → `AGENTS.md`.
- **FR-010**: System MUST only write `AGENTS.md` when an AGENTS-target (Codex or Copilot) is
  selected; for repo sources outside `/agents`, the existing `AGENTS.md` MUST be treated as already
  satisfying the AGENTS-target output and MUST NOT be overwritten.
- **FR-011**: When both Codex and Copilot are selected, the system MUST define how to handle the
  single `AGENTS.md` output; it MUST be written once and counted once in summaries.
- **FR-012**: `/agents` template outputs MUST take precedence over repo sources when both map to the
  same output path and target.
- **FR-013**: When `/agents` templates take precedence, their outputs MUST replace any existing
  target file at that location, including `AGENTS.md` when Codex or Copilot is selected.
- **FR-014**: Local instruction sources (following existing `.local` conventions) MUST take
  precedence over non-local sources for the same output path and target, consistent with other
  syncable features.
- **FR-015**: The existing option to exclude local sources (for example, `--exclude-local`) MUST
  exclude local instruction sources using the same rules as other syncable features.
- **FR-016**: The existing include/skip filters for sync outputs (for example, `--only` and `--skip`)
  MUST apply to instruction outputs using the same selection rules as other syncable features.
- **FR-017**: System MUST persist generated outputs in sync state with path, target, source, and
  content hash.
- **FR-018**: System MUST only delete outputs that were generated by omniagent and tracked in sync
  state.
- **FR-019**: If a tracked output has diverged from the last generated hash, system MUST warn and
  request confirmation before deletion; in non-interactive mode it MUST warn and skip deletion.
- **FR-020**: Sync summaries and JSON output MUST include instruction source and output counts.

### Key Entities *(include if feature involves data)*

- **Instruction Source**: A file that provides instruction content, either a `/agents/**` template
  or a plain repo `AGENTS.md`.
- **Instruction Output**: A generated target file (`CLAUDE.md`, `GEMINI.md`, or `AGENTS.md`) produced
  for a specific output path and target.
- **Target Type**: The destination platform selection (Claude, Gemini, Codex, Copilot) that
  determines the output filename.
- **Sync State Record**: A persisted record containing output path, target type, source reference,
  and content hash.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a repo with 10 plain `AGENTS.md` sources outside `/agents`, a sync run generates
  10 `CLAUDE.md` and 10 `GEMINI.md` files next to those sources when Claude and Gemini are selected,
  with zero modifications to the original `AGENTS.md` files.
- **SC-002**: When both a repo source and `/agents` template map to the same output path and target,
  100% of outputs for that path/target are produced from `/agents` templates in the same run.
- **SC-003**: In non-interactive mode, 100% of tracked outputs that have diverged from their last
  generated hash are retained and produce a warning instead of deletion.
- **SC-004**: Sync summaries and JSON outputs report instruction source and output counts that match
  the number of generated or recognized outputs on disk.

## Assumptions

- The existing sync configuration, ignore rules, and local-source conventions already used by
  omniagent apply to instruction sources and outputs.
- Target-conditional templating for `/agents` sources behaves consistently with other syncable
  features and does not require additional configuration for standard use.

## Dependencies

- Relies on the existing sync state mechanism to track generated outputs and their hashes.
