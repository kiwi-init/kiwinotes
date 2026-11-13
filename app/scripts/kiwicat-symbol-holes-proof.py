#!/usr/bin/env python3
"""T10437 r2: verify actual mask alpha and show it over colour and real hub shots."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,sys,numpy as np
raw=Path(sys.argv[1]);out=Path(sys.argv[2]);hub=Path(sys.argv[3]);out.mkdir(parents=True,exist_ok=True)
r=json.load(open(raw/'capture.json'));checks=[]
def block(im,p):
 x,y=int(p['x']),int(p['y']);return np.asarray(im)[y-1:y+2,x-1:x+2]
for row in r['rows']:
 if row['kind']=='svg-only':
  im=Image.open(raw/row['file']).convert('RGBA');expected=round(255*(1-row['opacity']))
  actual=[int(block(im,p)[:,:,3].mean()) for p in row['points']]
  for value in actual:assert abs(value-expected)<=1,(row,value,expected)
  assert int(block(im,row['solid'])[:,:,3].min())==255
  checks.append(dict(theme=row['theme'],opacity=row['opacity'],expectedAlpha=expected,actualAlpha=actual))
font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',20)
blueSheet=Image.new('RGB',(768,504),'#eee');appSheet=Image.new('RGB',(2000,780),'#eee');draw=ImageDraw.Draw(blueSheet);draw2=ImageDraw.Draw(appSheet)
for col,theme in enumerate(['dark','light']):
 row=next(x for x in r['rows'] if x['kind']=='rgba' and x['theme']==theme)
 fg=Image.open(raw/row['file']).convert('RGBA');control=Image.open(raw/f'{theme}-control-1.png').convert('RGBA')
 for p in row['points']:assert int(abs(block(fg,p).astype(int)-block(control,p).astype(int)).max())<=1
 blue=Image.alpha_composite(Image.new('RGBA',fg.size,'#367a8e'),fg).convert('RGB');actual=Image.open(raw/f'{theme}-blue-1.png').convert('RGB')
 delta=abs(np.asarray(blue,dtype=np.int16)-np.asarray(actual,dtype=np.int16));assert int(delta.max())<=2,(theme,int(delta.max()))
 blueSheet.paste(blue,(col*384,40));draw.text((col*384+10,10),f'{theme}: furos sobre azul',font=font,fill='#111')
 bg=Image.open(hub/f'hub-{theme}.png').convert('RGBA');position=(580,200)
 app=bg.copy();app.alpha_composite(fg,position);appControl=bg.copy();appControl.alpha_composite(control,position)
 for p in row['points']:
  shifted=dict(x=p['x']+position[0],y=p['y']+position[1]);assert int(abs(block(app,shifted).astype(int)-block(appControl,shifted).astype(int)).max())<=1
 appSheet.paste(app.convert('RGB'),(col*1000,40));draw2.text((col*1000+10,10),f'{theme}: composicao sobre captura real do hub headless',font=font,fill='#111')
 checks.append(dict(theme=theme,blueCompositionMax=int(delta.max()),holePixelsMatchUnderlyingBodyAndHub=True,hubSource=str(hub/f'hub-{theme}.png')))
blueSheet.save(out/'thinking-furos-azul.webp',quality=92,method=6);appSheet.save(out/'thinking-furos-hub.webp',quality=92,method=6)
(out/'thinking-furos-verificacao.json').write_text(json.dumps(dict(task='T10437',revision=2,checks=checks),indent=2)+'\n')
print('True mask holes, animated alpha, blue and actual hub background checks passed')
