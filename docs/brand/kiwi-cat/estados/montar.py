#!/usr/bin/env python3
"""T7606, revisão #7630: pranchas documentais com as camadas aprovadas.
Não é código de animação nem captura do app. Sem rede, blur ou geração de gato.
"""
from pathlib import Path
import hashlib
import io
import math
import json
import subprocess
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageColor

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent / 'gerada'
META = json.loads((ASSETS / 'manifest.json').read_text())
NAMES = ['luz', 'corpo', 'cabeca', 'orelha-esquerda', 'orelha-direita', 'aro']
SCALE = .75
W, H = 1536, 1920
FOOT = 132
FONT = '/System/Library/Fonts/Helvetica.ttc'

def pose(label, left=0, right=0, gaze=0, eye=1, other=None, blink=False, fog=1, side=0, upper=0, symbol="", big=1, small=1, up=0, phase=0):
    return dict(label=label, left=left, right=right, gaze=gaze, eye=eye,
                other=other, blink=blink, fog=fog, side=side, upper=upper, symbol=symbol, big=big, small=small, up=up, phase=phase)

STATES = {
 'repouso': [pose('01 · neutro / fonte aprovada'), pose('02 · olhar discreto',right=-2,gaze=15,fog=.94), pose('03 · piscada lenta',eye=.12,fog=.9)],
 'acordou': [pose('01 · antes do atalho',eye=.65,fog=.82), pose('02 · pico do opa',left=-5,right=5,eye=1,fog=1.16,upper=.16), pose('03 · assentando',left=-1,right=1,eye=1,fog=1.02)],
 'ouvindo': [pose('01 · voz baixa',fog=.66,eye=1), pose('02 · voz alta',left=-2,right=2,fog=1.26,upper=.10)],
 'thinking': [pose('01 · busca à esquerda',gaze=-30,left=2,fog=.95,side=-.28,upper=.20), pose('02 · busca à direita',gaze=30,right=-2,fog=.95,side=.28,upper=.20)],
 'agindo': [pose('01 · foco / pálpebras retas',eye=.60,fog=1.12,side=-.12), pose('02 · execução / foco mantido',eye=.60,gaze=10,fog=1.12,side=.12)],
 'pronto': [pose('01 · piscada satisfeita',blink=True,left=2,right=-2,fog=1.06), pose('02 · retorno tranquilo',fog=.96)],
 'erro': [pose('01 · hesitação',left=4,right=-3,eye=.42,other=.88,gaze=-12,fog=.76), pose('02 · recolher / aguardar',left=7,right=-5,eye=.24,other=.62,gaze=-12,fog=.43,upper=-.15)],
}

STATES['dormindo']=[pose('01 · sono / zZ nasce',blink=True,symbol='sleep',fog=.26),pose('02 · zZ sobe',blink=True,symbol='sleep',fog=.22,phase=1)]
for j,p in enumerate(STATES['acordou']):p.update(symbol='alert' if j==1 else '',big=[1,1.24,1.10][j],phase=j)
for j,p in enumerate(STATES['ouvindo']):p.update(symbol='sound',phase=j)
for j,p in enumerate(STATES['thinking']):p.update(eye=.58,up=-24,symbol='thought',phase=j)
for j,p in enumerate(STATES['agindo']):p.update(symbol='work',phase=j)
for j,p in enumerate(STATES['pronto']):p.update(symbol='spark',blink=True,phase=j)
STATES['erro']=[pose('01 · rabisco começa / 0,00 s',left=12,right=-12,big=.72,small=.62,symbol='confusion',fog=.68,phase=0),pose('02 · embolando / 0,45 s',left=14,right=-14,big=.67,small=.68,symbol='confusion',fog=.58,phase=1),pose('03 · embolado / 0,90 s',left=15,right=-15,big=.62,small=.62,symbol='confusion',fog=.50,phase=2)]
STATES['repouso'][1].update(right=-12)
for p in STATES['dormindo']:p.update(left=12,right=-12)
STATES['acordou'][1].update(left=-15,right=15)
STATES['ouvindo'][0].update(left=-12,right=12)
STATES['ouvindo'][1].update(left=-15,right=15)
STATES={k:STATES[k] for k in ['repouso','dormindo','acordou','ouvindo','thinking','agindo','pronto','erro']}

FOG = {
 'repouso': 'Massa original; densidade 1,00 → 0,94 → 0,90. Sem deslocamento.',
 'acordou': 'Densidade 0,82 → 1,16 → 1,02; sobe a luz acima da cabeça no pico.',
 'ouvindo': 'Densidade 0,66 → 1,26; voz alta ocupa mais o volume já existente.',
 'thinking': 'Densidade 0,95; peso desloca da esquerda à direita e concentra no alto.',
 'agindo': 'Densidade 1,12; peso lateral alterna com olhos retos, sem expressão de raiva.',
 'pronto': 'Densidade 1,06 → 0,96; expansão de luz na piscada, depois assenta.',
 'erro': 'Densidade de 0,68 para 0,58 e 0,50; aro acompanha a luz; rabisco avança.',
}

FOG['dormindo']='Massa original com luz mínima; zZ sobe sem alterar a silhueta.'

def font(size):
    return ImageFont.truetype(FONT, size)


def eye_layer(size, scale, p):
    # Supersampling 2x. Sem brilho. Semicerrado = disco recortado por
    # pálpebra horizontal, nunca uma fresta diagonal que sugira raiva.
    image = Image.new('RGBA', (size[0]*2, size[1]*2))
    d = ImageDraw.Draw(image)
    for i,e in enumerate(META['eyes']):
        cx=(e['cx']+p['gaze'])*scale*2; cy=(e['cy']+p['up'])*scale*2; r=e['r']*scale*2*p['big']*(p['small'] if i else 1)
        opening = p['other'] if i==1 and p['other'] is not None else p['eye']
        if p['blink']:
            d.arc((cx-r,cy-r*.45,cx+r,cy+r*.65),*( (10,170) if p['symbol']=='sleep' else (190,350) ),fill='white',width=max(2,round(34*scale*2)))
        else:
            mask = Image.new('L',image.size)
            md=ImageDraw.Draw(mask);md.ellipse((cx-r,cy-r,cx+r,cy+r),fill=255)
            if opening<1:
                md.rectangle((cx-r-1,cy-r-1,cx+r+1,cy+r-2*r*opening),fill=0)
            white=Image.new('RGBA',image.size,'white');white.putalpha(mask)
            image=Image.alpha_composite(image,white)
    return image.resize(size,Image.Resampling.LANCZOS)


FOG_FLOOR=.50

def tint_for(color):
    presets={'claude':'#ff9b5e','codex':'#faf9ff'}
    rgb=np.array(ImageColor.getrgb(presets.get(color,color))[:3],dtype=np.float32)/255
    linear=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
    luminance=float(linear@np.array([.2126,.7152,.0722]))
    if luminance<.28:
        linear=linear+(1-linear)*((.28-luminance)/(1-luminance))
    rgb=np.where(linear<=.0031308,linear*12.92,1.055*linear**(1/2.4)-.055)
    return rgb/float(rgb@np.array([.2126,.7152,.0722]))


def fog_layer(image,p,palette,arc):
    if palette=='padrao' and p['fog']==1 and p['side']==0 and p['upper']==0:return image
    a=np.array(image);rgb=a[:,:,:3].astype(np.float32)
    lum=rgb@np.array([.2126,.7152,.0722],dtype=np.float32)
    chroma=(rgb.max(axis=2)-rgb.min(axis=2))/np.maximum(rgb.max(axis=2),1)
    t=np.clip((chroma-.28)/.27,0,1);protect=t*t*(3-2*t)
    y,x=np.ogrid[:image.height,:image.width]
    weight=np.maximum(FOG_FLOOR,p['fog']*(1+p['side']*(x/image.width-.5)*2+p['upper']*(.5-y/image.height)*2))
    # Chromatic arc keeps its hue and never gains relative to the fog:
    # its multiplier is at most the dimmest local fog multiplier, capped at 1.
    arc_gain=min(1.,float(weight.min()))
    mist=rgb*weight[:,:,None]
    if palette!='padrao':mist=lum[:,:,None]*tint_for(palette)*weight[:,:,None]
    # Monotone exposure with a dark matte floor. The arc gets no pedestal,
    # so it can never become relatively brighter than the surrounding mist.
    mask=np.maximum(lum-12,0)/np.maximum(lum,1)
    fog_rgb=rgb*(1-mask[:,:,None])+mist*mask[:,:,None]
    visible=fog_rgb*(1-protect[:,:,None])+rgb*arc_gain*protect[:,:,None]
    a[:,:,:3]=np.uint8(np.rint(np.clip(visible,0,255)))
    return Image.fromarray(a)


def fill_hidden_eyes(image, scale):
    # A extração antiga preencheu os olhos com discos quase uniformes.
    # Ao fechar/mover os olhos, esses pixels antes ocultos ficam aparentes.
    # Estima só os discos + 5 px a partir da superfície vizinha, sem blur.
    a=np.array(image)
    for e in META['eyes']:
        cx=e['cx']*scale;cy=e['cy']*scale;r=e['r']*scale
        extent=int(r+40*scale)
        x0=max(0,int(cx)-extent);y0=max(0,int(cy)-extent)
        x1=min(image.width,int(cx)+extent+1);y1=min(image.height,int(cy)+extent+1)
        patch=a[y0:y1,x0:x1,:3]
        yy,xx=np.mgrid[y0:y1,x0:x1];dx=(xx-cx)/r;dy=(yy-cy)/r
        radius=np.hypot(xx-cx,yy-cy)
        ring=(radius>r+8*scale)&(radius<r+34*scale)
        basis=np.stack([np.ones_like(dx),dx,dy,dx*dx,dx*dy,dy*dy],axis=-1)
        coefficients=np.linalg.lstsq(basis[ring],patch[ring].astype(float),rcond=None)[0]
        estimate=np.uint8(np.clip(np.rint(basis@coefficients),0,255))
        hidden=radius<=r+5*scale
        patch[hidden]=estimate[hidden]
    return Image.fromarray(a)


def bend_ear(layer,angle,pivot,scale):
    """Almost rigid triangle; only 140 source pixels around the root flex."""
    px,py=pivot;theta=math.radians(angle);step=32
    def source(x,y):
        sx,sy=x,y
        for _ in range(7):
            t=float(np.clip((py+60*scale-sy)/(140*scale),0,1))
            weight=t*t*(3-2*t)
            a=theta*weight;dx=x-px;dy=y-py
            sx=px+dx*math.cos(a)-dy*math.sin(a);sy=py+dx*math.sin(a)+dy*math.cos(a)
        return sx,sy
    mesh=[]
    for y in range(0,layer.height,step):
        for x in range(0,layer.width,step):
            x1=min(x+step,layer.width);y1=min(y+step,layer.height)
            mesh.append(((x,y,x1,y1),(*source(x,y),*source(x,y1),*source(x1,y1),*source(x1,y))))
    return layer.transform(layer.size,Image.Transform.MESH,mesh,Image.Resampling.BICUBIC)


def compose(assets,p,palette='padrao',scale=SCALE):
    size=assets['cabeca'].size
    if '__base' in assets:
        out=assets['__base'].copy()
        for name in ['orelha-esquerda','orelha-direita']:
            angle=p['left'] if name.endswith('esquerda') else p['right']
            layer=assets[name]
            if angle:layer=bend_ear(layer,angle,tuple(v*scale for v in META['pivots'][name]),scale)
            out=Image.alpha_composite(out,layer)
        out=Image.alpha_composite(out,assets['__head'])
    else:
        out=Image.new('RGBA',size,'black')
        for name in NAMES:out=Image.alpha_composite(out,assets[name])
    out=fog_layer(out,p,palette,assets['aro'])
    if p['big']!=1 or p['small']!=1 or p['up'] or p['eye']<1 or p['other'] is not None or p['blink'] or p['gaze']:
        out=fill_hidden_eyes(out,scale)
    out=Image.alpha_composite(out,eye_layer(size,scale,p))
    return Image.alpha_composite(out,symbol_layer(size,scale,p)).convert('RGB')


def tile(image,p,state,palette):
    out=Image.new('RGB',(W,H+FOOT),'black');out.paste(image,(0,0))
    d=ImageDraw.Draw(out)
    d.text((44,H+13),p['label'],font=font(32),fill='#ffffff')
    d.text((44,H+62),f'REFERÊNCIA · {state} · {palette} · camadas v2',font=font(26),fill='#aaa7ba')
    return out


def strip(tiles,title,description):
    out=Image.new('RGB',(W*len(tiles),H+FOOT+150),'black');d=ImageDraw.Draw(out)
    d.text((44,26),title,font=font(44),fill='white')
    d.text((44,90),description.replace('→',' para '),font=font(26),fill='#b6b1c7')
    for i,t in enumerate(tiles):
        out.paste(t,(W*i,150))
        if i:d.line((W*i,160,W*i,H+FOOT+120),fill='#24232b',width=2)
    return out


def baseline_check(native):
    p=pose('baseline');actual=np.array(compose(native,p,scale=1)).astype(np.int16)
    expected=np.array(Image.open(ASSETS/'kiwi-cat-candidata-v2.png').convert('RGB')).astype(np.int16)
    y,x=np.ogrid[:2560,:2048];outside=np.ones((2560,2048),dtype=bool)
    for e in META['eyes']:
        outside&=(x-e['cx'])**2+(y-e['cy'])**2>(e['r']+5)**2
    diff=np.abs(actual-expected);mx=int(diff[outside].max());mean=float(diff[outside].mean())
    assert mx<=4 and mean<.5,(mx,mean)
    return dict(max_channel_error_outside_eyes=mx,mean_channel_error_outside_eyes=mean,
                native_size=[2048,2560],scope='pose neutra padrão, antes da redução; exclui discos dos olhos + 5 px')


def save(image,path):
    for quality in [90,86,82,78,74,70,64,58,52,46,40]:
        data=io.BytesIO();image.save(data,format='WEBP',quality=quality,method=6)
        if data.tell()<=500_000:
            path.write_bytes(data.getvalue());return
    raise ValueError(f'Imagem maior que 500 KB: {path}')


def symbol_layer(size,scale,p):
    im=Image.new('RGBA',(size[0]*2,size[1]*2));d=ImageDraw.Draw(im)
    k=scale*2;kind=p['symbol'];phase=p['phase'];white='#ffffff'
    def point(x,y):
        zoom=p.get('symbol_scale',1)
        x=1710+(x-1710)*zoom;y=700+(y-700)*zoom+p.get('symbol_offset_y',0)
        if kind in ['alert','question','sleep']:
            cx,cy=1710,700;theta=math.radians(12)
            x,y=cx+(x-cx)*math.cos(theta)-(y-cy)*math.sin(theta),cy+(x-cx)*math.sin(theta)+(y-cy)*math.cos(theta)
        if kind=='thought':x=1560+(x-1560)*1.12
        elif x>1024:x=1545+(x-1545)*1.18-45
        else:x=400+(x-400)*1.18+25
        y=850+(y-850)*1.15+35
        return x*k,y*k
    def poly(ps,fill=white,rounds=0):
        ps=np.array(ps,dtype=float)
        # Two Chaikin passes soften the points without a uniform stroke.
        for _ in range(rounds):
            nxt=np.roll(ps,-1,axis=0);ps=np.stack([ps*.75+nxt*.25,ps*.25+nxt*.75],axis=1).reshape(-1,2)
        d.polygon([point(x,y) for x,y in ps],fill=fill)
    def disc(x,y,r,fill=white):
        poly([(x+r*math.cos(t),y+r*(1+.04*math.sin(3*t))*math.sin(t)) for t in np.linspace(0,2*math.pi,90)],fill)
    def ribbon(ps,widths):
        ps=np.array(ps,dtype=float);tangent=np.gradient(ps,axis=0)
        lengths=np.maximum(np.linalg.norm(tangent,axis=1),.001)
        normal=np.stack([-tangent[:,1],tangent[:,0]],axis=1)/lengths[:,None]
        widths=np.asarray(widths)
        if widths.ndim==0:widths=np.full(len(ps),float(widths))
        a=ps+normal*widths[:,None]/2;b=ps-normal*widths[:,None]/2
        for j in range(len(ps)-1):poly([a[j],a[j+1],b[j+1],b[j]])
        for q,w in [(ps[0],widths[0]),(ps[-1],widths[-1])]:disc(*q,max(1,float(w)/2))
    def bezier(control,n=80):
        c=np.array(control,dtype=float);t=np.linspace(0,1,n)[:,None]
        return (1-t)**3*c[0]+3*(1-t)**2*t*c[1]+3*(1-t)*t*t*c[2]+t**3*c[3]
    def dash(x,y,length=110,dy=-10):
        ts=np.linspace(0,1,50);ps=[(x+t*length,y+dy*t+3*math.sin(t*math.pi)) for t in ts]
        ribbon(ps,4+36*(1-ts)**.65)
    def drop(x,y):
        left=bezier([(x,y-65),(x-10,y-45),(x-66,y+24),(x-38,y+51)])
        right=bezier([(x-38,y+51),(x+43,y+98),(x+72,y+12),(x,y-65)])
        poly(np.concatenate([left,right]))
    def star(x,y,r=55):
        poly([(x,y-r),(x+13,y-14),(x+r,y+3),(x+13,y+16),(x-2,y+r),(x-14,y+15),(x-r,y-2),(x-15,y-15)],rounds=2)
    if kind=='alert':
        x,y=1710,570
        poly([(x-49,y-90),(x+48,y-100),(x+25,y+64),(x-16,y+74)],rounds=2)
        disc(x+4,y+123,28)
        dash(x+112,y+28,65,-35);dash(x+112,y+96,67,20)
    elif kind=='sleep':
        for x,y,z in [(1640,730-phase*60,105),(1800,530-phase*90,150)]:
            u=z/2
            poly([(x-u,y-u),(x+u+7,y-u-6),(x+u+1,y-u+35),(x-u+42,y+u-31),(x+u+8,y+u-30),(x+u,y+u+6),(x-u-6,y+u),(x-u+1,y+u-30),(x+u-43,y-u+33),(x-u+2,y-u+37)],rounds=1)
    elif kind=='sound':
        for j in range(1,2+phase*2):
            r=45+j*48;t=np.linspace(-.96,.96,100);ps=[(1590+r*math.cos(v),930+r*math.sin(v)) for v in t]
            ribbon(ps,3+38*np.sin(np.linspace(0,math.pi,len(t)))**.7)
    elif kind=='thought':
        angles=np.linspace(0,2*math.pi,200)
        def cloud(rx,ry):return [(1765+rx*(1+.095*math.cos(7*t+.2))*math.cos(t),575+ry*(1+.095*math.cos(7*t+.2))*math.sin(t)) for t in angles]
        poly(cloud(190,123));poly(cloud(153,86),fill='black')
        disc(1590,751,23);disc(1558,807,14)
        for j in range(3):disc(1665+j*95,575,23 if j<=phase else 16)
    elif kind=='work':
        drop(1680,820+phase*35);drop(1810,1010+phase*45)
        for j in range(3):dash(240-j*20,1030+j*90,135,-8+j*6)
    elif kind=='spark':
        for x,y,r in [(350,1050,64),(1710,780,76),(1790,1210,49)]:star(x,y,r+(7 if phase else 0))
    elif kind=='confusion':
        progress=p.get('scribble_progress')
        end=[1.4,4.3,7][phase] if progress is None else .15+6.85*progress
        count=[70,155,240][phase] if progress is None else max(8,round(240*progress))
        jitter=p.get('scribble_jitter',phase)
        t=np.linspace(0,end*math.pi,count);ps=[(1740+110*math.cos(v)+3*math.sin(v*7+jitter),650+60*math.sin(v)+28*math.sin(v*1.65)+3*math.cos(v*9+jitter)) for v in t]
        ribbon(ps,21+13*(1+np.sin(t*1.3))/2)
    if p.get('symbol_opacity',1)!=1:im.putalpha(im.getchannel('A').point(lambda a:round(a*p['symbol_opacity'])))
    return im.resize(size,Image.Resampling.LANCZOS)


def prepare_ears(native):
    """A clean three-layer ear rig from the original six-layer visible scene."""
    full=Image.new('RGBA',(2048,2560),'black')
    for n in NAMES:full=Image.alpha_composite(full,native[n])
    target=np.array(full)[:,:,:3].astype(np.float32)/255
    meta=json.loads((ASSETS/'camadas.json').read_text());masks=[]
    y,x=np.mgrid[:2560,:2048]
    for key in ['orelhaEsquerda','orelhaDireita']:
        vertices=np.array(meta[key],dtype=float);center=vertices.mean(axis=0)
        vertices=center+(vertices-center)*1.45
        hard=Image.new('L',(2048,2560));ImageDraw.Draw(hard).polygon([tuple(v) for v in vertices],fill=255)
        inside=np.array(hard)>0;distance=np.full((2560,2048),1e6,dtype=np.float32)
        for a,b in zip(vertices,np.roll(vertices,-1,axis=0)):
            vx,vy=b-a;u=np.clip(((x-a[0])*vx+(y-a[1])*vy)/(vx*vx+vy*vy),0,1)
            distance=np.minimum(distance,np.hypot(x-a[0]-u*vx,y-a[1]-u*vy))
        t=np.clip(distance/75,0,1);masks.append(inside*t*t*(3-2*t))
    roi=np.maximum(*masks)
    # Dome is fixed; an ear pivots above it and its attachment disappears behind it.
    radius=((x-1024)/510)**2+((y-1280)/430)**2
    h=np.clip((1.035-radius)/.065,0,1);h=h*h*(3-2*h)
    chroma=(target.max(axis=2)-target.min(axis=2))/np.maximum(target.max(axis=2),.001)
    luminous=target@np.array([.2126,.7152,.0722])
    c=np.clip((chroma-.45)/.25,0,1);c=c*c*(3-2*c)
    v=np.clip((luminous-.02)/.03,0,1);v=v*v*(3-2*v)
    fixed_arc=c*v*(x>560)*(x<1470)*(y>800)*(y<1600)
    h=np.maximum(h,fixed_arc)
    remove=roi
    grid=np.array(Image.fromarray(np.uint8(np.rint(target*255))).resize((128,160),Image.Resampling.BILINEAR),dtype=float)
    unknown=np.array(Image.fromarray(np.uint8((roi>.05)*255)).resize((128,160),Image.Resampling.NEAREST))>127
    for _ in range(1200):
        average=(np.roll(grid,1,0)+np.roll(grid,-1,0)+np.roll(grid,1,1)+np.roll(grid,-1,1))/4
        grid[unknown]=average[unknown]
    field=np.array(Image.fromarray(np.uint8(np.clip(np.rint(grid),0,255))).resize((2048,2560),Image.Resampling.BICUBIC),dtype=np.float32)/255
    field=np.maximum(field,.22)
    base=target*(1-remove[:,:,None])+field*remove[:,:,None]
    base=np.uint8(np.clip(np.rint(base*255),0,255)).astype(np.float32)/255
    minimum=np.max(np.maximum((base-target)/np.maximum(base,1e-6),(target-base)/np.maximum(1-base,1e-6)),axis=2)
    dark=(target@np.array([.2126,.7152,.0722]))<.065
    effective=np.clip(np.maximum(minimum,dark*remove),0,1)
    source_alpha=effective.copy()
    # Recompute the effective alpha after quantization; solve RGB against that.
    source_alpha=np.rint(source_alpha*255)/255;effective=source_alpha
    fg=np.divide(target-(1-effective[:,:,None])*base,effective[:,:,None],out=target.copy(),where=effective[:,:,None]>1e-6)
    result={n:im.copy() for n,im in native.items()}
    result['__base']=Image.fromarray(np.uint8(np.rint(base*255))).convert('RGBA')
    head_rgba=np.dstack([np.uint8(np.rint(target*255)),np.uint8(np.rint(h*255))])
    result['__head']=Image.fromarray(head_rgba)
    for n,left in [('orelha-esquerda',True),('orelha-direita',False)]:
        a=source_alpha*((x<1024) if left else (x>=1024))
        rgba=np.dstack([np.uint8(np.clip(np.rint(fg*255),0,255)),np.uint8(np.rint(a*255))])
        # Inpaint only fully occluded root texels in premultiplied RGBA.
        # A flat opaque patch would introduce a cut as the base rotates out.
        hidden=h>=1
        premul=rgba.astype(np.float32);premul[:,:,:3]*=premul[:,:,3,None]/255
        low=np.stack([np.array(Image.fromarray(premul[:,:,c]).resize((128,160),Image.Resampling.BILINEAR)) for c in range(4)],axis=2).astype(float)
        holes=np.array(Image.fromarray(np.uint8(hidden*255)).resize((128,160),Image.Resampling.NEAREST))>127
        low[holes]=0
        for _ in range(900):
            avg=(np.roll(low,1,0)+np.roll(low,-1,0)+np.roll(low,1,1)+np.roll(low,-1,1))/4
            low[holes]=avg[holes]
        filled=np.stack([np.array(Image.fromarray(low[:,:,c].astype(np.float32)).resize((2048,2560),Image.Resampling.BICUBIC)) for c in range(4)],axis=2).astype(float)
        color=np.divide(filled[:,:,:3]*255,filled[:,:,3,None],out=np.zeros_like(filled[:,:,:3]),where=filled[:,:,3,None]>0)
        rgba[hidden,:3]=(11,11,14);rgba[hidden,3]=np.uint8(np.clip(np.rint(filled[hidden,3]),0,255))
        result[n]=Image.fromarray(rgba)
    folder=HERE/'preparadas';folder.mkdir(exist_ok=True)
    expected={'fundo-sem-orelhas.png','cabeca-fixa.png','orelha-esquerda.png','orelha-direita.png'}
    for old in folder.glob('*.png'):
        if old.name not in expected:old.unlink()
    result['__base'].save(folder/'fundo-sem-orelhas.png');result['__head'].save(folder/'cabeca-fixa.png')
    for n in ['orelha-esquerda','orelha-direita']:result[n].save(folder/(n+'.png'))
    (folder/'manifest.json').write_text(json.dumps(dict(size=[2048,2560],blend='source-over',alpha='straight',order=['fundo-sem-orelhas.png','orelha-esquerda.png','orelha-direita.png','cabeca-fixa.png','eyes-by-code'],pivots=META['pivots'],source='../../gerada/manifest.json',deformation='near-rigid rotation about manifest pivot, flex only in root strip py-80..py+60',scope='documentary reference rig; original source assets unchanged'),ensure_ascii=False,indent=2)+'\n')
    return result,dict(originals_untouched=True,ear_angles=[-15,-7.5,0,7.5,15],
        method='ear-region source-over rematting of the original composite; original head and frontal arc mask hidden attachments',
        changed_base_pixels=int(np.any(np.abs(base-target)>0,axis=2).sum()),
        outside_ear_roi_unchanged=bool(np.array_equal(base[roi==0],target[roi==0])),
        fog_fill='harmonic 128x160 / 1200 iterations; hidden root alpha 900 iterations float32, matte RGB',root_skinning='tip control angles; near-rigid triangle, flex only py-80..py+60 source pixels, 32px mesh, 7 inverse iterations')


def smooth(a,b,t):
    z=float(np.clip((t-a)/(b-a),0,1));return z*z*(3-2*z)


def preview_pose(state,t):
    # Mist is intentionally frozen; delivery 3 owns its motion.
    p=pose('prévia',fog=1)
    if state=='repouso':
        closing=smooth(1.15,1.48,t);opening=smooth(1.56,2.02,t)
        p['eye']=max(.005,1-closing+opening)
        p['right']=-12*(smooth(2.45,2.64,t)-smooth(2.70,3.04,t))
        p['gaze']=24*(smooth(3.75,4.14,t)-smooth(4.86,5.32,t))
    elif state=='acordou':
        rise=smooth(.20,.53,t);settle=smooth(.72,1.45,t)
        p.update(left=-15*rise*(1-settle),right=15*rise*(1-settle),
                 eye=.65+.35*smooth(.12,.35,t),big=1+.24*rise*(1-settle))
        if .30<=t<1.20:
            p['symbol']='alert'
            pop=smooth(.30,.46,t);leave=smooth(.97,1.20,t)
            p['symbol_scale']=(.35+.65*pop)*(1-.35*leave)
            p['symbol_offset_y']=70*(1-pop)-28*math.sin(math.pi*pop)*(1-leave)
            p['symbol_opacity']=1-leave
    elif state=='erro':
        opening=smooth(.12,.82,t);cycle=t%1.0
        p.update(left=15*opening,right=-15*opening,big=.72,small=.62,
                 symbol='confusion',phase=0,scribble_progress=min(cycle/.9,1),
                 scribble_jitter=t*22,symbol_opacity=1-smooth(.92,1,cycle))
    else:raise ValueError(state)
    return p


def render_previews(native):
    fps=30;scale=620/2048;size=(620,775);canvas=(620,856)
    assets={name:image.resize(size,Image.Resampling.LANCZOS) for name,image in native.items()}
    folder=HERE/'previas';folder.mkdir(exist_ok=True);reports=[]
    for state,seconds in [('repouso',6.0),('acordou',2.4),('erro',3.0)]:
        count=round(seconds*fps);frames=[];poses=[]
        for i in range(count):
            t=i/fps;p=preview_pose(state,t);poses.append(p)
            frame=Image.new('RGB',canvas,'black')
            frame.paste(compose(assets,p,scale=scale),(0,0));draw=ImageDraw.Draw(frame)
            draw.text((18,789),'PRÉVIA DE MOVIMENTO · NÃO É A ANIMAÇÃO FINAL',font=font(16),fill='white')
            draw.text((18,818),f'{state} · 30 fps · quadro {i+1:03d}/{count} · {t:0.3f} s',font=font(15),fill='#b6b1c7')
            frames.append(frame)
        durations=[round((i+1)*1000/fps)-round(i*1000/fps) for i in range(count)]
        path=folder/(state+'.webp');quality=82
        for quality in [82,74,66,58,50,42]:
            frames[0].save(path,format='WEBP',save_all=True,append_images=frames[1:],duration=durations,
                           loop=0,quality=quality,method=6,kmin=9,kmax=17)
            if path.stat().st_size<=1_500_000:break
        assert path.stat().st_size<=1_500_000,(path,path.stat().st_size)
        # Frame-index caption makes even still frames unique, retaining the 30fps cadence.
        check=Image.open(path);assert check.n_frames==count,(state,check.n_frames,count)
        mp4=folder/(state+'.mp4')
        process=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo',
            '-pixel_format','rgb24','-video_size','620x856','-framerate','30','-i','pipe:0','-an',
            '-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-threads','2',
            '-movflags','+faststart',str(mp4)],stdin=subprocess.PIPE,stderr=subprocess.PIPE)
        try:
            for frame in frames:process.stdin.write(frame.tobytes())
            process.stdin.close();error=process.stderr.read();code=process.wait()
        except BaseException:
            process.kill();process.wait();raise
        if code:raise RuntimeError(error.decode())
        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0',
            '-show_entries','stream=width,height,r_frame_rate,nb_frames,duration','-of','json',str(mp4)]))['streams'][0]
        assert probe['r_frame_rate']=='30/1' and int(probe['nb_frames'])==count,probe
        assert (int(probe['width']),int(probe['height']))==canvas
        reports.append(dict(state=state,fps=fps,frames=count,seconds=seconds,size=list(canvas),
            cat_reference_height=1590*scale,webp_bytes=path.stat().st_size,webp_quality=quality,
            mp4_bytes=mp4.stat().st_size,mist='static',annotation='prévia de movimento, não é a animação final'))
        (folder/(state+'.json')).write_text(json.dumps(dict(metadata=reports[-1],poses=poses),ensure_ascii=False,indent=2)+'\n')
        # Contact sheets for headless inspection; keep them outside deliverables.
        indices=[0,count//6,count//3,count//2,2*count//3,count-1]
        sheet=Image.new('RGB',(620*3,856*2),'black')
        for j,i in enumerate(indices):sheet.paste(frames[i],((j%3)*620,(j//3)*856))
        sheet.save('/tmp/kiwi-T7606-'+state+'-movimento.png')
        print(json.dumps(reports[-1],ensure_ascii=False),flush=True)
    (folder/'manifest.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2)+'\n')
    return reports


def main():
    native={n:Image.open(ASSETS/f'{n}.png').convert('RGBA') for n in NAMES}
    native,preparation=prepare_ears(native)
    report=baseline_check(native)
    report['ear_preparation']=preparation
    if '--previews-only' in sys.argv:
        render_previews(native);return
    assets={n:i.resize((W,H),Image.Resampling.LANCZOS) for n,i in native.items()}
    out=HERE/'quadros';out.mkdir(exist_ok=True)
    # Remove apenas saídas geradas da rodada anterior, que constam do git.
    for name in ['repouso','acordou','ouvindo','thinking','agindo','pronto','erro']:
        for color in ['padrao','claude','codex']:
            for suffix in ['png','txt']:
                old=out/f'{name}-{color}.{suffix}'
                if old.exists():old.unlink()
    for old in out.glob('*.webp'):old.unlink()
    for old in out.glob('*.txt'):old.unlink()
    for old in HERE.glob('estado-*.png'):old.unlink()
    for name in ['cores.png','prancha-estados.png']:
        old=HERE/name
        if old.exists():old.unlink()
    for old in out.glob('*.png'):old.unlink()
    records=[];summaries=[]
    for state,poses in STATES.items():
        tiles=[]
        for j,p in enumerate(poses):
            t=tile(compose(assets,p),p,state,'padrao');filename=f'{state}-{j+1:02}.webp'
            save(t,out/filename);tiles.append(t)
            (out/filename.replace('.webp','.txt')).write_text('REFERÊNCIA DOCUMENTAL — composição local, não geração por IA.\n'
                +'Fonte: gerada/manifest.json e as seis camadas originais.\n'
                +json.dumps(p,ensure_ascii=False,indent=2)+'\nNévoa: '+FOG[state]+'\n')
            records.append(dict(file='quadros/'+filename,state=state,palette='padrao',parameters=p))
        sheet=strip(tiles,state.upper()+' · poses de referência',FOG[state])
        save(sheet,HERE/f'estado-{state}.webp')
        thumb=sheet.copy();thumb.thumbnail((1800,1000),Image.Resampling.LANCZOS)
        summaries.append((state,thumb))
    # Each ear moves alone through the full requested range; the other stays still.
    proof=Image.new('RGB',(W*5,(H+FOOT)*2+150),'black');pd=ImageDraw.Draw(proof)
    pd.text((44,28),'ORELHAS · limite -15 a +15 graus · triângulo quase rígido · independentes',font=font(42),fill='white')
    for row,name in enumerate(['esquerda','direita']):
        for col,angle in enumerate([-15,-7.5,0,7.5,15]):
            args={'left' if row==0 else 'right':angle}
            p=pose(f'{name} {angle:+g} graus / base flexível / outra parada',**args)
            proof.paste(tile(compose(assets,p),p,'prova-orelhas','padrao'),(col*W,150+row*(H+FOOT)))
    proof=proof.resize((7040,round(proof.height*7040/proof.width)),Image.Resampling.LANCZOS)
    save(proof,HERE/'prova-orelhas.webp')
    # Seven freely chosen colors; the last is almost black, lifted by the floor.
    palettes=[('padrao','padrao'),('claude','claude'),('codex','codex'),('verde','#63d997'),('rosa','#ff81c0'),('azul','#70a8ff'),('quase-preto','#030409')]
    colors=Image.new('RGB',(W*7,(H+FOOT)*2+150),'black');d=ImageDraw.Draw(colors)
    d.text((44,28),'CORES LIVRES · preto quase puro recebe piso de luminosidade · aro sempre ciano-púrpura',font=font(42),fill='white')
    for r,(state,p) in enumerate([('repouso',STATES['repouso'][0]),('ouvindo',STATES['ouvindo'][1])]):
        for c,(label,color) in enumerate(palettes):
            t=tile(compose(assets,p,color),p,state,label if color in ['padrao','claude','codex'] else label+' '+color)
            colors.paste(t,(W*c,150+(H+FOOT)*r))
            if color!='padrao':
                filename=f'{state}-{label}.webp';save(t,out/filename)
                (out/filename.replace('.webp','.txt')).write_text('REFERÊNCIA DOCUMENTAL — composição local.\n'
                    +f'Cor: {color}; piso de luminância linear .28; aro ligado à luz, sem mudança de matiz.\n'
                    +json.dumps(p,ensure_ascii=False,indent=2)+'\n')
                records.append(dict(file='quadros/'+filename,state=state,palette=color,parameters=p))
    # Character remains >1024 px tall in this sheet after uniform reduction.
    colors=colors.resize((9856,round(colors.height*9856/colors.width)),Image.Resampling.LANCZOS)
    save(colors,HERE/'cores.webp')
    color_thumb=colors.copy();color_thumb.thumbnail((1800,1000),Image.Resampling.LANCZOS);summaries.append(('cores',color_thumb))
    summary=Image.new('RGB',(3600,5*1160+160),'#08080b');d=ImageDraw.Draw(summary)
    d.text((52,36),'KIWI-CAT · estados / rodada 2 · REFERÊNCIAS, não capturas',font=font(52),fill='white')
    for i,(label,thumb) in enumerate(summaries):
        x=(i%2)*1800;y=160+(i//2)*1160
        d.text((x+38,y+12),label.upper(),font=font(40),fill='white')
        summary.paste(thumb,(x+(1800-thumb.width)//2,y+90))
    save(summary,HERE/'prancha-estados.webp')
    real=Image.new('RGB',(8*360,780),'#08080b');rd=ImageDraw.Draw(real)
    rd.text((20,16),'TAMANHO REAL · gato a 120 px e 240 px · REFERÊNCIA',font=font(24),fill='white')
    chosen={'repouso':0,'dormindo':0,'acordou':1,'ouvindo':1,'thinking':0,'agindo':0,'pronto':0,'erro':2}
    for i,state in enumerate(STATES):
        rd.text((i*360+20,64),state,font=font(23),fill='white')
        image=compose(assets,STATES[state][chosen[state]])
        for height,top in [(120,112),(240,334)]:
            factor=height/((2240-650)*SCALE)
            small=image.resize((round(W*factor),round(H*factor)),Image.Resampling.LANCZOS)
            real.paste(small,(i*360+(360-small.width)//2,top))
            y0=round(top+650*SCALE*factor);y1=y0+height
            rd.line((i*360+12,y0,i*360+12,y1),fill='#666271',width=1)
            for end in [y0,y1]:rd.line((i*360+8,end,i*360+16,end),fill='#666271',width=1)
            rd.text((i*360+20,top+small.height+8),f'gato {height} px',font=font(19),fill='#b6b1c7')
    save(real,HERE/'tamanho-real.webp')
    report.update(real_size=dict(cat_source_y=[650,2240],cat_heights=[120,240],selected_pose=chosen))
    report.update(task='T7606' ,review='#7630',frames=len(records),frame_size=[W,H+FOOT],
                  sources_sha256={n+'.png':hashlib.sha256((ASSETS/(n+'.png')).read_bytes()).hexdigest() for n in NAMES},
                  body_transform='nenhuma; escala global de apresentação 0.75',fog='exposição mínima .50; aro acompanha a menor exposição local sem mudar matiz; cor livre com piso .28; sem blur',
                  states=list(STATES),fog_floor=FOG_FLOOR,color_linear_luminance_floor=.28,arc_rule='gain <= min(local fog gains, 1), hue unchanged')
    if '--stills-only' not in sys.argv:report['previews']=render_previews(native)
    (HERE/'verificacao.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    (HERE/'quadros.json').write_text(json.dumps(dict(referenceOnly=True,method='montar.py — camadas originais',frames=records),ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
