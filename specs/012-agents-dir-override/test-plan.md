# Test Plan: Custom Agents Directory Override

## Scope and Goals

Validate the optional `--agentsDir` flag for commands that read/write agent config files (currently
`sync`). Ensure default behavior is preserved, custom paths resolve from the repo root, errors are
clear and actionable, and help/docs expose the option and default value.

## Requirements Inventory (from spec.md)

### Functional Requirements

- **FR-001**: Accept optional `--agentsDir` on commands that read/write agent config files.
- **FR-002**: No override uses default `agents/` with no behavior changes.
- **FR-003**: Override path is used consistently for all agent config reads/writes in a command.
- **FR-004**: Missing/inaccessible/not-directory path yields a clear, actionable error.
- **FR-005**: Expose `--agentsDir` and its default in CLI help or docs.
- **FR-006**: Default agents directory is consistent across commands.
- **FR-007**: Relative `--agentsDir` resolves from project root.

### Acceptance Scenarios (User Stories)

- **US1**: Default behavior preserved when no override is provided.
- **US2**: Custom directory used when `--agentsDir` is provided; invalid paths error.
- **US3**: Users can discover the flag in help/docs.

### Edge Cases

- Missing directory
- Path points to a file, not a directory
- Directory exists but is not readable/writable
- Relative paths with `.` or `..` or trailing slash
- Custom path equals default `agents/`

### Success Criteria

- **SC-001**: No override => 100% of agent config reads/writes in default `agents/`.
- **SC-002**: With override, create/list/update tasks usable within 2 minutes (manual).
- **SC-003**: Invalid path yields clear error with path and corrective step.
- **SC-004**: 90% of users can identify override via help/docs (manual).

## Test Environment and Fixtures

- Use a temporary repo root with `package.json` or `.git` so `findRepoRoot` succeeds.
- Minimal agent fixtures for shared and local sources:
  - `agents/skills/demo/SKILL.md`
  - `agents/commands/demo.md`
  - `agents/agents/demo.md`
  - `agents/.local/skills/demo.local.md` (local example)
  - Custom override tree mirrors the same structure under `custom-agents/`.
- Use OS-level permissions to simulate read-only and no-access directories.
- For CLI tests, run `node dist/cli.js sync ...` (or equivalent entrypoint).

## Requirements Coverage Matrix

| Requirement | Tests |
| --- | --- |
| FR-001 | CLI-001, CLI-002, CLI-003 |
| FR-002 | CLI-002, REG-001 |
| FR-003 | CLI-003, CLI-004, CAT-001, CAT-002, CAT-003, CAT-004 |
| FR-004 | CLI-005, CLI-006, CLI-007, AD-007, AD-008, AD-009 |
| FR-005 | DOC-001, DOC-002, CLI-001 |
| FR-006 | CLI-002, REG-001 |
| FR-007 | AD-002, AD-004, CLI-003 |
| SC-001 | CLI-002 |
| SC-002 | UX-001 (manual) |
| SC-003 | CLI-005, CLI-006, CLI-007 |
| SC-004 | DOC-003 (manual) |

## Implementation Status

- [x] AD-001 Default resolution
- [x] AD-002 Relative override resolution
- [x] AD-003 Absolute override resolution
- [x] AD-004 Relative path normalization
- [x] AD-005 Validate existing directory
- [x] AD-006 Validate missing directory
- [x] AD-007 Validate path is a file
- [x] AD-008 Validate permission denied (stat)
- [x] AD-009 Validate permission denied (no read/write)
- [x] LS-001 Default shared roots
- [x] LS-002 Override shared/local roots
- [x] CAT-001 Skills catalog honors override
- [x] CAT-002 Slash command catalog honors override
- [x] CAT-003 Subagent catalog honors override
- [x] CAT-004 Instruction scans honor override
- [x] CLI-001 Help output includes `--agentsDir`
- [x] CLI-002 Default behavior preserved (no override)
- [x] CLI-003 Relative override used for all categories
- [x] CLI-004 Absolute override used for all categories
- [x] CLI-005 Missing override path errors
- [x] CLI-006 Override path is a file
- [x] CLI-007 Override path is not accessible
- [x] CLI-008 Override equals default
- [x] DOC-001 README documents `--agentsDir`
- [x] DOC-002 CLI help output in docs (manual)
- [x] DOC-003 Discoverability usability check (manual)
- [x] UX-001 Custom directory workflow (manual)
- [x] REG-001 Default behavior parity

## Manual Execution Notes

- 2026-01-18: Verified `omniagent sync --help` lists `--agentsDir` with default `agents`.
- 2026-01-18: Found `--agentsDir` in README and CLI help within 2 minutes (single-participant spot check).
- 2026-01-18: Created a temporary repo with `custom-agents/`, ran `sync --agentsDir ./custom-agents --only claude --yes`, updated a skill, re-synced, and confirmed output updated.

## Test Cases

### Unit Tests: `src/lib/agents-dir.ts`

- **AD-001 Default resolution**
  - **Type**: Unit
  - **Reqs**: FR-002, FR-006
  - **Setup**: `repoRoot = /tmp/repo`
  - **Steps**:
    1) Call `resolveAgentsDir(repoRoot)` with `undefined`, `null`, `""`, and `"   "`.
  - **Expected**:
    - `requestedPath` is `null`
    - `resolvedPath` is `/tmp/repo/agents`
    - `source` is `default`, `isDefault` is `true`

- **AD-002 Relative override resolution**
  - **Type**: Unit
  - **Reqs**: FR-001, FR-003, FR-007
  - **Steps**:
    1) Call `resolveAgentsDir(repoRoot, "./custom/agents/")`.
  - **Expected**:
    - `requestedPath` is trimmed (no whitespace)
    - `resolvedPath` is `/tmp/repo/custom/agents`
    - `source` is `override`, `isDefault` is `false`

- **AD-003 Absolute override resolution**
  - **Type**: Unit
  - **Reqs**: FR-003
  - **Steps**:
    1) Call `resolveAgentsDir(repoRoot, "/opt/shared/agents")`.
  - **Expected**:
    - `resolvedPath` is `/opt/shared/agents`
    - `source` is `override`, `isDefault` is `false`

- **AD-004 Relative path normalization (`.` and `..`)**
  - **Type**: Unit
  - **Reqs**: FR-007
  - **Steps**:
    1) Call `resolveAgentsDir(repoRoot, "./custom/../custom/agents")`.
  - **Expected**:
    - `resolvedPath` resolves to `/tmp/repo/custom/agents`

- **AD-005 Validate existing directory**
  - **Type**: Unit
  - **Reqs**: FR-004
  - **Setup**: Create writable directory `/tmp/repo/custom/agents`
  - **Steps**:
    1) Call `validateAgentsDir(repoRoot, "custom/agents")`.
  - **Expected**:
    - `validationStatus` is `valid`
    - `errorMessage` is `null`

- **AD-006 Validate missing directory**
  - **Type**: Unit
  - **Reqs**: FR-004, SC-003
  - **Steps**:
    1) Call `validateAgentsDir(repoRoot, "missing-dir")`.
  - **Expected**:
    - `validationStatus` is `missing`
    - `errorMessage` includes path and remediation text

- **AD-007 Validate path is a file**
  - **Type**: Unit
  - **Reqs**: FR-004, SC-003
  - **Setup**: Create file `/tmp/repo/custom/agents`
  - **Steps**:
    1) Call `validateAgentsDir(repoRoot, "custom/agents")`.
  - **Expected**:
    - `validationStatus` is `notDirectory`
    - `errorMessage` includes path and remediation text

- **AD-008 Validate permission denied (stat)**
  - **Type**: Unit
  - **Reqs**: FR-004, SC-003
  - **Setup**: Create directory without permissions for current user
  - **Steps**:
    1) Call `validateAgentsDir(repoRoot, "custom/agents")`.
  - **Expected**:
    - `validationStatus` is `permissionDenied`
    - `errorMessage` includes path and remediation text

- **AD-009 Validate permission denied (no read/write)**
  - **Type**: Unit
  - **Reqs**: FR-004, SC-003
  - **Setup**: Directory exists but remove read or write permission
  - **Steps**:
    1) Call `validateAgentsDir(repoRoot, "custom/agents")`.
  - **Expected**:
    - `validationStatus` is `permissionDenied`
    - `errorMessage` includes path and remediation text

### Unit Tests: `src/lib/local-sources.ts`

- **LS-001 Default shared roots**
  - **Type**: Unit
  - **Reqs**: FR-002, FR-006
  - **Steps**:
    1) Call `resolveSharedCategoryRoot(repoRoot, "skills")` with no override.
    2) Call `resolveSharedCategoryRoot(repoRoot, "instructions")` with no override.
  - **Expected**:
    - Skills root is `/tmp/repo/agents/skills`
    - Instructions root is `/tmp/repo/agents`

- **LS-002 Override shared/local roots**
  - **Type**: Unit
  - **Reqs**: FR-003, FR-007
  - **Steps**:
    1) Call `resolveSharedCategoryRoot(repoRoot, "commands", "custom/agents")`.
    2) Call `resolveLocalCategoryRoot(repoRoot, "commands", "custom/agents")`.
  - **Expected**:
    - Shared root is `/tmp/repo/custom/agents/commands`
    - Local root is `/tmp/repo/custom/agents/.local/commands`

### Catalog and Scan Integration Tests

- **CAT-001 Skills catalog honors override**
  - **Type**: Integration
  - **Reqs**: FR-003
  - **Setup**: Populate `custom-agents/skills` and `custom-agents/.local/skills`
  - **Steps**:
    1) Call `loadSkillCatalog(repoRoot, { agentsDir: "custom-agents" })`.
  - **Expected**:
    - Only skill files under `custom-agents` are discovered
    - Default `agents/` skills are not included

- **CAT-002 Slash command catalog honors override**
  - **Type**: Integration
  - **Reqs**: FR-003
  - **Steps**:
    1) Call `loadCommandCatalog(repoRoot, { agentsDir: "custom-agents" })`.
  - **Expected**:
    - Only `custom-agents/commands` are discovered

- **CAT-003 Subagent catalog honors override**
  - **Type**: Integration
  - **Reqs**: FR-003
  - **Steps**:
    1) Call `loadSubagentCatalog(repoRoot, { agentsDir: "custom-agents" })`.
  - **Expected**:
    - Only `custom-agents/agents` are discovered

- **CAT-004 Instruction scans honor override**
  - **Type**: Integration
  - **Reqs**: FR-003
  - **Setup**: Add instruction templates under `custom-agents/`
  - **Steps**:
    1) Call `scanInstructionTemplateSources({ repoRoot, agentsDir: "custom-agents" })`.
    2) Call `scanRepoInstructionSources({ repoRoot, agentsDir: "custom-agents" })`.
  - **Expected**:
    - Only instructions under the override root are discovered

### CLI Tests: `sync`

- **CLI-001 Help output includes `--agentsDir`**
  - **Type**: CLI
  - **Reqs**: FR-005
  - **Steps**:
    1) Run `omniagent sync --help`.
  - **Expected**:
    - `--agentsDir` is listed with default `agents` (or `agents/`)
    - Description mentions custom directory and override usage

- **CLI-002 Default behavior preserved (no override)**
  - **Type**: CLI
  - **Reqs**: FR-002, FR-006, SC-001, US1
  - **Setup**: Populate `agents/` with sample items; leave `custom-agents/` empty
  - **Steps**:
    1) Run `omniagent sync --listLocal --json`.
  - **Expected**:
    - Output lists items only from `agents/`
    - No attempt to read from `custom-agents/`

- **CLI-003 Relative override used for all categories**
  - **Type**: CLI
  - **Reqs**: FR-001, FR-003, FR-007, US2
  - **Setup**: Populate `custom-agents/` with sample items; leave default empty
  - **Steps**:
    1) Run `omniagent sync --agentsDir ./custom-agents --listLocal --json`.
  - **Expected**:
    - Output lists items only from `custom-agents/`
    - No reads from default `agents/`

- **CLI-004 Absolute override used for all categories**
  - **Type**: CLI
  - **Reqs**: FR-003
  - **Steps**:
    1) Run `omniagent sync --agentsDir /abs/path/custom-agents --listLocal --json`.
  - **Expected**:
    - Output lists items only from `/abs/path/custom-agents`

- **CLI-005 Missing override path errors**
  - **Type**: CLI
  - **Reqs**: FR-004, SC-003, US2
  - **Steps**:
    1) Run `omniagent sync --agentsDir ./missing-agents`.
  - **Expected**:
    - Exit code is non-zero
    - Error includes missing path and remediation text
    - No files are written to default `agents/`

- **CLI-006 Override path is a file**
  - **Type**: CLI
  - **Reqs**: FR-004, SC-003
  - **Steps**:
    1) Create `custom-agents` file.
    2) Run `omniagent sync --agentsDir ./custom-agents`.
  - **Expected**:
    - Exit code is non-zero
    - Error indicates "not a directory" and includes path
    - No files are written to default `agents/`

- **CLI-007 Override path is not accessible**
  - **Type**: CLI
  - **Reqs**: FR-004, SC-003
  - **Steps**:
    1) Create `custom-agents` directory with no read/write permissions.
    2) Run `omniagent sync --agentsDir ./custom-agents`.
  - **Expected**:
    - Exit code is non-zero
    - Error indicates permissions issue and includes path
    - No files are written to default `agents/`

- **CLI-008 Override equals default**
  - **Type**: CLI
  - **Reqs**: FR-002, FR-003
  - **Steps**:
    1) Run `omniagent sync --agentsDir agents --listLocal --json`.
  - **Expected**:
    - Behavior matches CLI-002
    - No errors or behavior changes vs default

### Documentation and Discovery Tests

- **DOC-001 README documents `--agentsDir`**
  - **Type**: Docs (manual or snapshot)
  - **Reqs**: FR-005, FR-007
  - **Steps**:
    1) Inspect README CLI section.
  - **Expected**:
    - `--agentsDir` is documented
    - Mentions default `agents/` and relative path resolution from repo root

- **DOC-002 CLI help output in docs**
  - **Type**: Docs (manual)
  - **Reqs**: FR-005
  - **Steps**:
    1) Ensure docs or help output reference `--agentsDir`.
  - **Expected**:
    - Default value is visible

- **DOC-003 Discoverability usability check**
  - **Type**: Manual usability
  - **Reqs**: SC-004
  - **Steps**:
    1) Ask participants to find how to override agents dir using help/docs.
  - **Expected**:
    - >= 90% can identify option and default within 2 minutes

### Usability / Success Criteria Tests

- **UX-001 Custom directory workflow**
  - **Type**: Manual
  - **Reqs**: SC-002
  - **Steps**:
    1) With `--agentsDir`, perform create/list/update workflows for agents.
  - **Expected**:
    - Each task completes within 2 minutes

### Regression Tests (non-functional but recommended)

- **REG-001 Default behavior parity**
  - **Type**: CLI regression
  - **Reqs**: FR-002, FR-006
  - **Steps**:
    1) Run key `sync` scenarios before and after flag introduction (golden output).
  - **Expected**:
    - No behavior change when `--agentsDir` is not supplied

## Notes

- Tests should be implemented with Vitest where possible.
- CLI tests can use temporary repos and invoke the CLI entrypoint directly.
- Permission tests may need platform guards (Windows ACL differences).
