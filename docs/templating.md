# Templating

Templating runs across all syncable surfaces: skills, subagents, slash commands, and instruction
files.

## Agent-scoped templating

Use `<agents ...>` selector blocks inside canonical content.

```md
Shared content.

<agents claude,codex>
Only Claude and Codex see this.
</agents>

<agents not:claude,gemini>
Everyone except Claude and Gemini sees this.
</agents>
```

## Variable substitution

Anywhere in a template, `{{NAME}}` is replaced with the matching variable value.
Provide an inline default with `{{NAME=fallback}}`:

```md
You are a {{REVIEW_STYLE=thorough}} code reviewer. Log source is {{LOG_SOURCE}}.
```

Variable names must match `[A-Z_][A-Z0-9_]*` (uppercase ASCII, digits,
underscores — env-var-safe).

### Where values come from

1. **Profile `variables`** — defined inside a profile and merged across its
   `extends` chain, `.local` overrides, and multiple `--profile` entries in CLI
   order. See [`docs/profiles.md`](profiles.md#variables).
2. **`--var KEY=VALUE` CLI flag** (repeatable) — applied last, wins over any
   profile value. Works with or without a profile.

### Substitution rules

- `{{NAME}}` with no default and no matching variable: the placeholder is left
  literal in the output and a `profile_warning` is emitted so the typo is
  surfaced.
- `{{NAME=default}}` with no matching variable: the default is used.
- `{{NAME}}` or `{{NAME=default}}` with a matching variable: the variable
  value is used (including empty-string values, which do **not** fall through
  to the default).
- Whitespace around the name is tolerated (`{{ NAME }}`). The default value
  runs until the closing `}}` and may contain spaces.

### Access from scripts

Every variable is also injected into the child process env for `<nodejs>` and
`<shell>` blocks as `OMNIAGENT_VAR_<NAME>`:

```md
<nodejs>
return `Style: ${process.env.OMNIAGENT_VAR_REVIEW_STYLE}`;
</nodejs>
```

Substitution applies to script **output** as well, so a script can emit
`{{VAR}}` and it will be resolved after evaluation.

## Dynamic template scripts (`<nodejs>` and `<shell>`)

`sync` can execute inline script blocks before agent templating/rendering.

Node.js example:

```md
Current docs:
<nodejs>
const fs = require("node:fs");
const path = require("node:path");

const docsDir = path.join(process.cwd(), "docs");
const pages = fs
  .readdirSync(docsDir)
  .filter((name) => name.endsWith(".md"))
  .sort();

return pages.map((name) => `- ${name}`).join("\n");
</nodejs>
```

Shell example:

```md
Current docs:
<shell>
for file in docs/*.md; do
  [ -f "$file" ] || continue
  printf -- "- %s\n" "$(basename "$file")"
done | sort
</shell>
```

## Behavior

- Scripts run once per template per sync run and cached results are reused across targets.
- Each script block runs in an isolated process.
- `<nodejs>` blocks can use `require`, `__dirname`, and `__filename`.
- `<shell>` blocks run with the user's shell (`$SHELL` on Unix, `cmd.exe` fallback on Windows).
- Script failures stop sync before managed writes are applied.
- Long-running scripts emit periodic `still running` warnings every 30 seconds.
- Routine per-script telemetry is quiet by default and shown only with `sync --verbose`.
