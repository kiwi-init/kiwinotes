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
        oldFog=rgb('baseline-fog'); newFog=rgb('cutout-fog')
        vectorDiff=np.abs(rgb('baseline-vectors')-rgb('cutout-vectors'))
        alpha=np.asarray(Image.open(root/f'{backend}-{state}-cutout-alpha.png').convert('RGBA'))[:,:,3]
        band=int(np.ceil(old.shape[1]*.08))
        delta=np.abs(old-cutout)
        outsideMask=np.zeros(old.shape[:2],dtype=bool)
        outsideMask[:old.shape[0]-band,band:old.shape[1]-band]=True
        source=Path(__file__).resolve().parents[1]/'ui/kiwicat/assets/material-mask.webp'
        material=np.asarray(Image.open(source).convert('RGB').resize((640,800),Image.Resampling.BILINEAR),dtype=np.float32)/255
        coatSource=Path(__file__).resolve().parents[1]/'ui/kiwicat/assets/cutout-mask.webp'
        coat=np.asarray(Image.open(coatSource).convert('RGB').resize((640,800),Image.Resampling.BILINEAR),dtype=np.float32)[:,:,0]/255
        strong=(oldFog.max(2)>=32) | (np.maximum(np.maximum(material[:,:,1],material[:,:,2]),coat)>=.3)
        outside=np.abs(oldFog-newFog)[outsideMask & strong]
        row=dict(backend=backend,state=state,opaqueMax=int(np.abs(old-opaque).max()),stableMax=int(outside.max()),vectorMax=int(vectorDiff.max()),compositeMax=int(delta.max()),cornerAlpha=int(alpha[0,0]),coatAlpha=int(alpha[480,320]),brighteningMax=int((cutout-old).max()))
        assert row['opaqueMax']==0,row
        assert row['stableMax']<=2,row
        assert row['vectorMax']==0,row
        assert row['cornerAlpha']==0 and row['coatAlpha']==255,row
        # One screenshot byte allows output rounding, not added emission.
        assert row['brighteningMax']<=1,row
        rows.append(row)
report=dict(band=.08,baseline='d2df9d3',weakLow=16,weakHigh=32,scope='24 fixed-state real renderer cases, 640x800 DPR1 seed17; FOG-only strong>=32 plus coat/arc outside8pct; vectors compared separately; composite changes also reported; not performance',rows=rows)
(root/'pixels.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(cases=len(rows),opaqueMax=max(r['opaqueMax'] for r in rows),outsideMax=max(r['stableMax'] for r in rows),passes=True)))
