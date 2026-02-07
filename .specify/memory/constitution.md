<!--
SYNC IMPACT REPORT
==================
Version change: 1.0.0 → 1.1.0
Modified principles:
  - I. CLI-First Compiler Design → clarified shim boundary
  - II. Markdown-First, Human-Readable Output → clarified canonical sources + shim output
  - IV. Test-Driven Validation → aligned with CI + shim E2E
  - V. Predictable Resolution Order → updated to agents/ + local overrides + target selection
Modified sections:
  - Performance Standards
  - Development Workflow
  - Target Addition Process
Added sections: None
Removed sections: None
Templates requiring updates:
  - .specify/templates/plan-template.md: ✅ compatible (Constitution Check section exists)
  - .specify/templates/spec-template.md: ✅ compatible (Requirements section aligns)
  - .specify/templates/tasks-template.md: ✅ compatible (phase structure aligns)
Follow-up TODOs: None
-->

# omniagent Constitution

## Core Principles

### I. Compiler-First with Shim Boundaries

omniagent is a **compiler/adapter** for agent configuration. It also provides a thin
CLI shim to delegate commands to external agent CLIs, but it is **not** an agent runtime.
Every feature MUST adhere to this boundary:

- MUST validate canonical agent configuration and target mappings
- MUST generate target-specific outputs as static files; sync must not require agent runtimes
- MAY provide a CLI shim that invokes external agent CLIs, but MUST NOT implement its own
  runtime, orchestration layer, or model hosting
- MUST handle lossy mappings explicitly and visibly to users
- MUST keep shim behavior transparent (explicit translation + pass-through outputs)

**Rationale**: Clear separation of concerns prevents scope creep. The shim is a UX
adapter layer, not a runtime.

### II. Markdown-First, Human-Readable Output

All canonical configuration MUST be markdown-first:

- Canonical content sources (skills, subagents, slash commands, instructions, `AGENTS.md`)
  MUST be human-readable and diffable
- Structured data (frontmatter) MUST use YAML or TOML; code-based configuration
  (`omniagent.config.*`) is allowed for target definitions
- CLI output for user-facing management commands (for example, `sync`) MUST support both
  JSON and human-readable formats; shim output is passed through unmodified
- Error messages MUST be actionable with clear remediation steps
- Generated target files SHOULD include provenance comments when the target format allows;
  managed outputs MUST be tracked to support safe cleanup and change detection

**Rationale**: Developer tools succeed when they integrate seamlessly with existing
workflows. Git diffability and human readability reduce friction and build trust.

### III. Explicit Lossy Mapping Transparency

Not all agent features map cleanly across targets. omniagent MUST surface this:

- MUST warn when source features have no target equivalent
- MUST document which features are fully supported, partially supported, or unsupported per target
- MUST NOT silently drop configuration during compilation
- SHOULD provide suggestions for target-specific alternatives when features cannot map
- MUST surface automatic conversions (for example, subagents → skills) in warnings/summary

**Rationale**: Users deserve to know what they're getting. Hidden incompatibilities
erode trust and cause debugging nightmares in production.

### IV. Test-Driven Validation

All compilation and validation logic MUST be thoroughly tested:

- Schema/frontmatter validation MUST have comprehensive test coverage
- Core sync, templating, and writer behavior MUST have unit tests
- Each built-in target MUST have contract tests verifying output paths and formats
- CLI shim translation MUST have E2E tests against expected invocations/baselines
- Edge cases (empty configs, malformed input, missing fields) MUST be tested
- New targets MUST include a test suite before merge

**Rationale**: As a configuration compiler, correctness is paramount. Users trust
omniagent to produce valid output; broken compilation breaks their entire workflow.

### V. Predictable Resolution Order

Configuration resolution MUST follow a deterministic, documented order:

**Source precedence (same item name):**

1. Local overrides in `agents/.local/**` (or `.local` suffix)
2. Shared sources in `agents/{agents,skills,commands}/**` and repo `AGENTS.md`

**Target selection:**

1. Per-file frontmatter `targets`/`targetAgents` defines defaults
2. Run-level `--only` / `--skip` filters apply
3. Built-in targets plus custom targets from `omniagent.config.*` in the active
   agents directory (`--agentsDir`)

This order MUST be:

- Documented in user-facing help and documentation
- Consistent across all commands and targets
- Debuggable via JSON output (`--json`) and shim trace flags (`--trace-translate`)

**Rationale**: Mirroring established patterns (Git, Terraform, ESLint) reduces
learning curve and makes behavior predictable for power users.

## Performance Standards

omniagent MUST maintain responsive CLI performance:

- Sync operations SHOULD complete quickly for typical project configs (seconds, not minutes)
- Memory usage SHOULD remain modest for standard operations
- File I/O MUST be minimized; prefer streaming over loading entire directories
- Cold start (first run) MAY be slower but SHOULD still be within a few seconds

**Measurement**: Benchmarks are not enforced yet. If/when added, encode thresholds
in CI and regression test against them.

**Rationale**: CLI tools that feel slow get abandoned. Fast feedback loops
encourage iterative configuration refinement.

## Development Workflow

### Code Quality Gates

All contributions MUST pass:

- `npm run check` (Biome formatting/linting)
- `npm run typecheck`
- `npm test`
- `npm run build`
- Documentation updates for user-facing changes

New functionality MUST include appropriate tests (unit/contract/E2E) for the affected
surfaces.

### Commit Standards

- Commits SHOULD follow conventional commit format when practical
- Breaking changes MUST be clearly marked and documented
- Each PR SHOULD include test coverage for new functionality

### Built-in Target Addition Process

Adding a new built-in compilation target requires:

1. Research document outlining the target's configuration format
2. Mapping document showing canonical → target field translations
3. Explicit list of unsupported/lossy features
4. Complete test suite for the new target (unit + contract, plus E2E where applicable)
5. Documentation updates (README, help text)

## Governance

This constitution is the authoritative source for omniagent development practices.
All PRs and code reviews MUST verify compliance with these principles.

### Amendment Process

1. Propose changes via PR to this file
2. Changes require review and approval
3. MAJOR changes (principle removal/redefinition) require explicit justification
4. Version number MUST be updated per semantic versioning:
   - MAJOR: Backward-incompatible governance changes
   - MINOR: New principles or materially expanded guidance
   - PATCH: Clarifications, wording fixes

### Compliance

- Use `.specify/memory/constitution.md` as reference during development
- Constitution Check section in plan templates MUST verify alignment
- Complexity beyond these principles MUST be justified in Complexity Tracking

**Version**: 1.1.0 | **Ratified**: 2026-01-10 | **Last Amended**: 2026-02-07
