# Unified Agent Configuration CLI – Project Direction

## Problem Statement

AI coding agents (Claude Code, OpenAI Codex, Gemini/Jules, Cursor, Copilot, etc.) all require **configuration** to be effective: instructions, skills/tools, agent personas, and sometimes subagents. Today, this configuration is fragmented:

* `AGENTS.md` provides shared instructions, but is **passive and limited**.
* Agent Skills (`skills.md`, `SKILL.md`) solve **tool distribution**, not agent behavior or structure.
* Subagents exist (notably in Claude), but are **vendor-specific** and non-portable.
* Teams maintain **parallel configs** per agent or silently accept drift.

There is **no open-source tool** that provides a *single source of truth* for AI coding agent configuration and **compiles/export it** to multiple agent runtimes.

This project exists to fill that gap.

---

## Clear Conclusion from Research

**No existing open-source project fully solves this problem.**

What exists today are partial solutions:

* **AGENTS.md** → shared instructions only
* **AgentSkills ecosystem** → skills only
* **Claude subagents** → powerful but Claude-only
* **Multi-agent frameworks** → runtime orchestration, wrong abstraction level

No tool currently:

* models agents, skills, and subagents together
* supports global + per-project configuration
* exports to multiple vendor-specific formats

This is an unclaimed space.

---

## Core Concept

A **CLI-first, open-source tool** that:

* Lets users define **one canonical agent directory**
* Treats that directory as the **source of truth**
* Compiles/transpiles it into the equivalent configuration for:

  * Claude Code
  * OpenAI Codex
  * Gemini / Jules
  * Cursor / Copilot / others (where possible)

Think:

> **Terraform + Babel for AI coding agents**

---

## Canonical Agent Directory (Proposed)

Example structure:

```
agents/
  agent.md            # core agent instructions / identity
  policies.md         # safety, scope, boundaries
  skills/
    git.md
    testing.md
  subagents/
    frontend.md
    refactorer.md
  targets/
    claude.yaml       # optional overrides
    codex.yaml
```

Key properties:

* Markdown-first (human-readable, diffable)
* Optional structured frontmatter (YAML/TOML)
* Explicit separation between **intent** and **target mappings**

---

## CLI Responsibilities

The CLI is **not** a runtime or agent framework. It is a **compiler / adapter**.

Responsibilities:

* Validate canonical agent config
* Resolve global vs project-level overrides
* Generate target-specific outputs
* Handle lossy mappings explicitly and visibly

Non-responsibilities:

* Running agents
* Orchestrating multi-agent workflows
* Hosting models

---

## Example CLI Usage

```
omniagent init
omniagent validate
omniagent compile --target claude
omniagent compile --target codex
omniagent install --global
omniagent install --project
```

Where:

* `compile` produces files in the format each agent expects
* `install` places them in correct global/project locations

---

## Target Support (Initial)

### Claude Code

* `.claude/agents/*.md` (subagents)
* `AGENTS.md`
* Native skills

### OpenAI Codex

* Prompt / instruction bundles
* Skills where supported

### Gemini / Jules

* Instruction context
* Tool hints

### Cursor / Copilot

* Shared instructions
* Skill injection (where possible)

Design assumption: **not all features map cleanly**. The tool should surface this, not hide it.

---

## Global vs Project Configuration

Hard requirement:

* Global agent defaults (user-level)
* Project overrides (repo-level)

Resolution order:

1. Project overrides
2. Global config
3. Canonical defaults

This mirrors Git / Terraform / ESLint behavior.

---

## Relationship to Existing Standards

This project should:

* **Consume and emit** `AGENTS.md`
* **Consume and emit** AgentSkills-compatible skill definitions
* Treat existing standards as *targets*, not constraints

It is explicitly **not** another standard competing with them.

---

## Naming Direction

Strong, realistic CLI names:

* `omniagent`
* `agentforge`
* `omnigent`

Preference: boring, precise, infra-flavored.

---

## Strategic Insight

This project is:

* Early, not late
* Clearly missing in the ecosystem
* Likely to be adopted quickly by power users
* A foundation layer others can build on

If done well, it becomes the **de facto control plane** for AI coding agents.

---

## Open Questions (Intentional)

* Should this eventually define a formal intermediate spec?
* How explicit should lossy mappings be?
* Do subagents become first-class everywhere, or remain best-effort?

These are design questions, not blockers.

---

## Bottom Line

There is currently **no single source of truth** for AI coding agent configuration.

This project proposes to become that source of truth — without pretending all agents are the same.

