# Research: Custom Agent Targets

## Config discovery in agents directory

- Decision: Discover config only in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/agents/`
  (or `--agentsDir` override), scanning for the first match in extension order
  `omniagent.config.ts`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`.
- Rationale: Matches clarified requirements and keeps resolution deterministic without scanning
  repo root or user home.
- Alternatives considered: Repo root + home search (rejected by spec); multiple files merged
  (rejected, first match wins).

## Loading TS/JS config modules in Node.js 18

- Decision: Use `jiti` as a runtime loader to support TS/ESM/CJS config files, with a fallback to
  native `import()`/`createRequire()` for plain JS where possible. Normalize to a single exported
  config object (default export or `module.exports`).
- Rationale: Node.js 18 does not natively execute `.ts` files; `jiti` avoids forcing users to
  precompile configs and supports ESM/CJS seamlessly.
- Alternatives considered: Require users to provide only `.js` configs (conflicts with spec),
  use `ts-node`/`tsx` as a peer dependency (adds heavier setup), rely on experimental Node flags
  (not available in Node 18).

## Config schema validation

- Decision: Implement explicit runtime validation functions (similar to existing validation
  patterns in `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/lib/agent-templating.ts`)
  and aggregate actionable errors before any output is written.
- Rationale: Matches project style (custom validators), avoids adding heavy schema libraries,
  and supports detailed per-field error messages.
- Alternatives considered: Zod/AJV schema validation (adds dependency footprint and new patterns),
  TypeScript-only validation (insufficient at runtime).

## Target merge and override semantics

- Decision: Treat built-in targets as defaults, merge custom targets on top, and require explicit
  `override` or `inherits` when a custom ID collides with a built-in. Support disabling built-ins
  by ID and keep unspecified fields from built-ins when overridden.
- Rationale: Aligns with FR-004 to FR-006a, keeps backward compatibility, and avoids silent
  collisions.
- Alternatives considered: Last-write-wins for collisions (violates explicit override requirement),
  replacing built-ins entirely (breaks backward compatibility).

## Output template placeholder resolution

- Decision: Define a fixed set of placeholders (repo root, user home, agents source, target ID,
  item name, command location) and validate that every placeholder is known and resolvable before
  processing outputs.
- Rationale: Prevents silent miswrites and satisfies FR-010 and FR-010a.
- Alternatives considered: Allow unknown placeholders to pass through (breaks fail-fast rule),
  implicit fallbacks (non-deterministic).

## Default writers for output collisions

- Decision: Export target-agnostic default writers for subagents, skills, and instructions, and
  use them to resolve file collisions across targets. Treat command output collisions as a
  validation error unless explicitly resolved in config.
- Rationale: Matches FR-015a to FR-015c, ensures deterministic writer selection, and avoids
  ambiguous command outputs.
- Alternatives considered: Last-writer-wins (non-deterministic), always error on collisions
  (breaks shared instruction grouping requirement).

## Converter error handling

- Decision: Collect per-item conversion errors, continue processing other items, and exit non-zero
  if any converter errors occur. Emit a concise summary of errored items at the end.
- Rationale: Matches FR-014a and preserves maximum output while still signaling failure.
- Alternatives considered: Fail-fast on first error (not allowed by spec), ignore errors
  (breaks validation expectations).

## Instruction output directory defaults

- Decision: Default instruction outputs to the source directory when no output directory is
  specified, except for `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/agents/AGENTS.md`
  which defaults to repo root.
- Rationale: Matches FR-016a and existing expectations for AGENTS.md behavior.
- Alternatives considered: Always default to repo root (breaks per-source routing), require
  explicit output directory (too verbose for common cases).
