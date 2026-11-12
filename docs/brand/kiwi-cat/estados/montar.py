#!/usr/bin/env python3
"""T7606, revisão #7630: pranchas documentais com as camadas aprovadas.
Não é código de animação nem captura do app. Sem rede, blur ou geração de gato.
"""
from pathlib import Path
import hashlib
import io
import math
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFont

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
for j,p in enumerate(STATES['acordou']):p.update(symbol='alert',big=[1,1.24,1.10][j],phase=j)
for j,p in enumerate(STATES['ouvindo']):p.update(symbol='sound',phase=j)
for j,p in enumerate(STATES['thinking']):p.update(eye=.58,up=-24,symbol='thought',phase=j)
for j,p in enumerate(STATES['agindo']):p.update(symbol='work',phase=j)
for j,p in enumerate(STATES['pronto']):p.update(symbol='spark',blink=True,phase=j)
STATES['erro']=[pose('A · dúvida / ? e gota',left=4,right=-3,big=.72,small=.62,symbol='question',fog=.68),pose('B · confusão / rabisco',left=7,right=-5,big=.67,small=.68,symbol='confusion',fog=.52),pose('A · recolher e aguardar',left=6,right=-4,big=.62,small=.62,symbol='question',fog=.30,phase=1)]
STATES={k:STATES[k] for k in ['repouso','dormindo','acordou','ouvindo','thinking','agindo','pronto','erro']}

FOG = {
 'repouso': 'Massa original; densidade 1,00 → 0,94 → 0,90. Sem deslocamento.',
 'acordou': 'Densidade 0,82 → 1,16 → 1,02; sobe a luz acima da cabeça no pico.',
 'ouvindo': 'Densidade 0,66 → 1,26; voz alta ocupa mais o volume já existente.',
 'thinking': 'Densidade 0,95; peso desloca da esquerda à direita e concentra no alto.',
 'agindo': 'Densidade 1,12; peso lateral alterna com olhos retos, sem expressão de raiva.',
 'pronto': 'Densidade 1,06 → 0,96; expansão de luz na piscada, depois assenta.',
 'erro': 'Densidade de 0,68 para 0,52 e 0,30; perde luz sem expor cortes retos.',
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
            d.arc((cx-r,cy-r*.45,cx+r,cy+r*.65),*( (10,170) if p['symbol']=='sleep' else (190,350) ),fill='white',width=max(2,round(9*scale*2)))
        else:
            mask = Image.new('L',image.size)
            md=ImageDraw.Draw(mask);md.ellipse((cx-r,cy-r,cx+r,cy+r),fill=255)
            if opening<1:
                md.rectangle((cx-r-1,cy-r-1,cx+r+1,cy+r-2*r*opening),fill=0)
            white=Image.new('RGBA',image.size,'white');white.putalpha(mask)
            image=Image.alpha_composite(image,white)
    return image.resize(size,Image.Resampling.LANCZOS)


def fog_layer(image,p,palette,arc):
    if palette=='padrao' and p['fog']==1 and p['side']==0 and p['upper']==0:return image
    a=np.array(image);rgb=a[:,:,:3].astype(np.float32)
    lum=rgb@np.array([.2126,.7152,.0722],dtype=np.float32)
    # Continuous chroma protection, independent of the old layer cuts.
    chroma=(rgb.max(axis=2)-rgb.min(axis=2))/np.maximum(rgb.max(axis=2),1)
    t=np.clip((chroma-.28)/.27,0,1);protect=t*t*(3-2*t)
    mask=np.maximum(lum-12,0)/np.maximum(lum,1)*(1-protect)
    y,x=np.ogrid[:image.height,:image.width]
    weight=p['fog']*(1+p['side']*(x/image.width-.5)*2+p['upper']*(.5-y/image.height)*2)
    # An exposure around a dark floor is monotonic in luminance: dimming
    # cannot turn a bright fog band darker than its own faint outskirts.
    mist=rgb*weight[:,:,None]
    if palette!='padrao':
        tint=np.array([1.55,.79,.40] if palette=='claude' else [1.01,1.01,1.04])
        mist=lum[:,:,None]*tint*weight[:,:,None]
    a[:,:,:3]=np.uint8(np.rint(np.clip(rgb*(1-mask[:,:,None])+mist*mask[:,:,None],0,255)))
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


def compose(assets,p,palette='padrao',scale=SCALE):
    size=assets['cabeca'].size
    out=Image.new('RGBA',size,'black')
    for name in NAMES:
        layer=assets[name]
        if name.startswith('orelha'):
            angle=p['left'] if name.endswith('esquerda') else p['right']
            if angle:
                pivot=tuple(v*scale for v in META['pivots'][name])
                layer=layer.rotate(angle,Image.Resampling.BICUBIC,center=pivot)
        out=Image.alpha_composite(out,layer)
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
    for quality in [90,86,82,78,74,70,64,58]:
        data=io.BytesIO();image.save(data,format='WEBP',quality=quality,method=6)
        if data.tell()<=500_000:
            path.write_bytes(data.getvalue());return
    raise ValueError(f'Imagem maior que 500 KB: {path}')


def symbol_layer(size,scale,p):
    im=Image.new('RGBA',(size[0]*2,size[1]*2));d=ImageDraw.Draw(im)
    k=scale*2;kind=p['symbol'];phase=p['phase'];white='#ffffff'
    def points(ps):return [(x*k,y*k) for x,y in ps]
    def line(ps,width=14):
        ps=points(ps);w=max(2,round(width*k));d.line(ps,fill=white,width=w,joint='curve')
        for x,y in [ps[0],ps[-1]]:d.ellipse((x-w/2,y-w/2,x+w/2,y+w/2),fill=white)
    def ellipse(box,width=12,fill=None):
        d.ellipse(tuple(v*k for v in box),outline=white,fill=fill,width=round(width*k))
    def drop(x,y):
        ps=[]
        for t in np.linspace(0,2*math.pi,100):
            ps.append((x+29*math.sin(t)*(1-math.cos(t)/2),y+50*math.cos(t)))
        line(ps+[ps[0]],10)
    def star(x,y,r=45):
        ps=[(x,y-r),(x+10,y-10),(x+r,y),(x+10,y+10),(x,y+r),(x-10,y+10),(x-r,y),(x-10,y-10),(x,y-r)]
        line(ps,9)
    if kind=='alert':
        x=1710;y=670-[0,85,25][phase];line([(x,y-70),(x,y+30)],24);ellipse((x-13,y+66,x+13,y+92),fill=white)
    elif kind=='sleep':
        for x,y,z in [(1640,730-phase*60,45),(1800,550-phase*90,65)]:
            line([(x-z/2,y-z/2),(x+z/2,y-z/2),(x-z/2,y+z/2),(x+z/2,y+z/2)],13)
    elif kind=='sound':
        for j in range(1,2+phase*2):
            x=1590;y=930;r=45+j*48
            d.arc(tuple(v*k for v in (x-r,y-r,x+r,y+r)),-55,55,fill=white,width=round(12*k))
    elif kind=='thought':
        ellipse((1570,450,1960,700),10)
        ellipse((1570,725,1610,765),8);ellipse((1545,790,1565,810),6)
        for j in range(3):
            x=1660+j*100;r=13 if j<=phase else 6
            ellipse((x-r,575-r,x+r,575+r),fill=white)
    elif kind=='work':
        drop(1680,820+phase*35);drop(1810,1010+phase*45)
        for j in range(3):line([(245-j*20,1030+j*90),(375-j*20,1030+j*90)],10)
    elif kind=='spark':
        for x,y,r in [(350,1050,45),(1710,780,55),(1790,1210,32)]:star(x,y,r+(7 if phase else 0))
    elif kind=='question':
        # Cubic curve for a clean rounded question mark.
        controls=[[(1630,610),(1625,480),(1840,470),(1830,600)],[(1830,600),(1820,680),(1720,650),(1720,750)]]
        ps=[]
        for c in controls:
            c=np.array(c)
            for t in np.linspace(0,1,60):ps.append(tuple((1-t)**3*c[0]+3*(1-t)**2*t*c[1]+3*(1-t)*t*t*c[2]+t**3*c[3]))
        line(ps,19);ellipse((1707,790,1733,816),fill=white);drop(1830,900)
    elif kind=='confusion':
        ps=[]
        for t in np.linspace(0,7*math.pi,240):
            ps.append((1740+110*math.cos(t),650+60*math.sin(t)+28*math.sin(t*1.65)))
        line(ps,10)
    return im.resize(size,Image.Resampling.LANCZOS)


def main():
    native={n:Image.open(ASSETS/f'{n}.png').convert('RGBA') for n in NAMES}
    report=baseline_check(native)
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
    # Uma imagem de cores: duas linhas, repouso e pico de voz, três paletas.
    colors=Image.new('RGB',(W*3,(H+FOOT)*2+150),'black');d=ImageDraw.Draw(colors)
    d.text((44,28),'CORES · só a névoa muda; cabeça, corpo e aro permanecem iguais',font=font(42),fill='white')
    for r,(state,p) in enumerate([('repouso',STATES['repouso'][0]),('ouvindo',STATES['ouvindo'][1])]):
        for c,color in enumerate(['padrao','claude','codex']):
            t=tile(compose(assets,p,color),p,state,color)
            colors.paste(t,(W*c,150+(H+FOOT)*r))
            if color!='padrao':
                filename=f'{state}-{color}.webp';save(t,out/filename)
                (out/filename.replace('.webp','.txt')).write_text('REFERÊNCIA DOCUMENTAL — composição local, sem IA.\n'
                    +f'Paleta: {color}. Somente a névoa visível recebe matiz; silhueta fosca, aro, olhos e símbolos são protegidos.\n'
                    +json.dumps(p,ensure_ascii=False,indent=2)+'\n')
                records.append(dict(file='quadros/'+filename,state=state,palette=color,parameters=p))
    save(colors,HERE/'cores.webp')
    color_thumb=colors.copy();color_thumb.thumbnail((1800,1000),Image.Resampling.LANCZOS);summaries.append(('cores',color_thumb))
    summary=Image.new('RGB',(3600,5*1160+160),'#08080b');d=ImageDraw.Draw(summary)
    d.text((52,36),'KIWI-CAT · estados / rodada 2 · REFERÊNCIAS, não capturas',font=font(52),fill='white')
    for i,(label,thumb) in enumerate(summaries):
        x=(i%2)*1800;y=160+(i//2)*1160
        d.text((x+38,y+12),label.upper(),font=font(40),fill='white')
        summary.paste(thumb,(x+(1800-thumb.width)//2,y+90))
    save(summary,HERE/'prancha-estados.webp')
    report.update(task='T7606',review='#7630',frames=len(records),frame_size=[W,H+FOOT],
                  sources_sha256={n+'.png':hashlib.sha256((ASSETS/(n+'.png')).read_bytes()).hexdigest() for n in NAMES},
                  body_transform='nenhuma; escala global de apresentação 0.75',fog='densidade e matiz da névoa visível após composição; silhueta fosca e aro protegidos; sem blur',
                  states=list(STATES))
    (HERE/'verificacao.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    (HERE/'quadros.json').write_text(json.dumps(dict(referenceOnly=True,method='montar.py — camadas originais',frames=records),ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
