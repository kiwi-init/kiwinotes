# Kiwi-cat master art (T10727): a sculpted render from code. Each mass (body, head, ears) is a height field built
# from its silhouette; one key light from the top-left shades it in light, half-tone, own shadow and occlusion.
# Coordinates are the v2 canvas (2048 x 2560); the eyes stay in code at (803,1279) and (1243,1279), r 68.
import json, math, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd

W0, H0 = 2048, 2560
EYES = [(802.823, 1279.323, 68.251), (1243.342, 1279.308, 67.94)]


def bez(p0, p1, p2, p3, n=48):
    t = np.linspace(0, 1, n)[:, None]
    return ((1 - t) ** 3) * p0 + 3 * ((1 - t) ** 2) * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3


def path_pts(segs):
    """segs: start point then cubic segments [(c1, c2, p)]; returns a closed polyline."""
    pts = [np.array(segs[0], float)]
    cur = np.array(segs[0], float)
    out = [cur[None]]
    for c1, c2, p in segs[1:]:
        b = bez(cur, np.array(c1, float), np.array(c2, float), np.array(p, float))
        out.append(b[1:])
        cur = np.array(p, float)
    return np.vstack(out)


def mirror(segs_left):
    """Mirror a left-half outline (top centre -> bottom centre) into a closed symmetric outline."""
    pts = path_pts(segs_left)
    right = pts[::-1].copy()
    right[:, 0] = 2 * 1024 - right[:, 0]
    return np.vstack([pts, right[1:]])


def raster(poly, s, ss=2):
    """Anti-aliased coverage of a polygon at scale s (supersampled ss x)."""
    w, h = int(W0 * s), int(H0 * s)
    im = Image.new("L", (w * ss, h * ss), 0)
    ImageDraw.Draw(im).polygon([(float(x) * s * ss, float(y) * s * ss) for x, y in poly], fill=255)
    im = im.resize((w, h), Image.LANCZOS) if ss > 1 else im
    return np.asarray(im, np.float32) / 255.0


def dome(mask, R, s, power=0.5):
    """Height from a blurred silhouette: a rounded rim about R wide (canvas units), smooth everywhere (no medial
    creases, which a distance transform leaves)."""
    b = nd.gaussian_filter(mask, R * 0.5 * s)
    return R * np.clip(b, 0, 1) ** power


def gauss(shape, cx, cy, r, s):
    h, w = shape
    y, x = np.mgrid[0:h, 0:w]
    return np.exp(-(((x / s - cx) ** 2 + (y / s - cy) ** 2) / (2 * r * r)))


def ellip(shape, cx, cy, rx, ry, s):
    h, w = shape
    y, x = np.mgrid[0:h, 0:w]
    q = 1 - ((x / s - cx) / rx) ** 2 - ((y / s - cy) / ry) ** 2
    # smoothed: a bare sqrt has an infinite slope at its rim, which shades as a seam on the sculpture
    return nd.gaussian_filter(np.sqrt(np.clip(q, 0, None)), 36 * s)


def shade(height, s, light):
    gy, gx = np.gradient(height * s)  # height in canvas units, pixels at scale s
    n = np.dstack([-gx, -gy, np.ones_like(height)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    L = np.array(light, float); L /= np.linalg.norm(L)
    return np.clip((n * L).sum(2), -1, 1), n


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def ramp(v, stops):
    """Piecewise-linear colour ramp; v in [0,1]; stops [(pos, (r,g,b))]."""
    pos = np.array([p for p, _ in stops]); cols = np.array([c for _, c in stops], float)
    out = np.empty(v.shape + (3,), np.float32)
    for k in range(3):
        out[..., k] = np.interp(v, pos, cols[:, k])
    return out


def shapes(P):
    """The silhouettes, from the candidate's parameters P."""
    hx, hy, hw, hh = P["head"]  # centre, half-width, half-height
    sq = P.get("head_sq", 2.6)  # superellipse exponent: rounder squarer head
    t = np.linspace(0, 2 * math.pi, 720)
    c, si = np.cos(t), np.sin(t)
    # cheeks: a little wider in the lower half
    cheek = 1 + P.get("cheek", 0.05) * np.clip(si, 0, 1) ** 1.5
    head = np.c_[hx + hw * cheek * np.sign(c) * np.abs(c) ** (2 / sq), hy + hh * np.sign(si) * np.abs(si) ** (2 / sq)]
    # body: a bell from the neck to a broad, soft base
    nw, ny, bw, by, br = P["body"]
    body = mirror([
        (1024, ny - 60),
        ((1024 - nw * 0.6, ny - 60), (1024 - nw, ny - 20), (1024 - nw, ny + 60)),
        ((1024 - nw, ny + 260), (1024 - bw + 30, by - 360), (1024 - bw, by - br)),
        ((1024 - bw - 6, by - br * 0.35), (1024 - bw + br * 0.45, by), (1024 - bw + br * 1.4, by)),
        ((1024 - 300, by + 6), (1024 - 120, by + 8), (1024, by + 8)),
    ])
    ears = []
    for side in (-1, 1):
        tip, outer, inner, rt = P["ear"]
        tx, ty = 1024 + side * (1024 - tip[0]), tip[1]
        ox, oy = 1024 + side * (1024 - outer[0]), outer[1]
        ix, iy = 1024 + side * (1024 - inner[0]), inner[1]
        # rounded tip: back the two sides off the tip and bridge with a curve
        def towards(ax, ay, bx, by, d):
            L = math.hypot(bx - ax, by - ay); return ax + (bx - ax) * d / L, ay + (by - ay) * d / L
        a = towards(tx, ty, ox, oy, rt); b = towards(tx, ty, ix, iy, rt)
        bow = P.get("ear_bow", 40)  # outward bulge of the ear sides
        mo = ((ox + a[0]) / 2 - side * bow * 0.9, (oy + a[1]) / 2 - bow * 0.15)
        mi = ((ix + b[0]) / 2 + side * bow * 0.2, (iy + b[1]) / 2 - bow * 0.7)
        ear = path_pts([
            (ox, oy),
            (mo, mo, a),
            ((tx, ty), (tx, ty), b),
            (mi, mi, (ix, iy)),
            (((ix + ox) / 2, (iy + oy) / 2 + 120), ((ix + ox) / 2, (iy + oy) / 2 + 120), (ox, oy)),
        ])
        # inner plane: the ear shrunk toward its centroid, lowered toward the base
        cxe, cye = ear[:, 0].mean(), ear[:, 1].mean() + 30
        k = P.get("ear_inner", 0.58)
        inner_poly = np.c_[cxe + (ear[:, 0] - cxe) * k, cye + (ear[:, 1] - cye) * k + 24]
        ears.append((ear, inner_poly))
    return head, body, ears


def arc_band(P, shape, s, head_mask):
    """The inlaid arc: a band that follows the skull, tapering to nothing at both ends, inside the head."""
    hx, hy, hw, hh = P["head"]
    a0, a1, inset, width, tilt = P["arc"]
    h, w = shape
    y, x = np.mgrid[0:h, 0:w]
    X, Y = x / s, y / s
    # rotate about the head centre by tilt, then measure an elliptical "radius" and angle
    ct, st = math.cos(math.radians(tilt)), math.sin(math.radians(tilt))
    dx, dy = X - hx, Y - (hy + P.get("arc_dy", 0))
    rx, ry = dx * ct + dy * st, -dx * st + dy * ct
    ang = np.degrees(np.arctan2(ry / (hh - inset), rx / (hw - inset)))  # -180..180, top is -90
    rad = np.sqrt((rx / (hw - inset)) ** 2 + (ry / (hh - inset)) ** 2)
    # position along the band 0..1 (a0 -> a1 going over the top)
    u = (ang - a0) / (a1 - a0)
    inside_u = (u >= 0) & (u <= 1)
    taper = np.sin(np.clip(u, 0, 1) * math.pi) ** P.get("arc_taper", 0.8)
    half = width / 2 / (hh - inset) * taper
    dist = np.abs(rad - 1)
    edge = 1.2 / s / (hh - inset)  # ~1 px anti-alias
    cov = np.clip((half - dist) / edge + 0.5, 0, 1) * inside_u
    # it stays inside the head: it fades out before the silhouette (never reaches the edge)
    inner = nd.gaussian_filter(head_mask, P.get("arc_keep", 34) * s)
    cov *= np.clip((inner - 0.93) / 0.05, 0, 1)
    # across the band: -1 outer edge .. +1 inner edge (for the groove shading)
    across = np.where(half > 0, (rad - 1) / np.maximum(half, 1e-6), 0)
    return cov, np.clip(u, 0, 1), across


PALETTES = {
    "dark": dict(
        coat=[(0.0, (6, 6, 9)), (0.32, (14, 14, 18)), (0.62, (30, 30, 36)), (0.86, (54, 54, 62)), (1.0, (74, 74, 84))],
        inner_ear=0.62, occ=(0, 0, 0), spec=(96, 96, 106), bg=(0, 0, 0)),
    "light": dict(
        coat=[(0.0, (122, 128, 142)), (0.32, (168, 173, 186)), (0.62, (212, 215, 223)), (0.86, (238, 239, 242)), (1.0, (250, 250, 250))],
        inner_ear=0.78, occ=(92, 98, 112), spec=(255, 255, 255), bg=(255, 255, 255)),
}
ARC = [(0.0, (88, 196, 214)), (0.5, (146, 120, 214)), (1.0, (214, 122, 172))]


def render(P, s, theme, layers_out=None):
    head_p, body_p, ears = shapes(P)
    head = raster(head_p, s); body = raster(body_p, s)
    ear_m = [raster(e, s) for e, _ in ears]; ear_in = [raster(i, s) for _, i in ears]
    shp = head.shape
    light = P.get("light", (-0.55, -0.75, 0.62))
    # heights: each mass a dome from its silhouette plus an overall bulge; the head sits in front of the body
    hb = dome(body, P.get("R_body", 420), s) + 0.45 * ellip(shp, 1024, body_p[:, 1].max() - 120, 620, 900, s) * 300
    hh_ = dome(head, P.get("R_head", 300), s) + ellip(shp, P["head"][0], P["head"][1] + P.get("bulge_dy", 40), P["head"][2] * 1.05, P["head"][3] * 1.1, s) * P.get("head_bulge", 220)
    # eye sockets: shallow, so the code's eyes sit in the sculpture
    for ex, ey, er in EYES:
        hh_ -= P.get("socket", 26) * gauss(shp, ex, ey + 6, er * 1.5, s)
    # muzzle: a soft bump between and below the eyes
    hh_ += P.get("muzzle", 18) * gauss(shp, 1024, 1400, 110, s)
    # cheeks: two soft masses below and outside the eyes (a cat face, not a snout)
    for side in (-1, 1):
        hh_ += P.get("cheeks", 0) * gauss(shp, 1024 + side * P.get("cheek_x", 250), P.get("cheek_y", 1420), P.get("cheek_r", 150), s)
    he = []
    for m, mi in zip(ear_m, ear_in):
        hE = dome(m, P.get("R_ear", 70), s) * 1.0
        hE -= P.get("ear_dish", 34) * nd.gaussian_filter(mi, 18 * s)  # the inner plane is recessed
        he.append(hE)
    lam_b, _ = shade(hb, s, light); lam_h, nh = shade(hh_, s, light)
    lam_e = [shade(x, s, light)[0] for x in he]

    def tone(lam, ao):
        # wrap diffuse, an ambient floor and the occlusion term, mapped through a soft S
        v = np.clip((lam + P.get("wrap", 0.25)) / (1 + P.get("wrap", 0.25)), 0, 1)
        v = P.get('floor', 0.12) + (1 - P.get('floor', 0.12)) * smoothstep(0.0, 1.0, v) ** P.get("gamma", 1.15)
        return np.clip(v * ao, 0, 1)

    # occlusion: where a mass in front meets the one behind (neck, ear bases), and under the body
    ao_body = 1 - P.get("ao_neck", 0.75) * nd.gaussian_filter(head, 34 * s) * (1 - head)
    ao_body *= 1 - 0.35 * smoothstep(0, 1, (np.mgrid[0:shp[0], 0:shp[1]][0] / s - (body_p[:, 1].max() - 260)) / 260)
    ao_ear = 1 - P.get("ao_ear", 0.8) * nd.gaussian_filter(head, 26 * s) * (1 - head)
    ao_head = 1 - 0.25 * (1 - nd.gaussian_filter(head, 40 * s))  # a little darker toward the rim
    for ex, ey, er in EYES:
        ao_head *= 1 - P.get("eye_ao", 0.32) * gauss(shp, ex, ey + 4, er * 1.35, s)

    pal = PALETTES[theme]
    v_body = tone(lam_b, ao_body); v_head = tone(lam_h, ao_head)
    if P.get("merge"):
        # One sculpted mass (head and body as v2: a single bell), the head a bulge on it with a soft chin crease.
        union = np.maximum(head, body)
        hu = dome(union, P.get("R_body", 420), s) + 0.45 * ellip(shp, 1024, body_p[:, 1].max() - 120, 620, 900, s) * 300
        hu += nd.gaussian_filter(head, P.get("blend", 40) * s) * (hh_ - dome(head, P.get("R_head", 300), s)) * P.get("head_lift", 1.0)
        for ex, ey, er in EYES:
            hu -= P.get("socket", 26) * gauss(shp, ex, ey + 6, er * 1.5, s)
        lam_u, _ = shade(hu, s, light); lam_h = lam_u
        crease = nd.gaussian_filter(head, P.get("crease_w", 16) * s) * (1 - nd.gaussian_filter(head, 4 * s))
        ao_u = (1 - P.get("ao_crease", 0.55) * crease * (1 - head))
        ao_u *= 1 - 0.35 * smoothstep(0, 1, (np.mgrid[0:shp[0], 0:shp[1]][0] / s - (body_p[:, 1].max() - 260)) / 260)
        ao_u *= 1 - 0.18 * (1 - nd.gaussian_filter(union, 40 * s))
        for ex, ey, er in EYES:
            ao_u *= 1 - P.get("eye_ao", 0.32) * gauss(shp, ex, ey + 4, er * 1.35, s)
        v_body = tone(lam_u, ao_u); v_head = v_body; body = union
    v_ears = []
    for lam, mi in zip(lam_e, ear_in):
        v = tone(lam, ao_ear)
        v = v * (1 - (1 - pal["inner_ear"]) * mi)  # the inner plane is a little darker
        v_ears.append(v)
    # composite back to front: ears, body, head
    alpha = np.zeros(shp, np.float32); val = np.zeros(shp, np.float32)
    def over(v, a):
        nonlocal alpha, val
        val = v * a + val * (1 - a); alpha = a + alpha * (1 - a)
    for v, m in zip(v_ears, ear_m): over(v, m)
    over(v_body, body)
    over(v_head, head)
    rgb = ramp(val, pal["coat"])
    # one small, soft highlight on the top of the head (matte: low and wide)
    sp = P.get("spec", 0.18) * gauss(shp, P["head"][0] - P["head"][2] * 0.35, P["head"][1] - P["head"][3] * 0.62, 70, s) * head
    rgb = rgb * (1 - sp[..., None]) + np.array(pal["spec"], np.float32) * sp[..., None]
    # the arc, inlaid: its colour along its length, lit by the head, with a thin groove at both edges
    cov, u, across = arc_band(P, shp, s, head)
    if P.get("arc_on", True):
        col = ramp(u, ARC)
        grey = col.mean(2, keepdims=True)
        col = grey + (col - grey) * P.get("arc_sat", 0.78)
        lit = np.clip((lam_h + 0.35) / 1.35, 0, 1)
        lit = P.get("arc_floor", 0.42) + (1 - P.get("arc_floor", 0.42)) * lit
        if theme == "light":
            lit = 0.62 + 0.38 * lit
        groove = 1 - P.get("groove", 0.35) * smoothstep(0.45, 1.0, np.abs(across))
        col = col * (lit * groove)[..., None]
        rgb = rgb * (1 - cov[..., None]) + col * cov[..., None]
    out = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)
    if layers_out is not None:
        layers_out.update(head=head, body=body, ears=ear_m, arc=cov)
    return Image.fromarray(out, "RGBA")


if __name__ == "__main__":
    P = json.load(open(sys.argv[1]))
    s = float(sys.argv[2]); theme = sys.argv[3]; out = sys.argv[4]
    render(P, s, theme).save(out)
