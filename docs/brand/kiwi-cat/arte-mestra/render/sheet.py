# T10727 sheet: each candidate in dark and light at full size, and at 120 px in the hub's corner (the real hub, dark
# and light, at 2x and at 1x). Usage: sheet.py out.png "label" cand1.json [cand2.json ...]
import sys, json
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, ".")
import render
from pair import flat

FULL_H = 640  # full-size preview height (from a render at s = 0.25 -> 640 px)
font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 22)
small = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 16)


def in_hub(img_flat_rgba, theme):
    """The cat at 96 x 120 CSS px (192 x 240 device px), right 12 / bottom 12, on the hub screenshot (2x)."""
    hub = Image.open(f"bg/hub-{theme}.png").convert("RGB")
    W, H = hub.size
    cat = img_flat_rgba.resize((192, 240), Image.LANCZOS)
    hub.paste(cat, (W - 24 - 192, H - 24 - 240), cat)
    crop2 = hub.crop((W - 520, H - 420, W, H))  # 260 x 210 CSS px of the corner, at 2x
    crop1 = crop2.resize((crop2.width // 2, crop2.height // 2), Image.LANCZOS)  # the same at 1x
    return crop2, crop1


def cat_rgba(P, s, theme):
    """Render with the code's eyes, keeping alpha (for pasting on the hub)."""
    a = render.render(P, s, theme)
    w, h = a.size
    big = a.resize((w * 3, h * 3), Image.LANCZOS)
    d = ImageDraw.Draw(big)
    for ex, ey, er in render.EYES:
        d.ellipse([(ex - er) * s * 3, (ey - er) * s * 3, (ex + er) * s * 3, (ey + er) * s * 3],
                  fill=(255, 255, 255, 255) if theme == "dark" else (23, 23, 28, 255))
    return big.resize((w, h), Image.LANCZOS)


def block(P, label):
    s = FULL_H / 2560
    fd, fl = flat(P, s, "dark"), flat(P, s, "light")
    rows = []
    hubs = {}
    for theme in ("dark", "light"):
        hubs[theme] = in_hub(cat_rgba(P, 0.375, theme), theme)
    cw = fd.width
    W = cw * 2 + 520 * 2 + 50
    H = FULL_H + 80
    out = Image.new("RGB", (W, H), (58, 58, 64))
    d = ImageDraw.Draw(out)
    d.text((12, 12), label, font=font, fill=(240, 240, 240))
    y = 50
    out.paste(fd, (0, y)); out.paste(fl, (cw, y))
    x = cw * 2 + 30
    for i, theme in enumerate(("dark", "light")):
        c2, c1 = hubs[theme]
        out.paste(c2, (x + i * 530, y))
        out.paste(c1, (x + i * 530, y + 430))
        d.text((x + i * 530 + 270, y + 440), f"{theme}: 120 px\n2x (cima)\n1x (baixo)", font=small, fill=(220, 220, 220))
    return out


if __name__ == "__main__":
    out_path, title = sys.argv[1], sys.argv[2]
    blocks = [block(json.load(open(f)), json.load(open(f)).get("label", f)) for f in sys.argv[3:]]
    W = max(b.width for b in blocks)
    sheet = Image.new("RGB", (W, sum(b.height for b in blocks) + 50), (40, 40, 46))
    ImageDraw.Draw(sheet).text((12, 12), title, font=font, fill=(255, 255, 255))
    y = 50
    for b in blocks:
        sheet.paste(b, (0, y)); y += b.height
    sheet.save(out_path)
