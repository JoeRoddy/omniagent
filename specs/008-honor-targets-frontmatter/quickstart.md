# Quickstart: Honor Targets Frontmatter

**Date**: 2026-01-14  
**Feature**: `/Users/joeroddy/Documents/dev/projects/open-source/agentctl/specs/008-honor-targets-frontmatter/spec.md`

## Example Usage

1. Add targets to a skill:

```yaml
---
targets: [claude, codex]
---
```

2. Add targets to a subagent:

```yaml
---
targetAgents: gemini
---
```

3. Run a default sync to apply per-file defaults.

4. Run a one-off override:

```bash
npx omniagent@latest sync --only gemini
```

5. Filter targets from the active base set:

```bash
npx omniagent@latest sync --skip copilot
```
