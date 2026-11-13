# T10727 (#11103): the ghost's core is the mask of v2 itself: the dark core of kiwi-cat-candidata-v2.png by a
# luminance threshold, with the arc's crossing closed (it cuts the left ear off the head), then its signed distance
# field (canvas units, negative inside) at 512 x 640.
import sys, base64, json
import numpy as np
from PIL import Image
from scipy import ndimage as nd
V2 = "/Users/davivicente/Documents/personal-projects/code-projects/kiwinotes-wt/T10727/docs/brand/kiwi-cat/gerada/kiwi-cat-candidata-v2.png"
TH = float(sys.argv[2]) if len(sys.argv) > 2 else 26
img = Image.open(V2).convert("RGB").resize((512, 640), Image.LANCZOS)  # quarter scale: 1 px = 4 canvas units
v = np.asarray(img, np.float32); lum = v.mean(2)
# the dense core (lum < 26): the body and, cut off by the arc, the left ear; only big pieces near the centre
hard = lum < 26
lab, n = nd.label(hard)
sizes = nd.sum(hard, lab, range(1, n + 1))
cy, cx = np.array(nd.center_of_mass(hard, lab, range(1, n + 1))).T
border = set(np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]]))  # the outer background touches the edge
keep = [i + 1 for i in range(n) if sizes[i] > 400 and (i + 1) not in border and 100 < cx[i] < 412 and 120 < cy[i] < 560]
hard = np.isin(lab, keep)
# then the darker-than-mist pixels next to it (the arc's spill on the head), never far from the dense core
dist = nd.distance_transform_edt(~hard)
rows = np.arange(lum.shape[0])[:, None] * 4.0                  # canvas y of each row
near = dist < np.where(rows < 1450, 14, 40)                    # the lower body's fog is lighter: let it grow more
core = (lum < TH) & near
# close with a disk (no square artefacts): bridges the arc band where it crosses the ear and the head
r = 18
yy, xx = np.mgrid[-r:r + 1, -r:r + 1]; disk = (xx * xx + yy * yy) <= r * r
core = nd.binary_closing(np.pad(core, r), structure=disk)[r:-r, r:-r]
core = nd.binary_fill_holes(core)
lab, _ = nd.label(core); core = lab == lab[400, 256]
# a light smoothing of the traced edge (pixel noise), keeping the shape
core = nd.gaussian_filter(core.astype(np.float32), 3.0) > 0.5
d = (nd.distance_transform_edt(~core) - nd.distance_transform_edt(core)) * 4.0
out = sys.argv[1] if len(sys.argv) > 1 else "sdf.json"
# R: the distance; G: the same, blurred (the halo reads it: no ridge where the fields of the two ears meet)
g = nd.gaussian_filter(d, 14.0)
rg = np.dstack([d, g]).astype(np.float32)
open(out, "w").write(json.dumps({"w": 512, "h": 640, "channels": 2, "data": base64.b64encode(rg.tobytes()).decode()}))
Image.fromarray((core * 255).astype(np.uint8)).save(out.replace(".json", "-mask.png"))
ys, xs = np.nonzero(core); print("bbox canvas", xs.min() * 4, xs.max() * 4, ys.min() * 4, ys.max() * 4)
