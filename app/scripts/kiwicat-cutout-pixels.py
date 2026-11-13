#!/usr/bin/env python3
"""Verify real renderer PNGs from kiwicat-cutout-check.ts, not shader math."""
from pathlib import Path
import json,sys
import numpy as np
from PIL import Image
root=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/kiwi-T9708-pixels')
rows=[]
for backend in ['auto','webgl2','none']:
    for state in ['repouso','dormindo','acordou','ouvindo','thinking','agindo','pronto','erro']:
        def rgb(kind): return np.asarray(Image.open(root/f'{backend}-{state}-{kind}.png').convert('RGB'),dtype=np.int16)
        old=rgb('baseline'); opaque=rgb('opaque'); cutout=rgb('cutout')
        alpha=np.asarray(Image.open(root/f'{backend}-{state}-cutout-alpha.png').convert('RGBA'))[:,:,3]
        band=int(np.ceil(old.shape[1]*.08))
        delta=np.abs(old-cutout)
        outside=delta[:old.shape[0]-band,band:old.shape[1]-band]
        row=dict(backend=backend,state=state,opaqueMax=int(np.abs(old-opaque).max()),outsideMax=int(outside.max()),cornerAlpha=int(alpha[0,0]),coatAlpha=int(alpha[480,320]),brighteningMax=int((cutout-old).max()))
        assert row['opaqueMax']==0,row
        assert row['outsideMax']<=2,row
        assert row['cornerAlpha']==0 and row['coatAlpha']==255,row
        # One screenshot byte allows output rounding, not added emission.
        assert row['brighteningMax']<=1,row
        rows.append(row)
report=dict(band=.08,baseline='d2df9d3',scope='24 fixed-state real renderer cases, 640x800 DPR1 seed17; not performance',rows=rows)
(root/'pixels.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(cases=len(rows),opaqueMax=max(r['opaqueMax'] for r in rows),outsideMax=max(r['outsideMax'] for r in rows),passes=True)))
