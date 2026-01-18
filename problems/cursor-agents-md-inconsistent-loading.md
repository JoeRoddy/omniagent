# Cursor AGENTS.md Support Is Limited and Inconsistent

## Summary
Cursor documents AGENTS.md support, but it is limited (root-only, single file, no scoping) and
community reports show AGENTS.md is not reliably auto-loaded in some versions. This makes it a
fragile target for canonical instruction sync.

## Impact
- Teams expect AGENTS.md to apply automatically, but it may be ignored unless manually referenced.
- Nested or directory-specific instructions cannot be relied on.
- Switching between Cursor and other agents can lead to silent instruction drift.

## Notes / Context
- Cursor Rules docs describe AGENTS.md as a simple markdown alternative to `.cursor/rules` and
  list current limitations: project-root only, no scoping, single file. Nested AGENTS.md support
  was planned for a future version (v1.6).
- Cursor CLI docs say the CLI reads `AGENTS.md` and `CLAUDE.md` at the project root alongside
  `.cursor/rules`.
- Forum reports (Oct-Dec 2025) show AGENTS.md not being auto-attached in some builds:
  - Users on 1.7.44–1.7.52 report AGENTS.md only works when manually included (e.g., prefixing
    chat prompts) rather than being loaded automatically.
  - Users on 1.7.54 report nested AGENTS.md files not being loaded; a Cursor staff reply
    acknowledges it as a bug and suggests manually adding with @AGENTS.md.
  - Users on 2.1.26 report the root AGENTS.md is loaded unpredictably; it may only attach when
    the file is open or explicitly requested. A staff response suggests @AGENTS.md as a
    workaround and asks for repro details.
- Community replies mention case sensitivity (ensure the file is named `AGENTS.md`).

## Resources
- https://docs.cursor.com/en/context
- https://docs.cursor.com/en/cli/using
- https://forum.cursor.com/t/support-agents-md/133414
- https://forum.cursor.com/t/nested-agents-md-files-not-being-loaded/138411
- https://forum.cursor.com/t/agents-md-is-ignored/145135
