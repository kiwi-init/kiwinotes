# A aura do Kiwi-cat (T3720, #4071): o anel de luz escorre até virar o halo do corpo, por transporte ótimo.
# A luz da origem (luz-anel) e a do destino (final-fundo + final-corpo, sem a cabeça inteira) viram massa numa grade;
# o Sinkhorn dá para onde cada pedaço vai. Cada pose é um morph de dois lados: a origem empurrada pelo campo de
# deslocamento e o destino puxado pelo inverso, misturados por e. A pose 00 é a origem exata; a última, o destino.
# Escreve pose-NN.webp e aura.json (o contrato com o runtime, #4088/#4093).
#
#   KIWI_IMAGE_PYTHON (Pillow, NumPy e SciPy): $KIWI_IMAGE_PYTHON docs/brand/kiwi-cat/aura/morph.py docs/brand/kiwi-cat/camadas docs/brand/kiwi-cat/aura [--poses 24] [--grid 96] [--rotacao 30]
import argparse, json, os, time

import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("camadas")
ap.add_argument("out")
ap.add_argument("--poses", type=int, default=24)
ap.add_argument("--grid", type=int, default=96)
ap.add_argument("--size", type=int, default=512)
ap.add_argument("--eps", type=float, default=0.0015)
ap.add_argument("--rotacao", type=float, default=0.0, help="the ring's angle (deg) when the morph starts")
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)
cam = json.load(open(os.path.join(args.camadas, "camadas.json")))
S = 1024


def stage(name):
    """The layer as premultiplied RGB light on the 1024 stage (float, 0..1)."""
    x, y, r, b = cam["recortes"][name]
    im = Image.open(os.path.join(args.camadas, f"{name}.webp")).convert("RGBA")
    a = np.asarray(im).astype(np.float64) / 255
    out = np.zeros((S, S, 3))
    out[y:b, x:r] = a[..., :3] * a[..., 3:4]
    return out


src = stage("luz-anel")
if args.rotacao:
    # The ring turns until the morph starts: the bake starts from it at that angle, around the circle's centre (512,430).
    from scipy import ndimage as _nd
    c = np.array([430.0, 512.0])
    th = np.deg2rad(args.rotacao)
    R = np.array([[np.cos(th), np.sin(th)], [-np.sin(th), np.cos(th)]])  # (row, col), clockwise like CSS rotate()
    src = np.stack([_nd.affine_transform(src[..., k], R.T, offset=c - R.T @ c, order=1) for k in range(3)], -1)
fundo = stage("final-fundo")
corpo_x, corpo_y, corpo_r, corpo_b = cam["recortes"]["final-corpo"]
ca = np.asarray(Image.open(os.path.join(args.camadas, "final-corpo.webp")).convert("RGBA")).astype(np.float64) / 255
dst = fundo.copy()
dst[corpo_y:corpo_b, corpo_x:corpo_r] = ca[..., :3] * ca[..., 3:4] + dst[corpo_y:corpo_b, corpo_x:corpo_r] * (1 - ca[..., 3:4])
# Only the glow: the whole head (gerada/cabeca-inteira.png, the photo at 819x1024 on (102,-82)) comes out, with the
# arc inside it; the fog outside stays (calm-dingo, #4085).
head = Image.open(os.path.join(args.camadas, "..", "gerada", "cabeca-inteira.png")).convert("RGBA").resize((819, 1024), Image.LANCZOS)
hm = np.zeros((S, S))
ha = np.asarray(head).astype(np.float64)[..., 3] / 255
hm[0:942, 102:921] = ha[82:1024, :]
glow = dst * (1 - hm)[..., None]



def masses(img, g):
    """Mass (luminance) and mean colour per grid cell, and the cell centres in 0..1."""
    lum = img @ np.array([0.2126, 0.7152, 0.0722])
    k = S // g
    m = lum[: g * k, : g * k].reshape(g, k, g, k).sum((1, 3))
    col = img[: g * k, : g * k].reshape(g, k, g, k, 3).sum((1, 3)) / np.maximum(m[..., None], 1e-9)
    ys, xs = np.mgrid[0:g, 0:g]
    pts = np.stack([(xs + 0.5) / g, (ys + 0.5) / g], -1)
    keep = m > m.max() * 0.01
    return m[keep], col[keep], pts[keep]


t0 = time.time()
ma, ca_, pa = masses(src, args.grid)
mb, cb, pb = masses(glow, args.grid)
wa, wb = ma / ma.sum(), mb / mb.sum()
C = ((pa[:, None, :] - pb[None, :, :]) ** 2).sum(-1)
K = np.exp(-C / args.eps)
u = np.ones(len(wa))
for _ in range(400):
    v = wb / (K.T @ u + 1e-300)
    u = wa / (K @ v + 1e-300)
P = u[:, None] * K * v[None, :]
row = P.sum(1, keepdims=True)
T = (P @ pb) / np.maximum(row, 1e-300)  # where each source cell goes (barycentric map)
Tc = (P @ cb) / np.maximum(row, 1e-300)  # the colour it arrives with
print(f"cells {len(wa)}→{len(wb)}, sinkhorn {time.time()-t0:.1f}s, marginal err {abs(P.sum(0)-wb).sum():.4f}")
shift = np.linalg.norm((T - pa) * S, axis=1)
print(f"displacement px: median {np.median(shift):.0f}, p95 {np.percentile(shift,95):.0f}, max {shift.max():.0f}")

N = args.size
from scipy import ndimage

g = args.grid
# The plan, both ways: each source cell's arrival point (T), and each target cell's departure point (Tb).
col = P.sum(0)[:, None]
Tb = (P.T @ pa) / np.maximum(col, 1e-300)


def field(points, disp):
    """A dense displacement (in 0..1 units) on the 1024 stage, from the grid cells that have mass: the empty cells take
    their nearest neighbour's, then a light blur keeps it smooth."""
    D = np.zeros((g, g, 2))
    have = np.zeros((g, g), bool)
    ij = np.clip((points * g).astype(int), 0, g - 1)
    D[ij[:, 1], ij[:, 0]] = disp
    have[ij[:, 1], ij[:, 0]] = True
    _, (iy, ix) = ndimage.distance_transform_edt(~have, return_indices=True)
    D = D[iy, ix]
    D = np.stack([ndimage.gaussian_filter(D[..., k], 1.0) for k in range(2)], -1)
    zoom = S / g
    return np.stack([ndimage.zoom(D[..., k], zoom, order=1) for k in range(2)], -1)[:S, :S]


Da = field(pa, T - pa)  # where the source light goes
Db = field(pb, Tb - pb)  # where the target light comes from
ys, xs = np.mgrid[0:S, 0:S]
base = np.stack([(xs + 0.5) / S, (ys + 0.5) / S], -1)


def push(img, disp, amount):
    """Every pixel of `img` moved by amount*disp, splatted bilinearly onto the NxN pose (light is conserved)."""
    lit = img.max(2) > 1e-4
    pos = (base[lit] + amount * disp[lit]) * N - 0.5
    x0, y0 = np.floor(pos[:, 0]).astype(int), np.floor(pos[:, 1]).astype(int)
    fx, fy = pos[:, 0] - x0, pos[:, 1] - y0
    out = np.zeros((N + 2, N + 2, 3))
    c = img[lit] * (N / S) ** 2
    for dx, dy, w in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
        xx, yy = np.clip(x0 + dx + 1, 0, N + 1), np.clip(y0 + dy + 1, 0, N + 1)
        np.add.at(out, (yy, xx), c * w[:, None])
    out = out[1:-1, 1:-1]
    return np.stack([ndimage.gaussian_filter(out[..., k], 0.8) for k in range(3)], -1) if 0 < amount < 1 else out


frames = []
for i in range(args.poses):
    # Evenly spaced in the morph itself: the timing and the easing belong to the runtime.
    e = i / (args.poses - 1)
    # The two-sided morph: the source pushed forward and the target pulled back meet at the same shape; the blend goes
    # from one to the other. At e=0 it is the source exactly, at e=1 the target exactly.
    frame = np.clip((1 - e) * push(src, Da, e) + e * push(glow, Db, 1 - e), 0, 1)
    frames.append(frame)
    alpha = np.clip(frame.max(2), 0, 1)
    rgba = np.dstack([frame / np.maximum(alpha[..., None], 1e-6), alpha])
    Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), "RGBA").save(os.path.join(args.out, f"pose-{i:02d}.webp"), lossless=False, quality=88)
json.dump({"poses": args.poses, "tamanho": N, "palco": S, "origem": [0, 0], "espacamento": "e = i/(poses-1)",
           "rotacao": args.rotacao, "centro": [512, 430], "grade": args.grid, "eps": args.eps,
           "arquivos": [f"pose-{i:02d}.webp" for i in range(args.poses)],
           "deslocamento_px": {"mediana": round(float(np.median(shift))), "p95": round(float(np.percentile(shift, 95))),
                               "max": round(float(shift.max()))}},
          open(os.path.join(args.out, "aura.json"), "w"), indent=2, ensure_ascii=False)
strip = np.concatenate([f[::2, ::2] for f in frames[:: max(1, args.poses // 8)]], 1)
Image.fromarray((strip * 255).astype(np.uint8)).save(os.path.join(args.out, "tira.png"))
print(f"poses {args.poses} at {N}px in {time.time()-t0:.1f}s; strip {os.path.join(args.out,'tira.png')}")
