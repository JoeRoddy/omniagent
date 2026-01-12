# Research: Agent-Specific Templating

## Decisions

- **Decision**: Use tag-style block syntax `<agents selector-list> ... </agents>` with include/exclude selectors.
  - **Rationale**: Avoids collisions with common `{}` usage while keeping inline placement flexible.
  - **Alternatives considered**: Single-brace inline syntax, double-bracket tags, line-based tags.

- **Decision**: Use `not:` prefix for exclusions inside the selector list (e.g., `<agents not:claude,gemini> ... </agents>`).
  - **Rationale**: Clear and readable exclusion marker that aligns with the example.
  - **Alternatives considered**: `!` prefix, `exclude:` keyword.

- **Decision**: Block ends at the first unescaped `</agents>`; `\</agents>` is treated as literal text.
  - **Rationale**: Avoids nested block ambiguity while allowing literal closing tags in content.
  - **Alternatives considered**: single-line blocks only, explicit end tokens.

- **Decision**: Block content may span multiple lines until the closing `</agents>`.
  - **Rationale**: Supports realistic config blocks without forcing inline-only content.
  - **Alternatives considered**: single-line-only blocks.

- **Decision**: Invalid selectors (unknown agents, empty lists, nested blocks, include+exclude conflicts) fail the entire sync run and list valid identifiers.
  - **Rationale**: Fail-fast behavior prevents silent corruption and provides clear remediation.
  - **Alternatives considered**: warnings or partial-file failure.

- **Decision**: Agent identifier matching is case-insensitive and limited to configured agents.
  - **Rationale**: Reduces user error while keeping selector scope explicit.
  - **Alternatives considered**: case-sensitive matching or unrestricted identifiers.
