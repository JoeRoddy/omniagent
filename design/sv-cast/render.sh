#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_IMAGE="${1:-$ROOT_DIR/source/siliconvalley04.webp}"
OUTPUT_IMAGE="${2:-$ROOT_DIR/output/sv-cast-with-agents.png}"
CAST_OUTPUT="$ROOT_DIR/work/sv-cast-with-agents.png"

CLAUDE_ICON="$ROOT_DIR/icons/claude-code.png"
CODEX_ICON="$ROOT_DIR/icons/codex.png"
COPILOT_ICON="$ROOT_DIR/icons/copilot.png"
BASE_FRAME="$ROOT_DIR/work/base-frame.png"

mkdir -p "$ROOT_DIR/output" "$ROOT_DIR/work"

# Extract a single clean frame from the source webp.
ffmpeg -y -i "$SOURCE_IMAGE" -frames:v 1 "$BASE_FRAME" >/dev/null 2>&1

# Cast mapping:
# Dinesh   -> Claude Code
# Gilfoyle -> Codex
# Richard  -> Codex
# Jared    -> Copilot
# TJ Miller-> Claude Code
# Stage 1: render cast + assigned icons.
ffmpeg -y \
	-i "$BASE_FRAME" \
	-i "$CLAUDE_ICON" \
	-i "$CODEX_ICON" \
	-i "$COPILOT_ICON" \
	-filter_complex "\
[1:v]scale=108:-1[claude_s];\
[claude_s]split=2[claude_a][claude_b];\
[2:v]scale=108:-1[codex_s];\
[codex_s]split=2[codex_a][codex_b];\
[3:v]scale=108:-1[copilot_s];\
[0:v][claude_a]overlay=280:415[tmp1];\
[tmp1][codex_a]overlay=470:370[tmp2];\
[tmp2][codex_b]overlay=690:410[tmp3];\
[tmp3][copilot_s]overlay=885:355[tmp4];\
[tmp4][claude_b]overlay=1198:365,format=rgb24[outv]" \
	-map "[outv]" \
	-frames:v 1 \
	"$CAST_OUTPUT" >/dev/null 2>&1

if ! command -v python3 >/dev/null 2>&1; then
	echo "python3 is required for the stage-2 panel rendering step." >&2
	exit 1
fi

# Stage 2: append /agents representation + config map and connect it to each cast icon.
python3 - "$CAST_OUTPUT" "$OUTPUT_IMAGE" <<'PY'
import math
import os
import sys

try:
	from PIL import Image, ImageDraw, ImageFont
except ModuleNotFoundError:
	sys.stderr.write("Pillow is required for stage-2 rendering (`python3 -m pip install pillow`).\n")
	raise SystemExit(1)


def load_font(size: int) -> ImageFont.ImageFont:
	candidates = [
		"/System/Library/Fonts/Supplemental/Menlo.ttc",
		"/System/Library/Fonts/SFNSMono.ttf",
		"/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
		"/usr/share/fonts/dejavu/DejaVuSansMono.ttf",
	]
	for candidate in candidates:
		if os.path.isfile(candidate):
			try:
				return ImageFont.truetype(candidate, size=size)
			except OSError:
				continue
	try:
		return ImageFont.truetype("DejaVuSansMono.ttf", size=size)
	except OSError:
		return ImageFont.load_default()


def draw_arrow(
	draw: ImageDraw.ImageDraw,
	start: tuple[int, int],
	end: tuple[int, int],
	color: tuple[int, int, int],
	line_width: int = 4,
	head_length: int = 24,
	head_width: int = 18,
) -> None:
	draw.line([start, end], fill=color, width=line_width)

	angle = math.atan2(end[1] - start[1], end[0] - start[0])
	left = (
		end[0] - head_length * math.cos(angle) + (head_width / 2) * math.sin(angle),
		end[1] - head_length * math.sin(angle) - (head_width / 2) * math.cos(angle),
	)
	right = (
		end[0] - head_length * math.cos(angle) - (head_width / 2) * math.sin(angle),
		end[1] - head_length * math.sin(angle) + (head_width / 2) * math.cos(angle),
	)
	draw.polygon([end, left, right], fill=color)


def icon_edge_point(
	start: tuple[int, int], center: tuple[int, int], radius: float
) -> tuple[int, int]:
	dx = center[0] - start[0]
	dy = center[1] - start[1]
	length = math.hypot(dx, dy)
	if length == 0:
		return center
	scale = max(length - radius, 0) / length
	return (int(start[0] + dx * scale), int(start[1] + dy * scale))


cast_output_path = sys.argv[1]
output_path = sys.argv[2]

base = Image.open(cast_output_path).convert("RGB")
width, height = base.size
panel_height = 432
panel_top = height

canvas = Image.new("RGB", (width, height + panel_height), (11, 18, 32))
canvas.paste(base, (0, 0))
draw = ImageDraw.Draw(canvas)

# Bottom panel and cards.
draw.rectangle((0, panel_top, width, panel_top + panel_height), fill=(11, 18, 32))
left_card = (70, panel_top + 50, 690, panel_top + panel_height - 40)
right_card = (width - 740, panel_top + 50, width - 70, panel_top + panel_height - 40)
draw.rectangle(left_card, fill=(30, 41, 59), outline=(147, 197, 253), width=3)
draw.rectangle(right_card, fill=(31, 41, 55), outline=(94, 234, 212), width=3)

# Left-to-right arrow between card headers.
header_center_y = panel_top + 96
draw_arrow(
	draw,
	(left_card[2] + 12, header_center_y),
	(right_card[0] - 12, header_center_y),
	(255, 255, 255),
	line_width=6,
	head_width=24,
)

# Monospace text content for /agents and config view.
title_font = load_font(42)
header_font = load_font(38)
section_font = load_font(29)
body_font = load_font(25)
meta_font = load_font(22)

draw.text((96, panel_top + 74), "<repo>/agents/", fill=(255, 255, 255), font=title_font)
draw.text((104, panel_top + 132), "skills/", fill=(191, 219, 254), font=section_font)
draw.text((130, panel_top + 172), "  - hello-world/SKILL.md", fill=(255, 255, 255), font=body_font)
draw.text((104, panel_top + 214), "commands/", fill=(191, 219, 254), font=section_font)
draw.text(
	(130, panel_top + 254),
	"  - omniagent-example-slash.md",
	fill=(255, 255, 255),
	font=body_font,
)
draw.text((104, panel_top + 296), "agents/", fill=(191, 219, 254), font=section_font)
draw.text((130, panel_top + 336), "  - code-improver.md", fill=(255, 255, 255), font=body_font)

draw.text((width - 710, panel_top + 74), "npx omniagent sync", fill=(255, 255, 255), font=header_font)
draw.text((width - 710, panel_top + 134), "dinesh   => claude", fill=(254, 243, 199), font=body_font)
draw.text((width - 710, panel_top + 179), "gilfoyle => codex", fill=(219, 234, 254), font=body_font)
draw.text((width - 710, panel_top + 224), "richard  => codex", fill=(219, 234, 254), font=body_font)
draw.text((width - 710, panel_top + 269), "jared    => copilot", fill=(220, 252, 231), font=body_font)
draw.text((width - 710, panel_top + 314), "erlich   => claude", fill=(254, 243, 199), font=body_font)
draw.text(
	(width - 710, panel_top + 346),
	"source => /agents/* + ~/.omniagent/state/*",
	fill=(153, 246, 228),
	font=meta_font,
)

# Arrowed lines fan out from the top-center of the sync-config card.
icon_radius = 56
shared_start = ((right_card[0] + right_card[2]) // 2, right_card[1])
connectors = [
	((334, 469), (254, 243, 199)),
	((524, 424), (219, 234, 254)),
	((744, 464), (219, 234, 254)),
	((939, 409), (220, 252, 231)),
	((1252, 419), (254, 243, 199)),
]
for icon_center, color in connectors:
	end = icon_edge_point(shared_start, icon_center, icon_radius)
	draw_arrow(draw, shared_start, end, color, line_width=4, head_width=18)
draw.ellipse(
	(shared_start[0] - 7, shared_start[1] - 7, shared_start[0] + 7, shared_start[1] + 7),
	fill=(255, 255, 255),
)

output_dir = os.path.dirname(output_path)
if output_dir:
	os.makedirs(output_dir, exist_ok=True)
canvas.save(output_path, format="PNG")
PY

echo "Wrote $OUTPUT_IMAGE"
