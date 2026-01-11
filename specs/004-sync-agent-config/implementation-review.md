# Implementation Review: Sync Agent Config (004-sync-agent-config)

## Findings

### Medium
- **No automated tests for the new sync flow.** The branch adds a new CLI command and helper modules but does not add any tests covering: CLI parsing, repo-root discovery, skip/only validation, JSON output, or per-target failure handling. This leaves key behavior unverified and increases regression risk. `src/cli/commands/sync.ts:1` `src/lib/repo-root.ts:1` `src/lib/sync-copy.ts:1` `src/lib/sync-results.ts:1` `src/lib/sync-targets.ts:1` `tests/commands`

### Low
- **Missing-source error message can reference the wrong directory when invoked from a subdirectory.** If the canonical source directory does not exist anywhere, repo-root discovery fails and the error message points to `cwd/agents/skills` instead of `<repo>/agents/skills`. This is confusing and does not match the expectation that errors reference repo root. `src/lib/repo-root.ts:13` `src/cli/commands/sync.ts:117`

## Spec Alignment Notes
- **FR-001/002/003/004/005/008/009/013/015** appear implemented: the `sync` command exists, supports `--skip`/`--only`, validates conflicts and unknowns, copies without external tools, and continues after per-target failure while exiting non-zero if any failed. `src/cli/commands/sync.ts:55`
- **FR-006** (missing source must error) is implemented, but the error path can be misleading when invoked from a subdirectory (see finding above). `src/cli/commands/sync.ts:121`

## Coverage Gaps / Suggested Tests
- Sync all targets from repo root and from a subdirectory (verifies repo-root resolution and per-target outputs).
- `--skip` and `--only` filtering (ensures correct targets are skipped/synced).
- Unknown target names (ensures immediate failure and no sync).
- Conflicting `--skip` and `--only` (ensures immediate failure and no sync).
- Missing canonical source (ensures non-zero exit and correct message).
- JSON output shape (ensures `SyncSummary` matches expected fields).

## Positive Observations
- Output formatting and JSON summary are straightforward and match the spec’s data model.
- The copy behavior is non-destructive (destination-only files are preserved) and does not depend on external tools.
