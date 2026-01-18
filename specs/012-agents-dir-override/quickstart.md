# Quickstart: Custom Agents Directory Override

## Goal

Use the default `agents/` directory for agent configs, or point the CLI at a custom directory with
`--agentsDir` while keeping behavior predictable and errors actionable.

## Example Layout

```text
agents/
├── skills/
│   └── review-helper/
│       └── SKILL.md
└── commands/
    └── deploy.md

my-custom-agents/
├── skills/
│   └── review-helper/
│       └── SKILL.md
└── commands/
    └── deploy.md
```

## Common Commands

- Use the default directory:
  - `omniagent sync`
- Use a custom directory (relative to project root):
  - `omniagent sync --agentsDir ./my-custom-agents`
- Use a custom directory (absolute path):
  - `omniagent sync --agentsDir /absolute/path/to/agents`

## Notes

- Relative `--agentsDir` paths resolve from the project root, not the current working directory.
- If the directory is missing, unreadable, or not a folder, the command fails with a clear error.
- Omitting `--agentsDir` always uses the default `agents/` directory.
