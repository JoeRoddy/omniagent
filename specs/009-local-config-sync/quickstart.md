# Quickstart: Shared and Local Config Sync

## Goal

Use shared config from `agents/` while allowing personal overrides in
`agents/.local/` or via `.local` suffixes (file or skill directory), with
predictable sync behavior and safe ignore guidance.

## Example Layout

```text
agents/
├── skills/
│   ├── review-helper/
│   │   └── SKILL.md
│   └── review-helper.local/
│       └── SKILL.md
├── commands/
│   ├── deploy.md
│   └── deploy.local.md
└── .local/
    ├── skills/
    │   └── ops-helper/
    │       └── SKILL.md
    └── commands/
        └── deploy.md
```

## Common Commands

- Sync shared + local (local overrides win):
  - `omniagent sync`
- Sync shared only:
  - `omniagent sync --exclude-local`
- Exclude local for specific categories:
  - `omniagent sync --exclude-local=skills,commands`
- List local items:
  - `omniagent sync --list-local`

## Notes

- Outputs never include `.local` in filenames.
- If a local item exists in both `agents/.local/` and as a `.local` suffix (file
  or skill directory), the `agents/.local/` version wins.
- If local items exist and ignore rules are missing, sync will prompt to update
  repo `.gitignore` (interactive only, and only once if declined).
- Non-interactive runs never prompt and report missing ignore rules in the
  summary instead.
