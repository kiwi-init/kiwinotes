#!/usr/bin/env python3
"""T3747: proposed keyframes from approved T3705 pixels, not runtime code.

Run with Pillow/numpy installed (gerada/requirements.txt).
Frames are deterministic stills of the roteiro, not captures of T3720.
"""
from pathlib import Path
import json
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = Path(__file__).resolve().parent
ASSETS = HERE / 'gerada'
OUT = HERE / 'quadros'
SIZE = 1024
CX, CY, R = 512, 430, 225
META = json.loads((ASSETS / 'manifest.json').read_text())
# Same chin ramp as T3720 camadas.ts (#3771, #3775): last row with
# max alpha > .1, then 60*k source pixels above it (k = source width/512).
_head_alpha = np.asarray(Image.open(ASSETS / 'cabeca-inteira.png').getchannel('A'))
_cut = int(np.flatnonzero(_head_alpha.max(axis=1) > 25.5)[-1])
CHIN_END = _cut*.4-82
CHIN_START = CHIN_END-60*(_head_alpha.shape[1]/512)*.4
FRAMES = [
    (0, 'A emenda', 'O prisma termina neste círculo de vidro.'),
    (48, 'A névoa nasce', 'A nuvem redonda começa a girar.'),
    (112, 'As orelhas brotam', 'A esquerda levanta; a direita vem depois.'),
    (150, 'As orelhas assentam', 'A cabeça toma a forma da referência.'),
    (176, 'Olhos sonolentos', 'Duas frestas brancas, nítidas e sem brilho.'),
    (220, 'Acordando aos poucos', 'Depois de fechar, os olhos abrem mais.'),
    (268, 'Olhos abertos', 'Os círculos chegam ao tamanho final.'),
    (336, 'O corpo se forma', 'A névoa desce e ganha densidade.'),
    (390, 'O aro acende', 'Ciano e púrpura surgem por dentro do topo.'),
    (480, 'Pronto', 'A v2 assenta; a janela pode dar lugar ao hub.'),
]


def ease(a, b, value):
    t = np.clip((value-a)/(b-a), 0, 1)
    return t*t*(3-2*t)


def stage_asset(name):
    image = Image.open(ASSETS / f'{name}.png').convert('RGBA')
    image = image.resize((819, 1024), Image.Resampling.LANCZOS)
    stage = Image.new('RGBA', (SIZE, SIZE))
    stage.alpha_composite(image, (102, -82))
    return stage


def opacity(image, value):
    image = image.copy()
    image.putalpha(image.getchannel('A').point(lambda p: round(p*float(np.clip(value, 0, 1)))))
    return image


def scale_at(image, sx, sy, pivot):
    px, py = pivot
    return image.transform((SIZE, SIZE), Image.Transform.AFFINE,
                           (1/sx, 0, px-px/sx, 0, 1/sy, py-py/sy),
                           Image.Resampling.BICUBIC)


def mask_y(image, start, end):
    alpha = np.asarray(image.getchannel('A'), dtype=np.float32)
    alpha *= (1-ease(start, end, np.arange(SIZE)))[:, None]
    image = image.copy()
    image.putalpha(Image.fromarray(np.uint8(np.rint(alpha))))
    return image


def dark_parts():
    # Use source density to isolate the actual dark silhouette. The final
    # source-over layers include compensating halo pixels which are only
    # valid when the whole stack exists; those must not become early outlines.
    array = np.array(stage_asset('kiwi-cat-candidata-v2'))
    for eye in META['eyes']:
        x, y, r = eye['cx']*.4+102, eye['cy']*.4-82, eye['r']*.4+3
        yy, xx = np.mgrid[:SIZE, :SIZE]
        array[np.hypot(xx-x, yy-y) < r, :3] = (11, 11, 14)
    rgb = array[:, :, :3].astype(np.float32)/255
    lum = rgb.mean(axis=2)
    # Coloured light lies on top of the solid head. Removing that light must
    # reveal black, not punch a transparent crescent through the forehead.
    chroma = rgb.max(axis=2)-rgb.min(axis=2)
    density = np.maximum(1-ease(.045, .14, lum), ease(.015, .06, chroma))
    polygons = {
        'cabeca': [(145,273),(195,222),(253,205),(317,225),(371,270),(383,327),(359,369),(319,408),(255,423),(187,388),(150,340)],
        'orelha-esquerda': [(128,160),(144,158),(263,209),(233,253),(153,302),(136,256)],
        'orelha-direita': [(246,210),(372,160),(390,167),(384,234),(362,303),(286,250)],
    }
    result = {}
    for name, points in polygons.items():
        mask = Image.new('L', (SIZE, SIZE))
        ImageDraw.Draw(mask).polygon([(x*1.6+102, y*1.6-82) for x,y in points], fill=255)
        mask = mask.filter(ImageFilter.GaussianBlur(6))
        out = array.copy()
        out[:, :, 3] = np.uint8(np.rint(np.asarray(mask)*density))
        out[:, :, :3] = np.uint8(np.minimum(rgb, .045)*255)
        result['dark-'+name] = Image.fromarray(out)
    return result


def head_halo(assets):
    silhouette = Image.new('RGBA', (SIZE, SIZE))
    for name in ['cabeca', 'orelha-esquerda', 'orelha-direita']:
        silhouette = Image.alpha_composite(silhouette, assets['dark-'+name])
    alpha = silhouette.getchannel('A').filter(ImageFilter.MaxFilter(41)).filter(ImageFilter.MinFilter(41))
    alpha = alpha.filter(ImageFilter.GaussianBlur(3))
    backing = Image.new('RGBA', (SIZE, SIZE), (9, 9, 12, 0))
    backing.putalpha(alpha)
    assets['dark-backdrop'] = mask_y(backing, CHIN_START, CHIN_END)
    near = np.asarray(alpha.filter(ImageFilter.GaussianBlur(32)), dtype=float)/255
    wide = np.asarray(alpha.filter(ImageFilter.GaussianBlur(70)), dtype=float)/255
    outside = 1-np.asarray(alpha, dtype=float)/255
    halo = Image.new('RGBA', (SIZE, SIZE), (145, 139, 167, 0))
    halo.putalpha(Image.fromarray(np.uint8(np.clip((near*.7+wide*.8)*outside*255, 0, 255))))
    return halo


def soft_glass():
    y, x = np.mgrid[:SIZE, :SIZE]
    distance = np.hypot(x-CX, y-CY)
    edge = 1-ease(R-6, R+8, distance)
    # A shaded dark disc, with one quiet broad reflection; no rim stroke.
    highlight = np.exp(-(((x-(CX-92))/105)**2+((y-(CY-100))/80)**2))
    rgb = np.stack([.020+.014*highlight, .024+.023*highlight,
                    .047+.045*highlight], axis=2)
    rgba = np.dstack([rgb, edge*.95])
    return Image.fromarray(np.uint8(np.clip(rgba*255, 0, 255)))


def fog_ring():
    y, x = np.mgrid[:SIZE, :SIZE]
    radius = np.hypot(x-CX, y-CY)
    theta = (np.arctan2(y-CY, x-CX)+math.pi)/(2*math.pi)
    # A single continuous torus, coloured with samples from the approved arc.
    arc = np.asarray(Image.open(ASSETS / 'kiwi-cat-candidata-v2.png').convert('RGB'))
    points = [(600, 1110), (720, 980), (875, 888), (1030, 852), (1140, 864)]
    palette = np.array([arc[py, px] for px, py in points] + [arc[points[0][1], points[0][0]]], dtype=float)/255
    z = theta*(len(palette)-1)
    lo = np.floor(z).astype(int)
    hi = np.minimum(lo+1, len(palette)-1)
    colour = palette[lo]*(1-(z-lo)[:, :, None])+palette[hi]*(z-lo)[:, :, None]
    colour = colour*.7 + np.array([.40, .38, .48])*.3
    density = np.exp(-.5*((radius-(R+14))/43)**2)*.60
    return Image.fromarray(np.uint8(np.clip(np.dstack([colour, density])*255, 0, 255)))


def ear_pose(frame, start):
    # The 30-frame rise, a small overshoot, then settling.
    if frame < start:
        return 75., .6, 0.
    t = (frame-start)/30
    angle = np.interp(t, [0, .65, .82, .94, 1], [75, 0, -8, 3, 0])
    return float(angle), float(.6+.4*ease(0, 1, t)), float(ease(0, .30, t))


def eye_open(frame):
    return float(np.interp(frame,
        [0, 159, 160, 163, 181, 196, 204, 212, 228, 234, 239, 244, 248, 262, 268, 480],
        [0, 0, 0, .06, .22, .22, .04, .04, .45, .45, .05, .45, .45, 1.04, 1, 1]))


def body_envelope(frame):
    formed = float(ease(300, 390, frame))
    front = 430+(SIZE-430)*formed
    return formed*(1-ease(front, front+80, np.arange(SIZE)))


def body_pose(frame, image):
    # #3799: reveal existing density; never scale, shear, rotate or translate
    # the approved body. The fog may appear gradually, its proportions do not.
    result = image.copy()
    alpha = np.asarray(image.getchannel('A'), dtype=np.float32)
    alpha *= body_envelope(frame)[:, None]
    result.putalpha(Image.fromarray(np.uint8(np.rint(alpha))))
    return result


def render(frame, assets, glass, ring, halo):
    stage = Image.new('RGBA', (SIZE, SIZE), 'black')
    formed = float(ease(300, 390, frame))
    head = float(ease(130, 190, frame))
    fog = float(ease(6, 48, frame))
    arc = float(ease(350, 400, frame))
    ring_fade = float(1-ease(150, 340, frame))
    spun = ring.rotate(-frame*.62, resample=Image.Resampling.BICUBIC, center=(CX, CY))
    stage = Image.alpha_composite(stage, opacity(spun, fog*ring_fade))
    stage = Image.alpha_composite(stage, opacity(halo, fog*head*(1-arc)))
    stage = Image.alpha_composite(stage, opacity(assets['luz'], arc))
    stage = Image.alpha_composite(stage, body_pose(frame, assets['corpo']))
    stage = Image.alpha_composite(stage, opacity(assets['dark-backdrop'], head*(1-arc)))

    # Ears rotate around their bases, behind the head/circle so the base is hidden.
    for name, start, sign in [('orelha-esquerda', 96, 1), ('orelha-direita', 112, -1)]:
        angle, scale, visible = ear_pose(frame, start)
        px, py = META['pivots'][name]
        pivot = (px*.4+102, py*.4-82)
        piece = Image.blend(assets['dark-'+name], assets[name], arc)
        piece = scale_at(piece, scale, scale, pivot)
        piece = piece.rotate(sign*angle, Image.Resampling.BICUBIC, center=pivot)
        stage = Image.alpha_composite(stage, opacity(piece, visible))
    stage = Image.alpha_composite(stage, opacity(glass, 1-head))
    # Before the body exists, soften the lower separation rather than exposing a cut.
    head_image = Image.blend(assets['dark-cabeca'], assets['cabeca'], arc)
    if formed < 1:
        faded = mask_y(head_image, CHIN_START, CHIN_END)
        head_image = Image.blend(faded, head_image, formed)
    stage = Image.alpha_composite(stage, opacity(head_image, head))
    stage = Image.alpha_composite(stage, opacity(assets['aro'], arc))

    eyes = Image.new('RGBA', (SIZE*2, SIZE*2))
    d = ImageDraw.Draw(eyes)
    open_y = eye_open(frame)
    growth = .8+.2*float(ease(248, 268, frame))
    for eye in META['eyes']:
        cx, cy, radius = eye['cx']*.4+102, eye['cy']*.4-82, eye['r']*.4*growth
        cy += (1-float(ease(248, 268, frame)))*8
        if open_y > 0:
            d.ellipse(((cx-radius)*2, (cy-radius*open_y)*2,
                       (cx+radius)*2, (cy+radius*open_y)*2), fill='white')
    stage = Image.alpha_composite(stage, eyes.resize((SIZE, SIZE), Image.Resampling.LANCZOS))
    clip = Image.new('L', (SIZE, SIZE))
    ImageDraw.Draw(clip).rounded_rectangle((0, 0, SIZE-1, SIZE-1), radius=224, fill=255)
    stage.putalpha(clip)
    return stage


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    assets = {n: stage_asset(n) for n in ['luz', 'corpo', 'cabeca', 'orelha-esquerda', 'orelha-direita', 'aro']}
    assets.update(dark_parts())
    glass, ring = soft_glass(), fog_ring()
    halo = head_halo(assets)
    board = Image.new('RGB', (2400, 1320), '#101014')
    draw = ImageDraw.Draw(board)
    font_file = '/System/Library/Fonts/Helvetica.ttc'
    title = ImageFont.truetype(font_file, 34)
    subtitle = ImageFont.truetype(font_file, 22)
    heading = ImageFont.truetype(font_file, 25)
    small = ImageFont.truetype(font_file, 19)
    draw.text((42, 25), 'Kiwi-cat · proposta quadro a quadro', font=title, fill='#eeeeef')
    draw.text((42, 72), 'T3747 · gato v2 aprovado · f0–f480 / 8 s a 60 fps · a emenda com o prisma acontece aos 3,7 s da intro',
              font=subtitle, fill='#a8a8b3')
    records = []
    for i, (frame, name, caption) in enumerate(FRAMES):
        image = render(frame, assets, glass, ring, halo)
        filename = f'{i+1:02d}-f{frame:03d}.png'
        image.save(OUT / filename, optimize=True)
        x, y = 42+(i%5)*468, 128+(i//5)*570
        tile = image.resize((444, 444), Image.Resampling.LANCZOS)
        board.paste(tile, (x, y), tile)
        draw.text((x, y+459), f'{i+1:02d}. {name}', font=heading, fill='#ededf1')
        time = f'f{frame} · gato {frame/60:.2f} s · intro {3.7+frame/60:.2f} s'.replace('.', ',')
        draw.text((x, y+495), time, font=small, fill='#bbbcc6')
        # The one-line captions fit the fixed 444px column; fail if text spills.
        capfont = ImageFont.truetype(font_file, 18)
        while draw.textlength(caption, font=capfont) > 444:
            capfont = ImageFont.truetype(font_file, capfont.size-1)
        draw.text((x, y+526), caption, font=capfont, fill='#9697a3')
        records.append({'frame': frame, 'cat_seconds': frame/60, 'intro_seconds': 3.7+frame/60,
                        'name': name, 'caption': caption, 'file': 'quadros/'+filename})
    draw.text((42, 1282), 'Mockup de poses para aprovação. As transições e os clips serão conferidos na animação da T3720. Sem cauda na v2.',
              font=small, fill='#91929c')
    board.save(HERE / 'prancha-intro.png', optimize=True)
    (HERE / 'quadros.json').write_text(json.dumps(records, ensure_ascii=False, indent=2)+'\n')
    # Check that the last pose really returns to the approved source, rather
    # than leaving any interim glass, circular fog, mask or colour correction.
    final = render(480, assets, glass, ring, halo)
    reference = Image.new('RGBA', (SIZE, SIZE), 'black')
    reference = Image.alpha_composite(reference, stage_asset('kiwi-cat-candidata-v2'))
    a = np.asarray(final.convert('RGB'), dtype=np.int16)
    b = np.asarray(reference.convert('RGB'), dtype=np.int16)
    yy, xx = np.mgrid[:SIZE, :SIZE]
    valid = np.asarray(final.getchannel('A')) == 255
    for eye in META['eyes']:
        valid &= np.hypot(xx-(eye['cx']*.4+102), yy-(eye['cy']*.4-82)) > eye['r']*.4+4
    diff = np.abs(a-b)[valid]
    report = {'last_frame_max_channel_error_outside_eyes': int(diff.max()),
              'last_frame_mean_channel_error_outside_eyes': float(diff.mean()),
              'last_frame_p99_channel_error_outside_eyes': float(np.percentile(diff, 99)),
              'frames': len(FRAMES), 'source_asset_commit': 'f06e567',
              'chin_stage_y': [CHIN_START, CHIN_END]}
    # Inspect the body envelope for every timeline frame, not only the ten
    # selected stills: it can only reveal pixels in place, never stretch them.
    envelopes = np.array([body_envelope(f) for f in range(481)])
    assert np.all((envelopes >= 0) & (envelopes <= 1))
    assert np.all(np.diff(envelopes, axis=0) >= -1e-8)
    assert not np.any(envelopes[:301])
    assert np.all(envelopes[390:] == 1)
    assert np.array_equal(np.asarray(body_pose(480, assets['corpo'])), np.asarray(assets['corpo']))
    source_body = np.asarray(assets['corpo'])
    for f, _, _ in FRAMES:
        posed = np.asarray(body_pose(f, assets['corpo']))
        assert np.array_equal(posed[:, :, :3], source_body[:, :, :3])
        assert np.all(posed[:, :, 3] <= source_body[:, :, 3])
    report['body_frames_checked'] = 481
    report['body_transform'] = 'identity; only monotonic alpha reveal in original pixel positions'
    (HERE / 'verificacao-prancha.json').write_text(json.dumps(report, indent=2)+'\n')
    assert report['last_frame_mean_channel_error_outside_eyes'] < 1, report
    assert len(list(OUT.glob('*.png'))) == len(FRAMES)
    print(f'{len(records)} quadros 1024×1024; prancha {board.width}×{board.height}')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
