# Quickstart: Agent-Specific Templating

## Use a scoped block

Use a tag-style block with a selector list followed by content:

```text
Regular text
<agents claude,codex>This text is only for Claude and Codex</agents>
More text
```

## Exclude specific agents

Use the `not:` prefix to exclude agents:

```text
<agents not:claude,gemini>This text is for all agents except Claude and Gemini</agents>
```

## Multi-line blocks

Blocks can span multiple lines until the closing `</agents>`:

```text
<agents claude,codex>
Line 1
Line 2
</agents>
```

## Escaping closing tags

Use `\</agents>` for literal closing tags inside content:

```text
<agents codex>
This is a literal closing tag: \</agents>
</agents>
```

## Error behavior

If any selector is invalid (unknown agent, empty list, nested block, or conflicting
include/exclude), the entire sync run fails, no outputs are changed, and the error
lists valid agent identifiers.
