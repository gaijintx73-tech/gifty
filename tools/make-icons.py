#!/usr/bin/env python3
"""Regenerate Gifty's PNG icons from the design in icons/icon.svg.

Requires Pillow:  pip install Pillow
Run from the repo root:  python3 tools/make-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BLUE = (29, 78, 216, 255)
RED = (229, 72, 77, 255)
WHITE = (255, 255, 255, 255)


def draw_icon(size: int) -> Image.Image:
    # Draw at 4x and downscale for smooth edges, especially at 16px.
    scale = 4
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def xy(x, y):
        return (x / 128 * s, y / 128 * s)

    def rect(x0, y0, x1, y1, fill, radius=0):
        d.rounded_rectangle([xy(x0, y0), xy(x1, y1)], radius=radius / 128 * s, fill=fill)

    def ellipse(cx, cy, rx, ry, fill):
        x0, y0 = xy(cx - rx, cy - ry)
        x1, y1 = xy(cx + rx, cy + ry)
        d.ellipse([x0, y0, x1, y1], fill=fill)

    rect(4, 4, 124, 124, BLUE, radius=26)
    # Bow: two loops + knot. Rotation is skipped at icon sizes; the
    # loops read fine as ellipses tucked behind the lid.
    ellipse(50, 30, 11, 7, RED)
    ellipse(78, 30, 11, 7, RED)
    # Lid + ribbon.
    rect(20, 38, 108, 56, WHITE, radius=5)
    d.rectangle([xy(57, 38), xy(71, 56)], fill=RED)
    # Body + ribbon.
    rect(28, 58, 100, 104, WHITE, radius=6)
    d.rectangle([xy(57, 58), xy(71, 104)], fill=RED)
    # Knot.
    ellipse(64, 36, 6, 6, RED)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    icons = ROOT / "icons"
    icons.mkdir(exist_ok=True)
    for size in (16, 48, 128):
        out = icons / f"icon{size}.png"
        draw_icon(size).save(out)
        print(f"wrote {out}")


if __name__ == "__main__":
    main()
