# Quickstart: Sync Agent Config

## Prerequisites
- Canonical config exists at `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/agents/skills`.
- CLI is built (if running from source):

```bash
cd /Users/joeroddy/Documents/dev/projects/open-source/omniagent
npm run build
```

## Sync All Targets

```bash
node /Users/joeroddy/Documents/dev/projects/open-source/omniagent/dist/cli.js sync
```

Expected: per-target messages indicating `synced` or `skipped`.

## Skip or Limit Targets

```bash
node /Users/joeroddy/Documents/dev/projects/open-source/omniagent/dist/cli.js sync --skip codex
node /Users/joeroddy/Documents/dev/projects/open-source/omniagent/dist/cli.js sync --only claude
```

## JSON Output

```bash
node /Users/joeroddy/Documents/dev/projects/open-source/omniagent/dist/cli.js sync --json
```

## Error Examples

```bash
node /Users/joeroddy/Documents/dev/projects/open-source/omniagent/dist/cli.js sync --skip unknown
node /Users/joeroddy/Documents/dev/projects/open-source/omniagent/dist/cli.js sync --skip codex --only claude
```

Expected: a clear error message and non-zero exit code with no sync performed.
