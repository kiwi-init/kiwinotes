#!/usr/bin/env python3
"""T9708: coverage from approved source layers, not brightness alone.
Only generates new cutout files; opaque approved textures remain untouched.
"""
from pathlib import Path
import json, hashlib
import numpy as np
from PIL import Image, ImageFilter
ROOT=Path(__file__).resolve().parents[2]
SRC=ROOT/'docs/brand/kiwi-cat/gerada'; DEST=ROOT/'app/ui/kiwicat/assets'
coat=np.zeros((2560,2048),np.float32)
hashes={}
for name in ['cabeca','corpo','orelha-esquerda','orelha-direita','aro']:
    file=SRC/(name+'.png'); rgba=np.asarray(Image.open(file).convert('RGBA'),np.float32)/255
    coat=1-(1-coat)*(1-rgba[:,:,3]); hashes[name]=hashlib.sha256(file.read_bytes()).hexdigest()
# Source-over coverage with tiny residual alpha removed; preserve the opaque dark coat.
observed=np.asarray(Image.open(DEST/'reference-no-eyes.webp').convert('RGB'),np.float32).max(2)/255
observed=np.asarray(Image.fromarray(observed).resize((512,640),Image.Resampling.BOX).resize((2048,2560),Image.Resampling.BILINEAR),np.float32)
v=np.clip((observed-.08)/(.20-.08),0,1)
# The layer alpha contains luminous feather outside the coat. Keep geometric
# coverage only where the observed material is dark, not that luminous fringe.
coat=coat*(1-v*v*(3-2*v))
coat=np.asarray(Image.fromarray(np.uint8(np.rint(coat*255))).filter(ImageFilter.GaussianBlur(10)),np.float32)/255
v=np.clip((coat-.003)/(.025-.003),0,1)
coat=coat*v*v*(3-2*v)
coat=np.where(coat>.98,1,coat)
light=np.asarray(Image.open(DEST/'reference-no-eyes.webp').convert('RGB'),np.float32).max(2)
light=np.asarray(Image.fromarray(light).resize((640,800),Image.Resampling.BILINEAR),np.float32)/255
# Three separable float box passes approximate a soft field without quantizing
# weak light before sqrt (byte-space blur produced visible opacity terraces).
def box(a,axis,r=10):
    pad=[(0,0),(0,0)]; pad[axis]=(r,r)
    p=np.pad(a,pad,mode='reflect'); c=np.cumsum(p,axis=axis,dtype=np.float64)
    shape=list(c.shape); shape[axis]=1
    c=np.concatenate([np.zeros(shape),c],axis=axis)
    hi=[slice(None),slice(None)]; lo=hi.copy(); hi[axis]=slice(2*r+1,None);lo[axis]=slice(None,-2*r-1)
    return ((c[tuple(hi)]-c[tuple(lo)])/(2*r+1)).astype(np.float32)
for _ in range(3): light=box(box(light,0),1)
proximity=np.asarray(Image.fromarray(coat).resize((640,800),Image.Resampling.BILINEAR),np.float32)
for _ in range(3): proximity=box(box(proximity,0,r=25),1,r=25)
proximity=np.clip(proximity*3,0,1)
# Gate only the support opacity of existing light; never add emission. This
# prevents the remote, straight source-image tail from becoming a dark plate.
light=np.maximum(light-32/255,0)/(1-32/255)*proximity
light=np.asarray(Image.fromarray(light).resize((2048,2560),Image.Resampling.BILINEAR),np.float32)
# Coverage support is smooth, rather than magnifying byte noise in faint light.
Image.fromarray(np.uint8(np.rint(np.stack([coat,np.sqrt(light),np.zeros_like(coat)],2)*255))).save(DEST/'cutout-mask.webp',lossless=True,method=6)
# T11696: on a light surface the arc keeps its colours only well inside the head. `cutout-fields.webp` holds, at a
# quarter of the size, the head blurred wide in G; the shader takes the arc where this blur is high. The outline itself still comes from the coat.
def gauss(a,r): return np.asarray(Image.fromarray(np.uint8(np.rint(np.clip(a,0,1)*255))).filter(ImageFilter.GaussianBlur(r)),np.float32)/255
# The head: the approved head and body layers (whole also where the bright arc crosses the head, where the coat has a
# hole) plus the coat, rounded and blurred wide.
head=coat.copy()
for name in ['cabeca','corpo']:
    rgba=np.asarray(Image.open(SRC/(name+'.png')).convert('RGBA'),np.float32)/255
    head=np.maximum(head,rgba[:,:,3])
head=gauss((gauss((head>.5).astype(np.float32),8)>.5).astype(np.float32),56)
# R: the coat blurred short (1 at its edge, fading out over ~20 px of the canvas), so the fog stays opaque right against
# the dark coat also where the light dips next to it (on black that dip is dark and invisible; on white it was pale).
hug=np.minimum(2*gauss(coat,60),1)
# B: the arc coverage of the material mask, blurred: its edge is jagged and striated, and on a light surface it would
# show as a staircase where the arc leaves the head.
arc=gauss(np.asarray(Image.open(DEST/'material-mask.webp').convert('RGB'),np.float32)[:,:,2]/255,24)
Image.fromarray(np.uint8(np.rint(np.stack([hug,head,arc],2)*255))).resize((512,640),Image.Resampling.BOX).save(DEST/'cutout-fields.webp',lossless=True,method=6)
# Static fallback: output premultiplied reference / coverage as straight RGBA.
for name in ['reference','reference-no-eyes']:
    rgb=np.asarray(Image.open(DEST/(name+'.webp')).convert('RGB'),np.float32)/255
    high=rgb.max(2)
    protection=np.asarray(Image.open(DEST/'material-mask.webp').convert('RGB'),np.float32)/255
    material=np.maximum(np.maximum(protection[:,:,1],protection[:,:,2]),coat)
    v=np.clip((material-.05)/.15,0,1); protected=v*v*(3-2*v)
    v=np.clip((high-16/255)/(16/255),0,1); support=np.maximum(v*v*(3-2*v),protected)
    rgb=rgb*support[:,:,None]
    alpha=np.maximum(coat,np.maximum(rgb.max(2),np.sqrt(light)))
    straight=np.divide(rgb,alpha[:,:,None],out=np.zeros_like(rgb),where=alpha[:,:,None]>0)
    # Prototype default band: only source light at left/right/bottom tapers.
    band=.08*2048
    y,x=np.mgrid[:2560,:2048]
    def smooth(v):
        v=np.clip(v,0,1);return v*v*(3-2*v)
    fade=smooth(x/band)*smooth((2047-x)/band)*smooth((2559-y)/band)
    # T11565 (spec #9573): the same rounded fall-off as the shader, an ellipse around the cat; never above the band,
    # and the protected material keeps the band.
    qx=((x+.5)/2048-.5)*2; qy=((y+.5)/2560-.5)*2
    rounded=1-smooth((np.sqrt(qx*qx+qy*qy)-.82)/(1-.82))
    fade=np.maximum(np.minimum(rounded,fade),fade*protected)
    rgb=rgb*np.maximum(coat,fade)[:,:,None]
    alpha=np.maximum(np.maximum(coat,rgb.max(2)),alpha*fade*smooth(y/band))
    straight=np.divide(rgb,alpha[:,:,None],out=np.zeros_like(rgb),where=alpha[:,:,None]>0)
    rgba=np.dstack([np.clip(straight,0,1),alpha])
    Image.fromarray(np.uint8(np.rint(rgba*255))).save(DEST/(name+'-cutout.webp'),lossless=True,method=6)
(DEST/'cutout-source.json').write_text(json.dumps(dict(task='T9708',sources=hashes,method='source layer coverage gated by smoothed dark observed material; float-smoothed light above32/255 pedestal gated near source coat; sqrt encoded; coat feather10px; 8pct side/bottom fade under an elliptical fall-off (T11565); weak emission16..32/255 curve preserving coat/arc; straight-alpha static fallback'),indent=2)+'\n')
