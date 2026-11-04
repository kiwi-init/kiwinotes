#!/usr/bin/env python3
"""Bake the approved storyboard's layers; only preparation, never app runtime.

The live DOM animates these bitmaps and vector eyes. Reuse the approved
prancha.py primitives rather than infer a different silhouette from the photo.
"""
from pathlib import Path
import importlib.util
import json
import sys
sys.dont_write_bytecode = True
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('kiwi_prancha', HERE / 'prancha.py')
reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)
OUT = HERE / 'camadas'
SIZE = reference.SIZE


def rgba(rgb, alpha):
    array = np.uint8(np.rint(np.clip(np.dstack([rgb, alpha]), 0, 1)*255))
    array[array[:, :, 3] == 0, :3] = 0
    return Image.fromarray(array)


def main():
    OUT.mkdir(exist_ok=True)
    raw = {name: reference.stage_asset(name) for name in
           ['luz', 'corpo', 'cabeca', 'orelha-esquerda', 'orelha-direita', 'aro']}
    dark = reference.dark_parts()
    halo = reference.head_halo(dark)  # also prepares the soft backing mask
    head = dark['dark-cabeca']
    head_base = reference.mask_y(head, reference.CHIN_START, reference.CHIN_END)
    hd = np.asarray(head, dtype=np.float32)/255
    base_alpha = np.asarray(head_base.getchannel('A'), dtype=np.float32)/255
    # base over (complement * formed) = head * (chin + (1-chin)*formed).
    lift_alpha = np.divide(hd[:, :, 3]-base_alpha, 1-base_alpha,
                           out=np.zeros_like(base_alpha), where=(1-base_alpha) > 1e-6)
    images = {
        'luz-anel': reference.fog_ring(), 'luz-cabeca': halo,
        'vidro': reference.soft_glass(), 'fundo-cabeca': dark['dark-backdrop'],
        'cabeca': head_base, 'cabeca-complemento': rgba(hd[:, :, :3], lift_alpha),
        'orelha-esquerda': dark['dark-orelha-esquerda'],
        'orelha-direita': dark['dark-orelha-direita'], 'corpo': raw['corpo'],
    }

    # The final scene is isolated on black. Pack its static head/light into a
    # single RGB image, so the compensating light in the original six layers
    # never appears as a rectangle while the arc fades in.
    full_head = Image.new('RGBA', (SIZE, SIZE))
    for name in ['cabeca', 'orelha-esquerda', 'orelha-direita', 'aro']:
        full_head = Image.alpha_composite(full_head, raw[name])
    light = np.asarray(raw['luz'], dtype=np.float32)/255
    body = np.asarray(raw['corpo'], dtype=np.float32)/255
    whole = np.asarray(full_head, dtype=np.float32)/255
    lp = light[:, :, :3]*light[:, :, 3:4]
    target = whole[:, :, :3]*whole[:, :, 3:4]+(1-whole[:, :, 3:4])*(
        body[:, :, :3]*body[:, :, 3:4]+(1-body[:, :, 3:4])*lp)
    soft_head = reference.mask_y(full_head, reference.CHIN_START, reference.CHIN_END)
    soft = np.asarray(soft_head, dtype=np.float32)/255
    static = soft[:, :, :3]*soft[:, :, 3:4]+(1-soft[:, :, 3:4])*lp
    minimum = np.max(np.maximum((static-target)/np.maximum(static, 1e-6),
                                (target-static)/np.maximum(1-static, 1e-6)), axis=2)
    body_alpha = np.clip(np.maximum(body[:, :, 3], minimum), 0, 1)
    body_rgb = np.divide(target-(1-body_alpha[:, :, None])*static, body_alpha[:, :, None],
                          out=np.zeros_like(target), where=body_alpha[:, :, None] > 1e-6)
    images['final-fundo'] = Image.fromarray(np.uint8(np.rint(np.clip(static, 0, 1)*255)))
    images['final-corpo'] = rgba(body_rgb, body_alpha)
    # Static, pre-baked mask; runtime only changes its position, never a blur.
    y = np.arange(2048)
    alpha = 1-reference.ease(1024, 1104, y)
    mask = np.full((2048, 1, 4), 255, dtype=np.uint8)
    mask[:, 0, 3] = np.uint8(np.rint(alpha*255))
    Image.fromarray(mask).save(OUT / 'mascara-revela.png')

    total = 0
    boxes = {}
    for name, image in images.items():
        file = OUT / f'{name}.webp'
        box = image.getbbox() or (0, 0, 1, 1)
        boxes[name] = list(box)
        image.crop(box).save(file, 'WEBP', lossless=True, quality=100, method=4)
        total += file.stat().st_size
    eyes = [{'x': eye['cx']*.4+102, 'y': eye['cy']*.4-82, 'r': eye['r']*.4}
            for eye in reference.META['eyes']]
    pivots = {name: [x*.4+102, y*.4-82]
              for name, (x, y) in reference.META['pivots'].items() if name.startswith('orelha-')}
    metadata = {'espaco': {'w': SIZE, 'h': SIZE}, 'olhos': eyes, 'pivos': pivots,
                'camadas': list(images), 'recortes': boxes, 'mascara': 'mascara-revela.png',
                'referencia': 'T3747 / prancha.py; source assets from T3705',
                'queixo': [reference.CHIN_START, reference.CHIN_END]}
    (OUT / 'camadas.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2)+'\n')
    # Verify the encoded final scene too (not just the float arithmetic).
    encoded = Image.new('RGBA', (SIZE, SIZE), 'black')
    for name in ['final-fundo', 'final-corpo']:
        encoded.alpha_composite(Image.open(OUT/f'{name}.webp').convert('RGBA'), tuple(boxes[name][:2]))
    error = np.abs(np.asarray(encoded.convert('RGB'), dtype=np.int16)-np.rint(target*255).astype(np.int16))
    report = {'final_max_channel_error': int(error.max()), 'final_mean_channel_error': float(error.mean()),
              'texture_pixels': sum((b[2]-b[0])*(b[3]-b[1]) for b in boxes.values()), 'bytes': total, 'layers': len(images), 'size': [SIZE, SIZE]}
    assert report['final_max_channel_error'] <= 2, report
    (OUT/'verificacao.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
