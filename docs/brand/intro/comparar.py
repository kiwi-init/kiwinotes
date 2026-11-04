#!/usr/bin/env python3
"""Compare real normalized WebKit captures with the approved T3747 stills.
Only the outer viewport fit is normalized; animation state is not replaced.
"""
from pathlib import Path
import importlib.util
import json
import hashlib
import sys
sys.dont_write_bytecode = True
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
OUT = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('reference', HERE/'../kiwi-cat/prancha.py')
ref = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ref)
assets = {n:ref.stage_asset(n) for n in ['luz','corpo','cabeca','orelha-esquerda','orelha-direita','aro']}
assets.update(ref.dark_parts())
glass, ring = ref.soft_glass(), ref.fog_ring()
halo = ref.head_halo(assets)
frames = [0,48,112,126,150,176,190,220,268,336,390,480]
board = Image.new('RGB', (6*344,4*390), '#101014')
draw = ImageDraw.Draw(board)
font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 18)
records=[]
for i,f in enumerate(frames):
    reference=ref.render(f,assets,glass,ring,halo)
    reference.save(OUT/f'referencia-f{f}.png')
    background=Image.new('RGBA',reference.size,'#101014')
    expected=Image.alpha_composite(background,reference).convert('RGB')
    actual=Image.open(OUT/f'f{f}.png').convert('RGB')
    a=np.asarray(actual,dtype=np.int16)
    b=np.asarray(expected,dtype=np.int16)
    error=np.abs(a-b)
    # Exclude only the platform's rounded-stage antialiasing; eyes/ears stay in.
    valid=np.asarray(reference.getchannel('A'))==255
    region=error[valid]
    records.append({'frame':f,'mean_channel_error':float(region.mean()),'p99_channel_error':float(np.percentile(region,99)),
                    'max_channel_error':int(region.max()),'pixels_over_16_percent':float((region.max(axis=1)>16).mean()*100)})
    for j,(image,label) in enumerate([(expected,'Prancha'),(actual,'WebKit')]):
        x=((i%3)*2+j)*344+8
        y=(i//3)*390+8
        board.paste(image.resize((328,328),Image.Resampling.LANCZOS),(x,y))
        draw.text((x,y+338),f'f{f} · {label}',font=font,fill='#ededf1')
    heat=Image.fromarray(np.uint8(np.clip(error*4,0,255)))
    heat.save(OUT/f'diferenca-f{f}.png')
board.save(OUT/'comparacao.png')
report={'runtime_sha256':hashlib.sha256((HERE/'intro.html').read_bytes()).hexdigest(),
        'reference_sha256':hashlib.sha256((HERE/'../kiwi-cat/prancha.py').read_bytes()).hexdigest(),
        'stage':[1024,1024], 'frames':records}
(OUT/'comparacao.json').write_text(json.dumps(report,indent=2)+'\n')
assert all(r['mean_channel_error']<1 and r['p99_channel_error']<=8 and r['pixels_over_16_percent']<.1 for r in records), records
print(json.dumps(records,indent=2))
