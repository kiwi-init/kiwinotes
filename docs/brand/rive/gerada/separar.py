#!/usr/bin/env python3
"""T3705: split approved pixels; no model, network or app runtime dependency.

Usage: python3 separar.py   (Pillow + numpy)
Masks specify ownership/overlap, never redraw the visible silhouette. Behind
the opaque cat, normalized convolution estimates the otherwise hidden light.
Foreground RGB is solved against that light, then divided into source-over
layers. Quantized PNGs are recomposed and checked against the approved source.
"""
from pathlib import Path
import json
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'kiwi-cat-candidata-v2.png'
W, H = 2048, 2560
ORDER = ['luz', 'corpo-nevoa', 'cabeca', 'orelha-esquerda', 'orelha-direita', 'aro']


def smooth(a, b, value):
    t = np.clip((value - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def polygon(points, blur=0, grow=0):
    img = Image.new('L', (512, 640))
    ImageDraw.Draw(img).polygon(points, fill=255)
    if grow:
        img = img.filter(ImageFilter.MaxFilter(grow * 2 + 1))
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(img.resize((W, H), Image.Resampling.BILINEAR), dtype=np.float32) / 255


def rgba(rgb, alpha):
    result = np.empty((H, W, 4), dtype=np.uint8)
    result[:, :, :3] = np.rint(np.clip(rgb, 0, 1) * 255).astype(np.uint8)
    result[:, :, 3] = np.rint(np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    result[result[:, :, 3] == 0, :3] = 0
    return Image.fromarray(result)


def main():
    source = Image.open(SOURCE).convert('RGB')
    assert source.size == (W, H)
    original = np.asarray(source, dtype=np.float32) / 255
    clean = original.copy()
    yy, xx = np.mgrid[:H, :W]
    eyes, eye_exclusion = [], np.zeros((H, W), dtype=bool)
    for lo, hi in [(0.34, 0.45), (0.55, 0.66)]:
        region = (xx > lo * W) & (xx < hi * W) & (yy > .45 * H) & (yy < .55 * H)
        white = (original.min(axis=2) > .5) & region
        cy, cx = np.nonzero(white)
        x, y = float(cx.mean()), float(cy.mean())
        radius = math.sqrt(len(cx) / math.pi)
        distance = np.hypot(xx - x, yy - y)
        patch = distance <= radius + 5
        annulus = (distance > radius + 7) & (distance < radius + 15)
        clean[patch] = np.median(original[annulus], axis=0)
        eye_exclusion |= patch
        eyes.append({'cx': round(x, 3), 'cy': round(y, 3), 'r': round(radius, 3)})

    # Peel chromatic light off the source, leaving a neutral underpainting.
    # C = alpha * colour + (1-alpha) * neutral (sRGB source-over).
    low = clean.min(axis=2)
    high = clean.max(axis=2)
    arc_area = (smooth(.17*W, .22*W, xx) * (1-smooth(.80*W, .86*W, xx)) *
                smooth(.22*H, .27*H, yy) * (1-smooth(.58*H, .64*H, yy)))
    # Keep the hidden head beneath the coloured arc dark, rather than leaving
    # a grey copy of the arc in the head when the light is switched off.
    colour_strength = smooth(.005, .03, high - low) * arc_area
    under_arc = low * (1-colour_strength) + np.minimum(low, .045) * colour_strength
    chroma_full = np.clip((high - under_arc) / np.maximum(1 - under_arc, 1e-6), 0, 1)
    colour = np.divide(clean - (1 - chroma_full[:, :, None]) * under_arc[:, :, None],
                       chroma_full[:, :, None], out=np.zeros_like(clean),
                       where=chroma_full[:, :, None] > 1e-7)
    chroma = chroma_full * arc_area
    neutral = np.divide(clean - chroma[:, :, None] * colour,
                        1 - chroma[:, :, None], out=clean.copy(),
                        where=(1 - chroma[:, :, None]) > 1e-7)

    left = [(132, 164), (142, 162), (258, 209), (232, 246), (154, 299), (141, 255)]
    right = [(249, 210), (371, 164), (386, 169), (380, 233), (361, 299), (289, 246)]
    head = [(145, 273), (195, 222), (253, 205), (317, 225), (371, 270),
            (383, 327), (359, 369), (319, 408), (255, 423), (187, 388), (150, 340)]
    body = [(156, 313), (360, 313), (379, 365), (419, 431), (403, 487),
            (352, 525), (249, 546), (148, 523), (104, 480), (115, 427), (142, 365)]
    coverage = np.maximum.reduce([polygon(p, blur=12, grow=18)
                                   for p in [left, right, head, body]])

    # Reconstruct only the hidden light. The observed pixels outside the cat
    # remain source pixels. Work at reference size for a broad, smooth field.
    small = np.asarray(Image.fromarray(np.uint8(np.clip(neutral, 0, 1) * 255))
                       .resize((512, 640), Image.Resampling.LANCZOS), dtype=np.float32) / 255
    mask_small = np.asarray(Image.fromarray(np.uint8(coverage * 255))
                            .resize((512, 640)), dtype=np.float32) / 255
    known = 1 - mask_small
    # Pillow BoxBlur does not accept F images on all versions; use separable
    # cumulative sums, in float, to keep the hidden-field solve deterministic.
    def box(a, r):
        for axis in (0, 1):
            pads = [(0, 0)] * a.ndim
            pads[axis] = (r, r)
            padded = np.pad(a, pads, mode='edge')
            padded = np.concatenate([np.zeros_like(np.take(padded, [0], axis=axis)), padded], axis=axis)
            sums = np.cumsum(padded, axis=axis, dtype=np.float64)
            first = [slice(None)] * a.ndim
            last = [slice(None)] * a.ndim
            first[axis] = slice(2 * r + 1, None)
            last[axis] = slice(None, -(2 * r + 1))
            a = ((sums[tuple(first)] - sums[tuple(last)]) / (2 * r + 1)).astype(np.float32)
        return a
    weights = known.copy()
    field = small * known[:, :, None]
    for _ in range(3):
        weights = box(weights, 60)
        field = box(field, 60)
    fill = field / np.maximum(weights[:, :, None], 1e-7)
    fill = np.asarray(Image.fromarray(np.uint8(np.clip(fill, 0, 1) * 255))
                      .resize((W, H), Image.Resampling.BICUBIC), dtype=np.float32) / 255
    background = neutral * (1 - coverage[:, :, None]) + fill * coverage[:, :, None]
    # Minimal opacity needed for a physically representable foreground colour.
    lower = np.max(np.maximum((background - neutral) / np.maximum(background, 1e-6),
                              (neutral - background) / np.maximum(1 - background, 1e-6)), axis=2)
    opacity = np.clip(np.maximum(coverage, lower), 0, 1)
    foreground = np.divide(neutral - (1 - opacity[:, :, None]) * background,
                           opacity[:, :, None], out=np.zeros_like(neutral),
                           where=opacity[:, :, None] > 1e-7)

    # Partition premultiplied foreground contributions, then convert those
    # contributions to ordinary source-over alpha from front to back.
    # Broad ownership masks include the observed soft ear edge, not just its
    # dark core. Otherwise a ghost outline would stay in the head layer.
    base_curve = 215 * 4 + 43 * 4 * ((xx - W/2) / (110*4)) ** 2
    ear_share = 1 - smooth(base_curve - 12*4, base_curve + 22*4, yy)
    ear_l = ear_share * (xx < W / 2)
    ear_r = ear_share * (xx >= W / 2)
    rest = 1 - ear_l - ear_r
    body_share = smooth(346 * 4, 403 * 4, yy)
    shares = {'orelha-esquerda': ear_l, 'orelha-direita': ear_r,
              'cabeca': rest * (1 - body_share), 'corpo-nevoa': rest * body_share}
    remaining = np.ones((H, W), dtype=np.float32)
    layers = {}
    for name in ['orelha-esquerda', 'orelha-direita', 'cabeca', 'corpo-nevoa']:
        contribution = opacity * shares[name]
        alpha = np.divide(contribution, remaining, out=np.zeros_like(opacity), where=remaining > 1e-7)
        layers[name] = rgba(foreground, alpha)
        remaining = np.maximum(remaining - contribution, 0)
    # Add overlap only in pixels COMPLETELY occluded by opaque layers above.
    # These hidden pixels are not observable in the source; the visible stack
    # is unaffected, and movement does not expose triangular/flat cut holes.
    head_rgba = np.array(layers['cabeca'])
    opaque_ear = np.maximum(np.asarray(layers['orelha-esquerda'])[:, :, 3],
                            np.asarray(layers['orelha-direita'])[:, :, 3]) == 255
    extra = np.uint8(np.rint(polygon(head, blur=5, grow=3) * 255))
    head_rgba[:, :, 3] = np.maximum(head_rgba[:, :, 3], np.where(opaque_ear, extra, 0))
    head_rgba[:, :, :3] = np.uint8(np.rint(np.clip(foreground, 0, 1) * 255))
    head_rgba[head_rgba[:, :, 3] == 0, :3] = 0
    layers['cabeca'] = Image.fromarray(head_rgba)
    body_rgba = np.array(layers['corpo-nevoa'])
    opaque_head = np.asarray(layers['cabeca'])[:, :, 3] == 255
    extra = np.uint8(np.rint(polygon(body, blur=12) * 255))
    body_rgba[:, :, 3] = np.maximum(body_rgba[:, :, 3], np.where(opaque_head, extra, 0))
    body_rgba[:, :, :3] = np.uint8(np.rint(np.clip(foreground, 0, 1) * 255))
    body_rgba[body_rgba[:, :, 3] == 0, :3] = 0
    layers['corpo-nevoa'] = Image.fromarray(body_rgba)
    light_alpha = background.max(axis=2)
    light_colour = np.divide(background, light_alpha[:, :, None],
                              out=np.zeros_like(background), where=light_alpha[:, :, None] > 1e-7)
    layers['luz'] = rgba(light_colour, light_alpha)
    layers['aro'] = rgba(colour, chroma)
    for name, img in layers.items():
        assert img.mode == 'RGBA' and img.size == (W, H)
        assert img.getchannel('A').getextrema()[0] == 0
        img.save(ROOT / f'{name}.png', optimize=True)
    entire_head = Image.new('RGBA', (W, H))
    for name in ['cabeca', 'orelha-esquerda', 'orelha-direita', 'aro']:
        entire_head = Image.alpha_composite(entire_head, layers[name])
    entire_head.save(ROOT / 'cabeca-inteira.png', optimize=True)
    layers['corpo-nevoa'].save(ROOT / 'corpo.png', optimize=True)

    # Exact circle geometry is also shipped as SVG; raster here is QA only.
    vector = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2560">']
    eye_img = Image.new('L', (W * 2, H * 2))
    draw = ImageDraw.Draw(eye_img)
    for eye in eyes:
        x, y, r = (eye[k] for k in ['cx', 'cy', 'r'])
        vector.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#fff"/>')
        draw.ellipse(((x-r)*2, (y-r)*2, (x+r)*2, (y+r)*2), fill=255)
    vector.append('</svg>')
    (ROOT / 'olhos.svg').write_text('\n'.join(vector) + '\n')
    eye_alpha = eye_img.resize((W, H), Image.Resampling.LANCZOS)
    white_eyes = Image.new('RGBA', (W, H), 'white')
    white_eyes.putalpha(eye_alpha)
    composite = Image.new('RGBA', (W, H), 'black')
    for name in ORDER:
        composite = Image.alpha_composite(composite, layers[name])
    composite = Image.alpha_composite(composite, white_eyes)
    composite.convert('RGB').save(ROOT / 'recomposta.png', optimize=True)
    error = np.abs(np.asarray(composite.convert('RGB'), dtype=np.int16) - np.asarray(source, dtype=np.int16))
    outside = error[~eye_exclusion]
    three = Image.new('RGBA', (W, H), 'black')
    for image in [layers['luz'], layers['corpo-nevoa'], entire_head, white_eyes]:
        three = Image.alpha_composite(three, image)
    three_error = np.abs(np.asarray(three.convert('RGB'), dtype=np.int16) - np.asarray(source, dtype=np.int16))[~eye_exclusion]
    report = {'max_channel_error_outside_eyes': int(outside.max()),
              'mean_channel_error_outside_eyes': float(outside.mean()),
              'mean_channel_error_all': float(error.mean()),
              'p99_channel_error_outside_eyes': float(np.percentile(outside, 99)),
              'max_channel_error_three_layers_outside_eyes': int(three_error.max()),
              'mean_channel_error_three_layers_outside_eyes': float(three_error.mean()),
              'eye_excluded_pixels': int(eye_exclusion.sum())}
    (ROOT / 'verificacao.json').write_text(json.dumps(report, indent=2) + '\n')
    assert report['max_channel_error_outside_eyes'] <= 4, report
    assert report['mean_channel_error_outside_eyes'] < .5, report
    assert report['max_channel_error_three_layers_outside_eyes'] <= 4, report
    manifest = {'task': 'T3705', 'approval': '#3732', 'canvas': {'width': W, 'height': H},
                'source': SOURCE.name, 'blend': 'source-over', 'opacity': 1, 'x': 0, 'y': 0,
                'order_back_to_front': [f'{n}.png' for n in ORDER] + ['olhos.svg'],
                'eyes': eyes,
                'pivots': {'orelha-esquerda': [740, 1040], 'orelha-direita': [1312, 1040],
                           'cabeca': [1024, 1280], 'corpo-nevoa': [1024, 1992], 'aro': [1024, 1280]},
                'hidden_pixels': 'light inpaint and eye removal are estimates; visible pixels reconstruct approved source',
                'resolution': 'generated 1122x1402, normalized to 2048x2560; not native 2K'}
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    consumer = {'espaco': {'w': W, 'h': H}, 'olhos': [{'x': e['cx'], 'y': e['cy'], 'r': e['r']} for e in eyes],
                'orelhaEsquerda': [[x*4, y*4] for x, y in left],
                'orelhaDireita': [[x*4, y*4] for x, y in right],
                'sobra': 40*4, 'origem': [0, 0], 'alfa': 'reto',
                'ordem': ['luz.png', 'corpo.png', 'cabeca-inteira.png', 'olhos.svg'],
                'pivos': {'earLeft': [740, 1040], 'earRight': [1312, 1040]},
                'encaixe': {'escala': .4, 'dx': 102.4, 'dy': -98}}
    (ROOT / 'camadas.json').write_text(json.dumps(consumer, indent=2, ensure_ascii=False) + '\n')

    font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 16)
    comparison = Image.new('RGB', (1024, 676), 'black')
    d = ImageDraw.Draw(comparison)
    for i, (title, img) in enumerate([('V2 APROVADA', source), ('RECOMPOSTA + OLHOS VETORIAIS', composite)]):
        comparison.paste(img.convert('RGB').resize((512, 640), Image.Resampling.LANCZOS), (512 * i, 36))
        d.text((512*i+12, 9), title, fill='white', font=font)
    comparison.save(ROOT / 'comparacao-camadas.png')
    sheet = Image.new('RGB', (768, 704), '#777777')
    d = ImageDraw.Draw(sheet)
    for i, name in enumerate(ORDER):
        x, y = (i % 3) * 256, (i // 3) * 352
        preview = layers[name].resize((256, 320), Image.Resampling.LANCZOS)
        sheet.paste(preview, (x, y+28), preview)
        d.text((x+8, y+6), name, fill='white', font=font)
    sheet.save(ROOT / 'camadas.png')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
