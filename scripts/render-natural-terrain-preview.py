"""Render queried terrain JSON with Pillow; no plotting or game-renderer dependency.

Reproduce from the repository root:
    node --import tsx scripts/preview-terrain.mts
    python scripts/render-natural-terrain-preview.py
"""
from __future__ import annotations

import json
import math
import sys
from functools import lru_cache
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "outputs/terrain-preview.json"
OUTPUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "docs/terrain-preview.png"
DATA = json.loads(SOURCE.read_text(encoding="utf-8"))

WIDTH, HEIGHT = 1600, 1870
PAPER, INK, MUTED = "#f3f2e9", "#20352f", "#5b6c65"
MAP_SIZE = 704
OCEAN = (46, 101, 121)
INLAND = (77, 153, 186)
RAMP = [(0, (156, 182, 121)), (5, (120, 155, 96)), (12, (154, 173, 118)),
        (22, (188, 188, 146)), (35, (197, 195, 176)), (50, (232, 230, 214))]


@lru_cache(maxsize=32)
def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [Path("C:/Windows/Fonts/malgunbd.ttf" if bold else "C:/Windows/Fonts/malgun.ttf"),
                  Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
                  Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else
                       "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default(size=size)


def altitude_color(value: float) -> tuple[int, int, int]:
    for (low, a), (high, b) in zip(RAMP, RAMP[1:]):
        if value <= high:
            t = max(0, min(1, (value - low) / (high - low)))
            return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
    return RAMP[-1][1]


def shaded_map(panel: dict) -> Image.Image:
    n, step = DATA["resolution"], DATA["spacing"]
    ground, water = panel["heights"], panel["water"]
    raster = Image.new("RGB", (n, n))
    pixels = raster.load()
    sun = (-0.45, 0.84, -0.30)
    for row in range(n):
        up, down = max(0, row - 1), min(n - 1, row + 1)
        for col in range(n):
            i = row * n + col
            if water[i] is not None:
                pixels[col, row] = OCEAN if ground[i] < DATA["seaLevel"] else INLAND
                continue
            left, right = max(0, col - 1), min(n - 1, col + 1)
            dx = (ground[row * n + right] - ground[row * n + left]) / ((right - left) * step)
            dz = (ground[down * n + col] - ground[up * n + col]) / ((down - up) * step)
            length = math.sqrt(dx * dx + 1 + dz * dz)
            diffuse = (-dx * sun[0] + sun[1] - dz * sun[2]) / length
            shade = 0.65 + 0.4 * max(0, diffuse)
            base = altitude_color(ground[i])
            pixels[col, row] = tuple(min(255, round(channel * shade)) for channel in base)
    # Samples include the exact gameplay triangle interpolation at half-grid steps.
    return raster.resize((MAP_SIZE, MAP_SIZE), Image.Resampling.BILINEAR)


image = Image.new("RGB", (WIDTH, HEIGHT), PAPER)
draw = ImageDraw.Draw(image)
draw.text((48, 26), "NIGHTFALL / TERRAIN REVIEW", font=font(37, True), fill=INK)
draw.text((50, 79), "Existing landscape + three seeded worlds", font=font(22), fill=MUTED)
draw.text((50, 112), "Queried altitude and water map. Shading shows slopes; this is not an in-game screenshot.",
          font=font(18), fill=MUTED)

REGIONS = [("Highlands", -30, -310), ("Volcano", 317, -18), ("Marsh", -325, 20),
           ("Forest", 140, 135), ("Ruins", 20, 327), ("Meadow", 15, 46)]
extent = DATA["extent"]
for i, panel in enumerate(DATA["panels"]):
    left, top = 48 + (i % 2) * 780, 177 + (i // 2) * 820
    draw.text((left, top), panel["title"], font=font(24, True), fill=INK)
    draw.text((left, top + 34), panel["subtitle"], font=font(17), fill=MUTED)
    mx, my = left, top + 65
    map_image = shaded_map(panel)
    image.paste(map_image, (mx, my))
    draw.rounded_rectangle((mx, my, mx + MAP_SIZE - 1, my + MAP_SIZE - 1), radius=4, outline="#627d71", width=2)

    def point(x: float, z: float) -> tuple[float, float]:
        return mx + (x + extent) / (extent * 2) * (MAP_SIZE - 1), my + (z + extent) / (extent * 2) * (MAP_SIZE - 1)

    for name, x, z in REGIONS:
        px, py = point(x, z)
        bounds = draw.textbbox((px, py), name, font=font(17, True), anchor="mm")
        draw.rounded_rectangle((bounds[0] - 7, bounds[1] - 5, bounds[2] + 7, bounds[3] + 5),
                               radius=6, fill="#e9eee1", outline="#b2bdad")
        draw.text((px, py), name, font=font(17, True), fill=INK, anchor="mm")
    sx, sz = point(0, 8)
    draw.ellipse((sx - 4, sz - 4, sx + 4, sz + 4), fill="#f5c45a", outline=INK, width=1)
    draw.text((sx + 8, sz - 12), "Spawn", font=font(14, True), fill="#fff9dc", stroke_width=1, stroke_fill=INK)
    # A compass matches the game: -Z is north, +X is east.
    cx, cy = mx + MAP_SIZE - 38, my + 49
    draw.line((cx, cy + 22, cx, cy - 7), fill="#dbe8de", width=3)
    draw.polygon([(cx, cy - 14), (cx - 7, cy - 1), (cx + 7, cy - 1)], fill="#dbe8de")
    draw.text((cx, cy - 24), "N", font=font(16, True), fill="#edf5ed", anchor="mm")
    draw.text((cx + 20, cy + 10), "E", font=font(13), fill="#edf5ed", anchor="mm")
    bar = MAP_SIZE / (extent * 2) * 100
    bx, by = mx + 24, my + MAP_SIZE - 32
    draw.line((bx, by, bx + bar, by), fill="#dbe8de", width=4)
    draw.line((bx, by - 5, bx, by + 5), fill="#dbe8de", width=2)
    draw.line((bx + bar, by - 5, bx + bar, by + 5), fill="#dbe8de", width=2)
    draw.text((bx + bar / 2, by - 18), "100 units", font=font(13), fill="#edf5ed", anchor="mm")

# A shared legend keeps all four landscapes directly comparable.
legend_y = 1802
draw.text((48, legend_y - 4), "Altitude", font=font(19, True), fill=INK)
legend_x, legend_width = 155, 510
for offset in range(legend_width):
    draw.line((legend_x + offset, legend_y, legend_x + offset, legend_y + 20),
              fill=altitude_color(offset / (legend_width - 1) * 50))
for height in (0, 10, 20, 30, 40, 50):
    x = legend_x + height / 50 * legend_width
    draw.text((x, legend_y + 29), str(height), font=font(14), fill=MUTED, anchor="mm")
draw.rectangle((760, legend_y, 784, legend_y + 20), fill=INLAND)
draw.text((796, legend_y - 1), "River / ponds", font=font(17), fill=MUTED)
draw.rectangle((1023, legend_y, 1047, legend_y + 20), fill=OCEAN)
draw.text((1059, legend_y - 1), "Sea (-1.2)", font=font(17), fill=MUTED)
draw.text((1552, legend_y + 35), f'{DATA["resolution"]} x {DATA["resolution"]} queries / world',
          font=font(14), fill=MUTED, anchor="rm")
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
image.save(OUTPUT, optimize=True)
print(f"Wrote {OUTPUT} ({WIDTH} x {HEIGHT}).")
