#!/usr/bin/env python3
"""T10367: assemble real WebKit captures; lossless PNGs remain the pixel evidence."""
from pathlib import Path
import json,sys
import numpy as np
from PIL import Image,ImageDraw,ImageFont
source=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',20)
small=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',17)
width,height,left,header=320,400,170,50
sheet=Image.new('RGB',(left+6*width,header+2*(height+40)),'#eee');d=ImageDraw.Draw(sheet)
comparisons=[]
for curve in ['ellipse','superellipse']:
 for state in ['agindo','acordou','erro']:
  fg=Image.open(source/f'{curve}-{state}-rgba.png').convert('RGBA')
  assert fg.getpixel((320,480))[3]==255 and max(fg.getpixel((320,480))[:3])<64
  for name,color in [('cor','#367a8e'),('branco','#fff')]:
   composed=Image.alpha_composite(Image.new('RGBA',fg.size,color),fg).convert('RGB')
   actual=Image.open(source/f'{curve}-{state}-{name}.png').convert('RGB')
   delta=np.abs(np.asarray(composed,dtype=np.int16)-np.asarray(actual,dtype=np.int16))
   row=dict(curve=curve,state=state,background=name,max=int(delta.max()),mean=float(delta.mean()))
   assert row['max']<=2,row
   comparisons.append(row);composed.save(source/f'{curve}-{state}-{name}-composed.png')
(out/'composicao-vs-webkit.json').write_text(json.dumps(comparisons,indent=2)+'\n')
columns=[(state,bg) for state in ['agindo','acordou','erro'] for bg in ['cor','branco']]
for col,(state,bg) in enumerate(columns):d.text((left+col*width+12,15),f'{state} / {bg}',font=font,fill='#111')
for row,(curve,title) in enumerate([('ellipse','Elipse (p2)'),('superellipse','Superelipse (p4)')]):
 y=header+row*(height+40);d.text((10,y+175),title,font=small,fill='#111')
 for col,(state,bg) in enumerate(columns):
  im=Image.open(source/f'{curve}-{state}-{bg}-composed.png').convert('RGB');assert im.size==(640,800)
  sheet.paste(im.resize((width,height),Image.Resampling.LANCZOS),(left+col*width,y))
 d.text((left+12,y+height+8),'Relogio controlado, semente17; mesma pose e instante nas duas curvas e nos dois fundos.',font=small,fill='#333')
sheet.save(out/'curvas-elipse-superelipse.webp',quality=92,method=6)
(out/'capturas-escolha.json').write_text((source/'capture.json').read_text())
print(out/'curvas-elipse-superelipse.webp')
