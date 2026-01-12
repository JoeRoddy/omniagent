# Research: Sync Custom Subagents

**Date**: 2026-01-11

## Decision 1: Canonical subagent format

**Decision**: Use Claude Code subagent files (Markdown with YAML frontmatter) as the canonical format.

**Rationale**:
- Claude Code documents subagents as Markdown files with YAML frontmatter stored in `.claude/agents/` (project) or `~/.claude/agents/` (user).
- The canonical catalog is repo-scoped, so the project-level `.claude/agents/` format is the closest match.

**Alternatives considered**:
- Copilot custom agent profiles in `.github/agents/` (different schema and location).
- A new neutral format (would require full mapping rules and additional parsing).

**Sources**:
- https://docs.anthropic.com/en/docs/claude-code/sub-agents
- https://docs.anthropic.com/en/docs/claude-code/settings

## Decision 2: Supported targets for native subagent sync

**Decision**: Treat only Claude Code as a native subagent target; convert subagents to skills for other targets.

**Rationale**:
- Claude Code subagents are explicitly documented with a concrete on-disk format.
- GitHub Copilot has custom agents, but the agent profile format (`.github/agents/`) differs from Claude’s and includes fields not shared across targets.
- No official Codex or Gemini CLI documentation defines a Claude-compatible subagent format.

**Alternatives considered**:
- Implement Copilot agent profile output directly (would require a separate mapping layer).
- Implement separate native formats for each target (out of scope for this feature).

**Sources**:
- https://docs.anthropic.com/en/docs/claude-code/sub-agents
- https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-custom-agents
- https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents
- https://developers.openai.com/codex/config-advanced/

## Decision 3: Project-level output only

**Decision**: Sync subagents to project-level target locations only.

**Rationale**:
- The canonical catalog is repository-scoped and intended for team sharing.
- Claude Code distinguishes project vs user subagents; project scope aligns with version control.

**Alternatives considered**:
- Support user-level subagent output as an optional scope (adds CLI prompts and risk of global writes).

**Sources**:
- https://docs.anthropic.com/en/docs/claude-code/sub-agents
- https://docs.anthropic.com/en/docs/claude-code/settings
