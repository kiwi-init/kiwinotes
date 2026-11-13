# Preview: dark and light side by side, with the code's eyes on top (white on dark, near-black on light).
import sys, json
from PIL import Image, ImageDraw
sys.path.insert(0, ".")
import render
def eyes(img, s, col):
    d = ImageDraw.Draw(img)
    for ex, ey, er in render.EYES:
        d.ellipse([(ex-er)*s, (ey-er)*s, (ex+er)*s, (ey+er)*s], fill=col)
    return img
def flat(P, s, theme):
    a = render.render(P, s, theme); w, h = a.size
    bg = Image.new("RGB", (w, h), (0,0,0) if theme=="dark" else (255,255,255)); bg.paste(a, (0,0), a)
    # eyes drawn supersampled for clean edges
    big = bg.resize((w*4, h*4)); eyes(big, s*4, (255,255,255) if theme=="dark" else (23,23,28))
    return big.resize((w, h), Image.LANCZOS)
if __name__ == "__main__":
    P = json.load(open(sys.argv[1])); s = float(sys.argv[2])
    a, b = flat(P, s, "dark"), flat(P, s, "light"); w, h = a.size
    c = Image.new("RGB", (w*2, h)); c.paste(a, (0,0)); c.paste(b, (w,0)); c.save(sys.argv[3])
