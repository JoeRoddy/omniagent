# Sync profiles

Profiles let individual developers — or the same developer across different
contexts (code review, incident response, docs writing) — pick a named,
checked-in filter that the `sync` command applies to the shared `agents/`
directory. Ten devs share one source of truth; each dev opts in to exactly the
skills, subagents, commands, and targets they want.

```bash
omniagent sync                                  # uses agents/profiles/default.json when present
omniagent sync --profile code-reviewer
omniagent sync --profile base,code-reviewer     # merge multiple (later wins)
```

## File layout

```text
agents/
  profiles/
    default.json              # team default (committed, used when no --profile flag)
    base.json                 # optional shared base extended by others
    code-reviewer.json        # named profile (committed)
    default.local.json        # sibling .local override (personal, gitignored)
  .local/
    profiles/
      default.json            # dedicated-dir .local override (personal, gitignored)
      my-experiments.json     # personal-only profile (no shared counterpart)
```

Both `.local` paths are honoured. When a file exists at both, the
`.local/profiles/<name>.json` form wins on conflicting keys; `omniagent sync -v`
emits a one-line notice so the choice is never silent.

## Schema

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/JoeRoddy/omniagent/master/schemas/profile.v1.json",

  "description": "Focused setup for PR reviews",
  "extends": "base",

  "targets": {
    "claude":  { "enabled": true },
    "codex":   { "enabled": true },
    "gemini":  { "enabled": false }
  },

  // Allowlist. Values are glob patterns matched against canonical item names.
  "enable": {
    "skills":    ["code-review", "security-review"],
    "subagents": ["reviewer"],
    "commands":  ["review", "diff-summary"]
  },

  // Denylist. Wins over enable.
  "disable": {
    "skills":   ["ppt"],
    "commands": ["*-legacy"]
  }
}
```

The full JSON Schema ships at [`schemas/profile.v1.json`](../schemas/profile.v1.json).
Profiles can reference the raw GitHub URL in `$schema` for editor autocomplete.

## Resolution order

For `omniagent sync --profile A,B`:

1. Each profile's `extends` chain is resolved first (grandparent → parent → profile),
   with cycles failing loudly and printing the full chain.
2. `.local` layers apply on top of each profile in order:
   sibling `profiles/<name>.local.json` → dedicated `.local/profiles/<name>.json`
   (dedicated wins on conflict).
3. Profiles layer in CLI order: fully-resolved `A` → fully-resolved `B`
   (later wins on key conflicts).
4. CLI flags (`--skip`, `--only`, `--exclude-local`) apply last.

`enable.<type>` and `disable.<type>` arrays are concatenated across layers.
`targets.<name>` is a deep object merge.

## Canonical item names

Patterns match the canonical item name, which is:

- **Skills** — `frontmatter.name` when set, otherwise the skill directory name.
- **Subagents** — `frontmatter.name` when set, otherwise the Markdown filename
  without extension.
- **Commands** — the Markdown filename without extension.

Glob syntax: `*` matches any run of non-slash characters, `?` matches one.

## `enable` + `disable`

- If `enable` is **omitted**, every item is included by default and `disable`
  acts as a pure denylist (mirrors the old "ignore file" mental model).
- If `enable` is **present**, only matching items are included, minus anything
  `disable` carves out.

## Unknown references

A bare name (no wildcards) that matches zero items prints a warning:

```text
Warning: profile "code-reviewer" references unknown skill "missing-one"
```

A glob (`*-legacy`) that matches zero items is silent — zero matches are a
valid outcome for a pattern. `omniagent profiles validate` promotes every
warning to an error with a non-zero exit, suitable for CI or a pre-commit hook.

## Default profile behaviour

- No `--profile` flag and **no** `agents/profiles/default.json`: sync behaves
  exactly as before — no filtering, no warnings. Profiles are opt-in.
- No `--profile` flag **and** `agents/profiles/default.json` exists: the default
  profile is applied automatically.
- `--profile X` passed explicitly: the default profile is **not** implicitly
  prepended. If you want both, list them: `--profile default,X`, or model it in
  the file via `"extends": "default"`.

## Discovery commands

```bash
omniagent profiles                       # list profiles with descriptions
omniagent profiles show code-reviewer    # print the fully-resolved merged profile
omniagent profiles validate              # strict validation, non-zero on issues (CI-friendly)
```

Example list output:

```text
  default                  (active by default) [local override]
  base                     Shared defaults extended by other profiles
  code-reviewer            Focused setup for PR reviews
  my-experiments           [local-only]
```

## Examples

### Base + role-specific

`agents/profiles/base.json`:

```json
{
  "description": "Shared defaults across all profiles",
  "targets": { "claude": { "enabled": true }, "codex": { "enabled": true } },
  "disable": { "skills": ["ppt", "brand-guidelines"] }
}
```

`agents/profiles/code-reviewer.json`:

```json
{
  "description": "Focused setup for PR reviews",
  "extends": "base",
  "enable": {
    "skills":    ["code-review", "security-review"],
    "subagents": ["reviewer"],
    "commands":  ["review", "diff-summary"]
  }
}
```

### Personal tweaks via `.local`

`agents/profiles/code-reviewer.local.json` (gitignored):

```json
{
  "disable": { "skills": ["security-review"] }
}
```

The dev keeps the team's `code-reviewer` profile but drops `security-review`
for themselves — no fork, no duplication.

### Personal-only profile

`agents/.local/profiles/my-experiments.json`:

```json
{
  "description": "Personal tinkering setup",
  "targets": { "claude": { "enabled": true } },
  "enable":  { "skills": ["experimental-*"] }
}
```

Activated with `omniagent sync --profile my-experiments`. Never committed,
not shared.

## Variables

Profiles can define a `variables` map that feeds the template substitution
system. Substitution syntax (`{{NAME}}`, `{{NAME=default}}`) and env-var
exposure (`OMNIAGENT_VAR_<NAME>`) are documented in
[`docs/templating.md`](templating.md#variable-substitution) — this section
focuses on how variables flow through profiles.

```jsonc
{
  "description": "Reviewer setup",
  "variables": {
    "REVIEW_STYLE": "terse",
    "LOG_SOURCE":   "datadog"
  }
}
```

Variable names must match `[A-Z_][A-Z0-9_]*`.

### Merge precedence

Variables merge per-key across layers, later wins:

1. `extends` chain (grandparent → parent → profile).
2. `.local` overrides (sibling, then dedicated).
3. Multiple `--profile` entries in CLI order.
4. `--var KEY=VALUE` CLI flags (always applied last; win over any profile
   value, and work even when no profile is active).

```bash
omniagent sync --profile reviewer --var REVIEW_STYLE=thorough
```

## Future work

The v1 profile surface intentionally omits `overrides` (per-item frontmatter
patches), `mcpServers`, and `hooks`. See issue #40 for the broader proposal
and deferred items.
