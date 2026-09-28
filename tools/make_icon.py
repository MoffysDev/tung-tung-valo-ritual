"""Draws the app icon (same shape as static/img/favicon.svg) into tools/icon.ico."""
import os

from PIL import Image, ImageDraw

SIZE = 256
S = SIZE / 32  # favicon.svg uses a 32x32 viewBox

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
draw.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=int(6 * S), fill="#0f1923")
for poly in ([(5, 7), (12, 7), (18, 19), (14.5, 26)], [(27, 7), (20, 7), (15.7, 15.6), (19.2, 22.6)]):
    draw.polygon([(x * S, y * S) for x, y in poly], fill="#ff4655")

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon.ico")
img.save(out, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("icon ->", out)
