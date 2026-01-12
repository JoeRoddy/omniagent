# Data Model: Agent-Specific Templating

## Entities

### Agent Identifier

- **Represents**: The canonical agent name used for selector matching.
- **Attributes**:
  - `name`: string (case-insensitive match)
- **Validation**:
  - Must match one of the agents configured in the project.

### Template Block

- **Represents**: A scoped block of text within a syncable file.
- **Attributes**:
  - `selectorList`: raw selector list (e.g., `claude,codex` or `not:claude,gemini`)
  - `includeAgents`: list of agent identifiers (case-insensitive)
  - `excludeAgents`: list of agent identifiers (case-insensitive)
  - `content`: string, may include newlines and escaped `\</agents>`
- **Relationships**:
  - References one or more Agent Identifiers for inclusion or exclusion.
- **Validation Rules**:
  - Selector list must not be empty.
  - Include and exclude lists must not both contain the same agent.
  - Unknown agent identifiers are invalid.
  - Nested blocks are invalid.
  - End delimiter is the first unescaped `</agents>`.

## State Transitions

- Template Blocks are parsed from source files during sync and resolved per target agent.
- Invalid selectors cause the sync run to fail with no outputs changed.
