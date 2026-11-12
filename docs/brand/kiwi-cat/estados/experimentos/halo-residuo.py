#!/usr/bin/env python3
"""One diagnostic attempt requested in Kiwi #8283, using corrected #7963.
No application, microphone, network, or changes to approved eye/symbol code.
"""
from pathlib import Path
import importlib.util
import itertools
import json
import hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE=Path(__file__).resolve().parent
STATES=HERE.parent
spec=importlib.util.spec_from_file_location('approved',STATES/'montar.py')
approved=importlib.util.module_from_spec(spec);spec.loader.exec_module(approved)
SOURCE=approved.ASSETS
SIZE=(620,775)
SCALE=SIZE[0]/2048

def array(image):return np.asarray(image,dtype=np.float32)/255

def image(a):return Image.fromarray(np.uint8(np.clip(np.rint(a*255),0,255)))

def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1)
    return t*t*(3-2*t)

def blur(mask,radius):return array(image(mask).filter(ImageFilter.GaussianBlur(radius*SCALE)))

def over(rgb,colour,alpha):return rgb*(1-alpha[:,:,None])+colour*alpha[:,:,None]

def nonnegative_fit(features,target):
    # Exact active-set enumeration for <=4 components; no optional solver.
    gram=features.T@features;rhs=features.T@target
    best=(float('inf'),None)
    for count in range(1,features.shape[1]+1):
        for subset in itertools.combinations(range(features.shape[1]),count):
            ids=list(subset);w=np.zeros(features.shape[1])
            fit=np.linalg.lstsq(gram[np.ix_(ids,ids)],rhs[ids],rcond=None)[0]
            if np.any(fit<0):continue
            w[ids]=fit
            loss=float(w@gram@w-2*w@rhs)
            if loss<best[0]:best=(loss,w)
    return best

def main():
    native={n:Image.open(SOURCE/f'{n}.png').convert('RGBA') for n in approved.NAMES}
    reference=Image.new('RGBA',(2048,2560),'black')
    for n in approved.NAMES:reference=Image.alpha_composite(reference,native[n])
    layers={n:im.resize(SIZE,Image.Resampling.LANCZOS) for n,im in native.items()}
    reference_small=array(reference.resize(SIZE,Image.Resampling.LANCZOS))[:,:,:3]
    yy,xx=np.mgrid[:SIZE[1],:SIZE[0]]
    ears=[]
    for name in ['orelha-esquerda','orelha-direita']:
        rgba=array(layers[name]);dark=1-smooth(.08,.25,rgba[:,:,:3].max(axis=2))
        alpha=smooth(.65,.98,rgba[:,:,3])*dark
        ears.append(alpha)
    # A fixed opaque dome covers both roots. The body is the dark part of
    # the approved source body, retaining its original soft external edge.
    body=array(layers['corpo'])
    body_alpha=smooth(.65,.98,body[:,:,3])*(1-smooth(.08,.25,body[:,:,:3].max(axis=2)))
    radius=((xx/SCALE-1024)/510)**2+((yy/SCALE-1280)/430)**2
    dome=1-smooth(.97,1.035,radius)
    head_body=np.maximum(body_alpha,dome)
    fixed_colour=np.minimum(reference_small,40/255)
    silhouette0=1-(1-head_body)*(1-ears[0])*(1-ears[1])
    luz=array(layers['luz']);target=luz[:,:,:3]*luz[:,:,3,None]
    # One search over four scales, followed by a single render. The selected
    # scales and nonnegative least-squares weights are recorded in the report.
    candidates=[20,45,90,180,300,500]
    bases={r:blur(silhouette0,r) for r in candidates}
    colour=target.sum(axis=(0,1));colour/=colour.max()
    stride=4
    target_samples=target[::stride,::stride].reshape(-1)
    best=(float('inf'),None,None)
    for radii in itertools.combinations(candidates,4):
        features=np.stack([(bases[r][::stride,::stride,None]*colour).reshape(-1) for r in radii],axis=1).astype(np.float64)
        loss,w=nonnegative_fit(features,target_samples.astype(np.float64))
        if loss<best[0]:best=(loss,radii,w)
    radii,weights=best[1:]
    def halo(silhouette):
        scalar=sum(float(w)*blur(silhouette,r) for r,w in zip(radii,weights))
        return scalar[:,:,None]*colour
    halo0=halo(silhouette0)
    residual=target-halo0
    ear_neutral=np.maximum(*ears)
    dilation=image(ear_neutral).filter(ImageFilter.MaxFilter(41))
    E=np.clip(array(dilation.filter(ImageFilter.GaussianBlur(24)))*2,0,1)
    matte=np.array([11,11,14],dtype=np.float32)/255
    def compose(left,right,state=None,t=0):
        moved=[]
        for alpha,name,angle in zip(ears,['orelha-esquerda','orelha-direita'],[left,right]):
            pivot=tuple(v*SCALE for v in approved.META['pivots'][name])
            moved.append(array(image(alpha).rotate(angle,Image.Resampling.BICUBIC,center=pivot)))
        silhouette=1-(1-head_body)*(1-moved[0])*(1-moved[1])
        fade=float(smooth(0,3,max(abs(left),abs(right))))
        light=halo(silhouette)+residual*(1-E[:,:,None]*fade)
        # Back to front, no light*(1-mask): opaque surfaces occlude it.
        rgb=over(light,fixed_colour,head_body)
        for alpha in moved:rgb=over(rgb,matte,alpha)
        out=image(rgb).convert('RGBA')
        out=Image.alpha_composite(out,layers['aro'])
        p=approved.preview_pose(state,t) if state else approved.pose('diagnóstico')
        if p['big']!=1 or p['small']!=1 or p['up'] or p['eye']<1 or p['other'] is not None or p['blink'] or p['gaze']:
            out=approved.fill_hidden_eyes(out,SCALE)
        out=Image.alpha_composite(out,approved.eye_layer(SIZE,SCALE,p))
        out=Image.alpha_composite(out,approved.symbol_layer(SIZE,SCALE,p))
        return out.convert('RGB')
    cases=[('neutro',0,0,None),('erro +20/-20',20,-20,'erro'),('esquerda -25',-25,0,None),('esquerda +25',25,0,None),('direita -25',0,-25,None),('direita +25',0,25,None)]
    sheet=Image.new('RGB',(1240,825*3),'black')
    for j,(label,left,right,state) in enumerate(cases):
        im=compose(left,right,state,.9)
        x=(j%2)*620;y=(j//2)*825
        sheet.paste(im,(x,y))
        ImageDraw.Draw(sheet).text((x+16,y+785),label+' · tentativa #7963 / não aprovado',font=approved.font(16),fill='white')
    approved.save(sheet,HERE/'teste-halo-residuo.webp')
    # Compare at rendered resolution, explicitly not the source-size gate.
    actual=np.asarray(compose(0,0),dtype=np.int16)
    expected=np.asarray(Image.open(SOURCE/'kiwi-cat-candidata-v2.png').convert('RGB').resize(SIZE,Image.Resampling.LANCZOS),dtype=np.int16)
    outside=np.ones(yy.shape,dtype=bool)
    for eye in approved.META['eyes']:
        outside&=(xx-eye['cx']*SCALE)**2+(yy-eye['cy']*SCALE)**2>((eye['r']+5)*SCALE+2)**2
    diff=np.abs(actual-expected)
    roi=E>.1
    report=dict(task='T7606',recipe='#7963',instruction='#8283',attempts=1,
        size=list(SIZE),scale_search_source_pixels=candidates,chosen_scales_source_pixels=list(radii),weights=weights.tolist(),colour=colour.tolist(),
        residual_rgb_255=dict(mean=float(np.abs(residual[roi]).mean()*255),max=float(np.abs(residual[roi]).max()*255),region='E > .1',pixels=int(roi.sum()),weighted_mean=float((np.abs(residual)*E[:,:,None]).sum()/E.sum()/3*255)),
        neutral_preview_error_255=dict(max=int(diff[outside].max()),mean=float(diff[outside].mean()),scope='620x775 diagnostic only; source-size <=4 gate not claimed'),
        light_neutral_identity_max_255=float(np.abs(halo0+residual-target).max()*255),
        angles=[-25,25],error_angles=[20,-20],approved_features='unchanged approved functions: eyes, blink, eye fill, symbols; original arc; no palette edits',
        original_sha256={n+'.png':hashlib.sha256((SOURCE/f'{n}.png').read_bytes()).hexdigest() for n in approved.NAMES})
    # Native neutral check needs no fitted halo rendering: H0 + R is exactly
    # the native source light. Use the same mask extraction at source size.
    native_ref=array(reference)[:,:,:3]
    native_light=array(native['luz']);neutral_native=native_light[:,:,:3]*native_light[:,:,3,None]
    y0,x0=np.mgrid[:2560,:2048]
    radius0=((x0-1024)/510)**2+((y0-1280)/430)**2
    body0=array(native['corpo'])
    body_mask0=smooth(.65,.98,body0[:,:,3])*(1-smooth(.08,.25,body0[:,:,:3].max(axis=2)))
    head_body0=np.maximum(body_mask0,1-smooth(.97,1.035,radius0))
    neutral_native=over(neutral_native,np.minimum(native_ref,40/255),head_body0)
    for name in ['orelha-esquerda','orelha-direita']:
        layer=array(native[name]);alpha=smooth(.65,.98,layer[:,:,3])*(1-smooth(.08,.25,layer[:,:,:3].max(axis=2)))
        neutral_native=over(neutral_native,matte,alpha)
    native_output=Image.alpha_composite(image(neutral_native).convert('RGBA'),native['aro']).convert('RGB')
    native_expected=np.asarray(Image.open(SOURCE/'kiwi-cat-candidata-v2.png').convert('RGB'),dtype=np.int16)
    native_exclusion=np.ones((2560,2048),dtype=bool)
    for eye in approved.META['eyes']:
        native_exclusion&=(x0-eye['cx'])**2+(y0-eye['cy'])**2>(eye['r']+5)**2
    native_diff=np.abs(np.asarray(native_output,dtype=np.int16)-native_expected)
    report['neutral_native_error_255']=dict(max=int(native_diff[native_exclusion].max()),mean=float(native_diff[native_exclusion].mean()),size=[2048,2560],exclusion='source eye disks +5px',passes=False)
    report['fixed_arc_sample_rgba']=dict(point_preview=[155,220],rgba=list(layers['aro'].getpixel((155,220))),finding='unchanged source arc contains pale neutral-ear fringe; overlaid last it reintroduces old fringe and light inside moved opaque ears')
    report['status']='FAILED; stopped after one requested attempt; no clips generated, no review requested'
    (HERE/'verificacao-halo-residuo.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)

if __name__=='__main__':main()
