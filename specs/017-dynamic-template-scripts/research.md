# Research: Dynamic Template Scripts

## Decision 1: Use explicit `<nodejs>...</nodejs>` block syntax

**Decision**: Dynamic script regions use a dedicated tag pair, `<nodejs>` and `</nodejs>`,
inside syncable templates.

**Rationale**: A distinct tag avoids accidental execution of ordinary markdown/html content and
aligns with the existing tag-based template parsing approach.

**Alternatives considered**:
- Reusing markdown fenced code blocks (ambiguous with documentation examples)
- Handlebars-style delimiters (introduces a second delimiter grammar alongside existing agent tags)
- Raw `<script>` tags (higher collision risk with existing content)

## Decision 2: Execute each script block in an isolated Node subprocess with CommonJS helpers

**Decision**: Run each script block in its own `node` subprocess, inheriting normal userspace
capabilities (filesystem, network, subprocess access), with no sandbox and no timeout. The
execution context provides `require`, `__dirname`, and `__filename`.

**Rationale**: Process isolation enforces FR-018 (no shared in-memory state), while preserving the
explicit no-restrictions requirements from FR-011/FR-012.

**Alternatives considered**:
- `vm` contexts in-process (weaker isolation and shared-process side effects)
- `new Function`/`AsyncFunction` in-process (shared globals, violates isolation intent)
- Worker threads (more isolation than in-process eval but still same process lifetime/context)

## Decision 3: Pre-evaluate scripts once per template per run and cache results

**Decision**: Add a pre-render evaluation phase that resolves all script blocks in deterministic
source order per template before any output writes, caching results by template path + block index.

**Rationale**: This directly satisfies FR-005/FR-005a and prevents repeated side effects across
multiple target renders from the same template.

**Alternatives considered**:
- Evaluate during each target render (violates once-per-template requirement)
- Lazy evaluation per target with memoization (harder to guarantee fail-fast before writes)

## Decision 4: Abort sync on first script error before mutating managed outputs

**Decision**: Treat script evaluation errors as fatal and terminate the run before applying any
sync-managed writes.

**Rationale**: Satisfies FR-006 and FR-007 (fail-fast + no partial rendered outputs).

**Alternatives considered**:
- Continue processing remaining templates (violates fail-fast)
- Best-effort rollback after partial writes (adds complexity and conflicts with FR-014 no side-effect reconciliation)

## Decision 5: Normalize script return values using the clarified contract

**Decision**: Render script outputs as: string unchanged, object/array JSON text,
all other values `String(value)`. `null`/`undefined` normalize to an empty string.

**Rationale**: Matches FR-015 and FR-008 while remaining deterministic and easy to document.

**Alternatives considered**:
- Require string-only returns (unnecessarily strict)
- Serialize all non-strings as JSON (unexpected for booleans/numbers/symbols)
- Throw on `null`/`undefined` (contradicts empty-result behavior)

## Decision 6: Long-running behavior uses warning heartbeats, not timeouts

**Decision**: While waiting on a running script, emit a periodic `still running` warning every 30
seconds until completion or external interruption.

**Rationale**: Preserves FR-016 (no timeout) while providing operational visibility.

**Alternatives considered**:
- Hard timeout/kill (explicitly disallowed)
- No progress signal (poor debuggability for hangs)

## Decision 7: Telemetry remains quiet by default and enabled via `sync --verbose`

**Decision**: Add/propagate a sync verbosity flag so per-script execution telemetry is emitted only
when verbose mode is enabled.

**Rationale**: Implements FR-017 and keeps default sync output stable.

**Alternatives considered**:
- Always-on telemetry (breaks default quiet requirement)
- Hidden env-var-only telemetry toggle (harder discoverability and poorer UX)

## Decision 8: Use one shared script-enabled templating pipeline across all syncable surfaces

**Decision**: Centralize script parsing/execution in shared library code and integrate it into
`skills`, `subagents` (agents), `slash-commands`, and instruction template sync flows.

**Rationale**: Satisfies FR-009 and avoids divergent behavior between surfaces.

**Alternatives considered**:
- Implement independently per surface (high drift risk)
- Support only one or two surfaces initially (violates feature scope and FR-009)
