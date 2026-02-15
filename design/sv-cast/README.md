# SV Cast Image Pipeline

This folder keeps the Silicon Valley cast image + agent icon overlay pipeline in-repo.

## Files

- `source/siliconvalley04.webp`: base source image
- `icons/claude-code.png`: Claude Code icon
- `icons/codex.png`: Codex icon
- `icons/copilot.png`: Copilot icon
- `output/sv-cast-with-agents.png`: composite with cast icons + `/agents`/config panel + arrows
- `render.sh`: script to regenerate the composite
- `work/sv-cast-with-agents.png`: intermediate stage output (cast + icons only)

## Regenerate

From repo root:

```bash
./design/sv-cast/render.sh
```

Prerequisites: `ffmpeg`, `python3`, and the Python `Pillow` package.

Optional custom output path:

```bash
./design/sv-cast/render.sh ./design/sv-cast/source/siliconvalley04.webp ./design/sv-cast/output/sv-cast-with-agents.png
```

## Render Stages

1. Extract a clean base frame from the source image.
2. Overlay agent icons onto each cast member.
3. Add a lower panel that represents `/agents/` and sync config, then draw arrowed connectors from config rows to each cast icon.
