"""Assemble headless proofs, preserving reference pixels. Requires Pillow."""
import argparse
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("render", type=Path, help="output directory of kiwicat-face-check.ts")
parser.add_argument("--key", type=Path, required=True, help="private answer file, outside the repo")
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
if args.key.resolve().is_relative_to(root):
    parser.error("keep the blind answer key outside the repository until review")
out = root / "docs/brand/kiwi-cat/caretas"
out.mkdir(parents=True, exist_ok=True)
states = ["repouso", "dormindo", "acordou", "ouvindo", "thinking", "agindo", "pronto", "erro"]
font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
sheet = Image.new("RGB", (1000, 1420), "#101116")
draw = ImageDraw.Draw(sheet)
for index, state in enumerate(states):
    x, y = (index % 2) * 500, (index // 2) * 355
    draw.text((x + 10, y + 5), state, font=font, fill="white")
    frame = "02" if state in ("acordou", "ouvindo") else "01"
    sources = [root / f"docs/brand/kiwi-cat/estados/quadros/{state}-{frame}.webp",
               args.render / f"{state}.png"]
    for column, source in enumerate(sources):
        with Image.open(source) as image:
            image = image.convert("RGB")
            image.thumbnail((240, 300))
            sheet.paste(image, (x + column * 250 + (250 - image.width) // 2, y + 50))
        draw.text((x + column * 250 + 10, y + 28), "prancha" if column == 0 else "código",
                  font=font, fill="#bbc0cf")
sheet.save(out / "comparacao-prancha.webp", quality=88, method=6)
order = random.SystemRandom().sample(states, len(states))
strip = Image.new("RGB", (96 * 8, 120), "black")
for index, state in enumerate(order):
    with Image.open(args.render / f"{state}.png") as image:
        image = image.convert("RGB").resize((96, 120), Image.Resampling.LANCZOS)
        strip.paste(image, (96 * index, 0))
strip.save(out / "tira-cega-120.webp", quality=95, method=6)
args.key.write_text(json.dumps(order) + "\n")
