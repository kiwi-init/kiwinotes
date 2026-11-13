#!/usr/bin/env python3
"""T10437: real module beside the approved reference, plus actual 120px strip."""
from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import json,sys
raw=Path(sys.argv[1]);revision=Path(sys.argv[3]) if len(sys.argv)>3 else raw;out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
ref=Image.open(out/'simbolos-redesenhados.webp').convert('RGB')
font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',22)
states=['dormindo','acordou','ouvindo','thinking','agindo','pronto','erro']
sheet=Image.new('RGB',(2240,4*440),'#eee');d=ImageDraw.Draw(sheet)
for row,(theme,kind,label) in enumerate([('dark','reference','Referencia aprovada / escuro'),('dark','actual','Modulo real / escuro (olhos e nevoa atuais)'),('light','reference','Referencia aprovada / claro'),('light','actual','Modulo real / claro (olhos e nevoa atuais)')]):
 top=row*440;bg='#111113' if theme=='dark' else '#fff';d.rectangle((0,top,2240,top+440),fill=bg);d.text((15,top+8),label,font=font,fill='#eee' if theme=='dark' else '#222')
 for col,state in enumerate(states):
  tile=Image.new('RGB',(320,400),bg)
  if kind=='reference':
   y=500 if theme=='dark' else 950
   crop=ref.crop((col*320,y,(col+1)*320,min(y+400,ref.height)));tile.paste(crop,(0,0))
  else:
   im=Image.open((revision if state=='thinking' else raw)/f'800-{theme}-{state}.png').convert('RGB');im=im.resize((350,420),Image.Resampling.LANCZOS);tile.paste(im,(-15,-35))
  sheet.paste(tile,(col*320,top+40))
sheet.save(out/'comparacao-gato-referencia.webp',quality=92,method=6)
order=['erro','ouvindo','pronto','dormindo','agindo','acordou','thinking']
strip=Image.new('RGB',(7*160,320))
for row,theme in enumerate(['dark','light']):
 for col,state in enumerate(order):
  im=Image.open((revision if state=='thinking' else raw)/f'120-{theme}-{state}.png').convert('RGB');assert im.size==(160,160);strip.paste(im,(col*160,row*160))
strip.save(out/'tira-120px-sem-legenda.webp',lossless=True,method=6)
(out/'capturas-modulo.json').write_text((raw/'capture.json').read_text())
(out/'ordem-tira.json').write_text(json.dumps(order)+'\n')
print(out/'comparacao-gato-referencia.webp');print(out/'tira-120px-sem-legenda.webp')

if revision!=raw:(out/'capturas-thinking-r2.json').write_text((revision/'capture.json').read_text())
