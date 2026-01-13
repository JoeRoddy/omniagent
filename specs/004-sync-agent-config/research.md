# Research Findings: Sync Agent Config

## Repo Root Resolution
- Decision: Walk upward from `process.cwd()` to locate a directory containing
  `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/agents/skills`-style
  `agents/skills` and treat that directory as the repo root.
- Rationale: Works from any subdirectory, avoids external tools, and directly
  matches the canonical source location required by the spec.
- Alternatives considered: `git rev-parse --show-toplevel` (external tool);
  using `process.cwd()` only; searching for `package.json` alone.

## File Copy Strategy
- Decision: Use `fs.promises.cp` (Node.js 18+) with `recursive: true` after
  `fs.promises.mkdir(dest, { recursive: true })`, copying into each destination
  without deleting extra files.
- Rationale: Built-in, portable, no external tools, preserves directory
  structure, and overwrites files while keeping destination-only files intact.
- Alternatives considered: Manual recursive copy via `readdir`/`stat`; spawning
  `rsync` or platform-specific tools; third-party sync libraries.

## Output Format
- Decision: Emit human-readable per-target lines by default and support a
  `--json` flag that prints a structured summary of all target outcomes.
- Rationale: Satisfies the constitution requirement for both human-readable and
  JSON output while keeping the default UX simple.
- Alternatives considered: Human-readable output only; JSON output only.

## Error Handling and Exit Code
- Decision: Validate `--skip`/`--only` and source existence before any copy,
  then process each target independently, collecting results and exiting
  non-zero if any target failed.
- Rationale: Aligns with FR-005, FR-006, and FR-015 while ensuring partial
  failures are reported without aborting remaining targets.
- Alternatives considered: Fail-fast on first error; ignore per-target failures.

## Target Filtering
- Decision: Parse `--skip` and `--only` as comma-separated lists, trim entries,
  and reject unknown target names or mixed usage with a clear error.
- Rationale: Provides predictable filtering and satisfies FR-003 through FR-010.
- Alternatives considered: Allow unknowns (ignored); allow both options with
  precedence rules.
