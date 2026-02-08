# Quickstart: Dynamic Template Scripts

## Goal

Verify that sync evaluates template scripts, reuses each script result across targets, and fails
fast with no partial managed outputs when a script errors.

## 1) Add a template with a dynamic docs list

Create a syncable template (example: `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/agents/commands/docs-index.md`) containing:

```md
# docs-index

Current docs pages:
<oa-script>
const fs = await import("node:fs/promises");
const path = await import("node:path");

const docsDir = path.join(process.cwd(), "docs");
const entries = await fs.readdir(docsDir, { withFileTypes: true });
const pages = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .map((entry) => `- ${entry.name}`)
  .sort();

return pages.join("\n");
</oa-script>
```

## 2) Run sync

Run:

```bash
npm run build
node /Users/joeroddy/Documents/dev/projects/open-source/omniagent/dist/cli.js sync --only claude,gemini
```

Expected result:
- Output files contain rendered markdown list items instead of the `<oa-script>` block.
- Static template text remains unchanged.

## 3) Verify reuse across targets

Run sync for multiple targets and compare generated sections.

Expected result:
- The script block executes once for the template in that run and both targets receive the same
  rendered script output.

## 4) Verify failure behavior

Temporarily change the block to throw:

```md
<oa-script>
throw new Error("intentional failure");
</oa-script>
```

Run sync again.

Expected result:
- Sync exits failed on the first script error.
- Error output identifies template path and script block.
- No partial sync-managed rendered outputs are written for the failed run.

## 5) Verify long-running warnings and verbose telemetry

Use a long-running script and run with verbose mode:

```bash
node /Users/joeroddy/Documents/dev/projects/open-source/omniagent/dist/cli.js sync --verbose
```

Expected result:
- Default mode suppresses routine per-script telemetry.
- Verbose mode shows per-script execution events.
- Long-running scripts emit periodic `still running` warnings without timeout.
