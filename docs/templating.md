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
