#!/usr/bin/env python3
"""T8487: offline, lossless reference + material protection from approved assets.
Needs Pillow/NumPy, like docs/brand/kiwi-cat/estados/montar.py. No network.
"""
from pathlib import Path
import importlib.util
import hashlib
import json
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
STATES=ROOT/'docs/brand/kiwi-cat/estados'
spec=importlib.util.spec_from_file_location('approved',STATES/'montar.py')
approved=importlib.util.module_from_spec(spec);spec.loader.exec_module(approved)
DEST=ROOT/'app/ui/kiwicat/assets';DEST.mkdir(exist_ok=True)
layers={name:Image.open(approved.ASSETS/f'{name}.png').convert('RGBA') for name in approved.NAMES}
reference=approved.compose(layers,approved.pose('reference'),scale=1)
reference.save(DEST/'reference.webp',format='WEBP',lossless=True,method=6)
mask=np.zeros((2560,2048),dtype=np.float32)
# Static foreground occlusion is separate from the exposure pedestal. It
# blocks procedural density/wisps, never freezes the exposure of layer edges.
foreground=np.zeros_like(mask)
for name in ['cabeca','corpo','orelha-esquerda','orelha-direita']:
    rgba=np.asarray(layers[name],dtype=np.float32)/255
    dark=np.clip((.24-rgba[:,:,:3].max(2))/.08,0,1);dark=dark*dark*(3-2*dark)
    foreground=np.maximum(foreground,dark*rgba[:,:,3])
# Source layers overlap behind the final light. Do not treat their hidden
# opaque texels as visible coat, or they stamp polygons into the fog.
observed=np.asarray(reference,dtype=np.float32)/255
visible=np.clip((.35-observed[:,:,:3].max(2))/.25,0,1)
foreground*=visible*visible*(3-2*visible)
y,x=np.mgrid[:2560,:2048]
for eye in approved.META['eyes']:
    distance=np.hypot(x-eye['cx'],y-eye['cy'])
    mask=np.maximum(mask,np.clip((eye['r']+9-distance)/4,0,1))
Image.fromarray(np.uint8(np.rint(np.stack([mask,foreground,np.zeros_like(mask)],axis=2)*255))).save(DEST/'material-mask.webp',format='WEBP',lossless=True,method=6)
metadata=dict(source='docs/brand/kiwi-cat/gerada/kiwi-cat-candidata-v2.png',layers={name:hashlib.sha256((approved.ASSETS/f'{name}.png').read_bytes()).hexdigest() for name in approved.NAMES},method='approved montar.py compose, neutral, scale1; unchanged circles; lossless WebP',sha256=hashlib.sha256((DEST/'reference.webp').read_bytes()).hexdigest(),material_mask='R: approved eye discs+5px; G: static foreground occlusion for procedural density/wisps only; continuous exposure pedestal',mask_sha256=hashlib.sha256((DEST/'material-mask.webp').read_bytes()).hexdigest())
(DEST/'source.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(approved.baseline_check(layers))
