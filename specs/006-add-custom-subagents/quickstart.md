# Quickstart: Sync Custom Subagents

## 1) Create the canonical catalog

```bash
mkdir -p agents/agents
```

## 2) Add a subagent (Claude Code format)

```bash
cat <<'AGENT' > agents/agents/code-improver.md
---
name: code-improver
description: Improve readability and performance of code
---
Analyze the provided code and suggest improvements.
AGENT
```

- If `name` is omitted, the filename (without `.md`) is used.
- Frontmatter must be valid YAML; empty files are rejected.

## 3) Sync to targets

```bash
agentctrl sync
```

- Claude Code receives project subagents in `.claude/agents/`.
- Other targets receive converted skills in their standard skill locations
  (e.g., `.codex/skills/code-improver/SKILL.md`).

## 4) Verify outputs

```bash
ls .claude/agents
ls .codex/skills/code-improver
```

If the canonical catalog is empty or removed, previously managed outputs are removed.
