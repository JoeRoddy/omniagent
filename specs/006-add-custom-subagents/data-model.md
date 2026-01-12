# Data Model: Sync Custom Subagents

## Entities

### SubagentDefinition

Represents a canonical subagent file in `agents/agents/`.

**Fields**:
- `sourcePath` (string): Absolute path to the Markdown file.
- `fileName` (string): Base filename without extension.
- `rawContents` (string): Full file contents (frontmatter + body).
- `frontmatter` (object): Parsed YAML frontmatter (may include `name`, `description`, `tools`, `model`).
- `body` (string): Prompt body (after frontmatter).
- `resolvedName` (string): `frontmatter.name` if present; otherwise `fileName`.

**Validation rules**:
- File must be Markdown (`.md`).
- `rawContents` must not be empty.
- YAML frontmatter must be valid and readable.
- `resolvedName` must be unique case-insensitively across the catalog.

### SubagentCatalog

Represents the canonical collection of subagents.

**Fields**:
- `repoRoot` (string)
- `catalogPath` (string): `agents/agents/`
- `canonicalStandard` (string): `claude_code`
- `subagents` (SubagentDefinition[])

**Validation rules**:
- Directory must exist or be treated as empty catalog (no subagents).

### TargetSubagentOutput

Represents a subagent file written for a target that supports Claude-format subagents.

**Fields**:
- `targetName` (enum): `claude`
- `outputPath` (string): Project-level target path (e.g., `.claude/agents/<name>.md`)
- `resolvedName` (string)
- `rawContents` (string)

### ConvertedSkillOutput

Represents a skill file derived from a subagent for unsupported targets.

**Fields**:
- `targetName` (enum): `codex` | `copilot` | `gemini`
- `containerPath` (string): `.<target>/skills/<name>/`
- `skillPath` (string): `.<target>/skills/<name>/SKILL.md`
- `resolvedName` (string)
- `rawContents` (string)

### ManagedOutputRecord

Tracks outputs created by agentctrl to allow safe updates/removals.

**Fields**:
- `targetName` (enum)
- `outputPath` (string)
- `resolvedName` (string)
- `contentHash` (string)
- `managedBy` (string): `agentctrl`

## Relationships

- `SubagentCatalog.subagents` contains many `SubagentDefinition`.
- Each `SubagentDefinition` maps to either:
  - One `TargetSubagentOutput` for Claude, or
  - One `ConvertedSkillOutput` per unsupported target.
- `ManagedOutputRecord` links to each output to support safe updates/removals.
