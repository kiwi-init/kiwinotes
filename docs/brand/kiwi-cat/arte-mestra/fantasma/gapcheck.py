# T10727: the aura has no gaps. For every rendered still, the alpha on the contours 40, 100 and 160 canvas units
# outside the core (the v2 mask, moved by the float at that height) must stay above a floor, all the way round.
import sys, json, base64, math, glob
import numpy as np
from PIL import Image
from scipy import ndimage as nd
sd = json.load(open("sdf.json"))
d = np.frombuffer(base64.b64decode(sd["data"]), np.float32).reshape(640, 512, 2)[..., 0]
P = dict(period=6.5, lift=64, tailLag=0.3)
def bob(y, t):
    lag = P["tailLag"] * np.clip((y - 1300) / 900, 0, 1) ** 2 * (3 - 2 * np.clip((y - 1300) / 900, 0, 1))
    return P["lift"] * np.sin(2 * math.pi * t / P["period"] - lag)
worst = {}
for theme in ("dark", "light"):
    for f in sorted(glob.glob(f"gaps/ghost-{theme}-*.png")):
        t = float(f.rsplit("-", 1)[1][:-4])
        a = np.asarray(Image.open(f))[..., 3].astype(np.float32) / 255
        S = a.shape[1] / 2048
        for off in (40, 100, 160):
            band = np.abs(d - off) < 6
            ys, xs = np.nonzero(band)
            cx, cy = xs * 4 + 2, ys * 4 + 2
            cy = cy + bob(cy, t)
            keep = cy < 1700          # the head, the ears and the sides (below, the wisps and the ring take over)
            px = np.clip((cx[keep] * S).astype(int), 0, a.shape[1] - 1); py = np.clip((cy[keep] * S).astype(int), 0, a.shape[0] - 1)
            vals = a[py, px]
            k = (theme, off)
            i = int(vals.argmin())
            if k not in worst or vals.min() < worst[k][0]:
                worst[k] = (float(vals.min()), t, int(cx[keep][i]), int(cy[keep][i]), float(np.median(vals)))
for k, v in sorted(worst.items()):
    print(k, "min alpha %.3f at t=%.2f (x %d, y %d), median %.3f, min/median %.2f" % (v + (v[0] / v[4],)))
