#!/usr/bin/env python3
"""Compose actual RGBA screenshots; no re-drawing, retiming or interpolation."""
import json,os,subprocess,sys,hashlib
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import numpy as np
manifest=json.load(open(sys.argv[1]));out=Path(sys.argv[2]);hub=Path(sys.argv[3]);raw=Path(manifest['raw'])
font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',17)
reports=[]
# First exported sample vs true WebKit backgrounds, without labels or resize.
first=manifest['scenes'][0];firstRoot=Path(first['directory'])
firstRGBA=Image.open(firstRoot/first['frames'][0]).convert('RGBA')
comparisons=[]
for name,color in [('branco','#fff'),('preto','#000'),('cor','#367a8e')]:
    composed=Image.alpha_composite(Image.new('RGBA',firstRGBA.size,color),firstRGBA).convert('RGB')
    actual=Image.open(firstRoot/f'webkit-{name}.png').convert('RGB')
    delta=np.abs(np.asarray(composed,dtype=np.int16)-np.asarray(actual,dtype=np.int16))
    row=dict(background=name,max=int(delta.max()),mean=float(delta.mean()),instant=0)
    assert row['max']<=2,row
    comparisons.append(row)
(out/'compose-vs-webkit.json').write_text(json.dumps(comparisons,indent=2)+'\n')
print('RGBA composition compared with WebKit',comparisons,flush=True)
for scene in [s for s in manifest['scenes'] if s['state']!='hub']:
    root=Path(scene['directory']);sequence=root/'composed';sequence.mkdir(exist_ok=True)
    encoded={};corner_max=0;body_min=255;body_rgb_max=0;far_max=0
    for index,source in enumerate(scene['frames']):
        target=sequence/f'{index:06d}.png'
        if source in encoded:
            os.link(encoded[source],target);continue
        fg=Image.open(root/source).convert('RGBA')
        corner_max=max(corner_max,fg.getpixel((0,0))[3]);body=fg.getpixel((320,480));body_min=min(body_min,body[3]);body_rgb_max=max(body_rgb_max,*body[:3])
        assert fg.getpixel((0,0))[3]==0,(scene['state'],index,'opaque corner')
        assert body[3]==255 and max(body[:3])<64,(scene['state'],index,'invalid coat',body)
        far_max=max(far_max,*[fg.getpixel(pt)[3] for pt in [(64,200),(320,64),(64,735),(575,735)]])
        canvas=Image.new('RGB',(1920,800))
        for col,(name,color) in enumerate([('branco','#fff'),('preto','#000'),('cor','#367a8e')]):
            bg=Image.new('RGBA',fg.size,color);tile=Image.alpha_composite(bg,fg).convert('RGB');ImageDraw.Draw(tile).text((12,12),name,font=font,fill='black' if col==0 else 'white');canvas.paste(tile,(col*640,0))
        canvas.save(target);encoded[source]=target
    output=out/(scene['state']+'.mp4')
    subprocess.run(['ffmpeg','-v','error','-y','-framerate',str(scene['fps']),'-i',str(sequence/'%06d.png'),'-an','-c:v','libx264','-preset','medium','-crf','18','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',str(output)],check=True)
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=width,height,r_frame_rate,nb_frames:format=duration,size','-of','json',str(output)]))
    assert int(probe['streams'][0]['nb_frames'])==len(scene['frames']),probe
    reports.append(dict(state=scene['state'],seconds=scene['seconds'],uniqueFrames=len(encoded),repeatedFrames=len(scene['frames'])-len(encoded),cornerMax=corner_max,bodyMin=body_min,bodyRGBMax=body_rgb_max,farMaxAlpha=far_max,probe=probe,sha256=hashlib.sha256(output.read_bytes()).hexdigest()))
    print(scene['state'],'encoded',len(scene['frames']),'frames','farMaxAlpha',far_max,flush=True)
# Repouso on real headless hub captures: same selected RGBA frames scaled to120px.
scene=next(s for s in manifest['scenes'] if s['state']=='hub');root=Path(scene['directory']);sequence=raw/'hub-composed';sequence.mkdir(exist_ok=True);encoded={}
for index,source in enumerate(scene['frames'][:int(scene['seconds']*manifest['fps'])]):
    target=sequence/f'{index:06d}.png'
    if source in encoded:os.link(encoded[source],target);continue
    fg=Image.open(root/source).convert('RGBA')
    assert fg.size==(96,120) and fg.getpixel((48,72))[3]==255
    assert max(fg.getpixel((48,72))[:3])<64
    canvas=Image.new('RGB',(2000,740))
    for col,theme in enumerate(['light','dark']):
        bg=Image.open(hub/f'hub-{theme}.png').convert('RGBA');bg.alpha_composite(fg,(1000-96-12,740-120-12));canvas.paste(bg.convert('RGB'),(col*1000,0))
    ImageDraw.Draw(canvas).text((12,12),'Composicao120px sobre capturas reais do hub: claro / escuro',font=font,fill='black');canvas.save(target);encoded[source]=target
output=out/'hub.mp4'
subprocess.run(['ffmpeg','-v','error','-y','-framerate',str(manifest['fps']),'-i',str(sequence/'%06d.png'),'-an','-c:v','libx264','-preset','medium','-crf','18','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',str(output)],check=True)
hubProbe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=width,height,r_frame_rate,nb_frames:format=duration,size','-of','json',str(output)]))
assert int(hubProbe['streams'][0]['nb_frames'])==len(scene['frames']),hubProbe
reports.append(dict(state='hub',seconds=scene['seconds'],probe=hubProbe,scope='same actual 96x120 WebKit RGBA sample over real headless hub screenshots',sha256=hashlib.sha256(output.read_bytes()).hexdigest()))
(out/'manifest.json').write_text(json.dumps(dict(task='T9708',scope=manifest['scope'],fps=manifest['fps'],seed=17,backing='leve',raw=manifest['raw'],compositionComparison=comparisons,scenes=reports),indent=2)+'\n')
