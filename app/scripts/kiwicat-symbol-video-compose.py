#!/usr/bin/env python3
"""T10437: source-over real theme RGBA samples, repeat actual unchanged frames."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,sys,os,subprocess,hashlib
capture=json.load(open(sys.argv[1]));out=Path(sys.argv[2]);font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',18);reports=[]
for scene in capture['scenes']:
 sequence=Path(capture['raw'])/(scene['state']+'-composed');sequence.mkdir(exist_ok=True);cache={}
 dark,light=scene['themes'];assert len(dark['frames'])==len(light['frames'])
 for n,(ds,ls) in enumerate(zip(dark['frames'],light['frames'])):
  target=sequence/f'{n:06d}.png';key=(ds,ls)
  if key in cache:os.link(cache[key],target);continue
  canvas=Image.new('RGB',(1440,880));
  for col,(theme,source,bg,label) in enumerate([(dark,ds,'#111113','escuro'),(light,ls,'#fff','claro')]):
   fg=Image.open(Path(theme['dir'])/source).convert('RGBA');assert fg.size==(720,880)
   coat=fg.getpixel((360,520));assert coat[3]==255 and max(coat[:3])<64,(scene['state'],n,coat)
   image=Image.alpha_composite(Image.new('RGBA',fg.size,bg),fg).convert('RGB');ImageDraw.Draw(image).text((12,12),label,font=font,fill='white' if col==0 else '#17171c');canvas.paste(image,(col*720,0))
  canvas.save(target);cache[key]=target
 output=out/(scene['state']+'.mp4')
 subprocess.run(['ffmpeg','-v','error','-y','-framerate',str(capture['fps']),'-i',str(sequence/'%06d.png'),'-an','-c:v','libx264','-preset','medium','-crf','18','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',str(output)],check=True)
 probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=width,height,r_frame_rate,nb_frames:format=duration,size','-of','json',str(output)]));assert int(probe['streams'][0]['nb_frames'])==len(dark['frames'])
 reports.append(dict(state=scene['state'],seconds=scene['seconds'],uniqueFrames=len(cache),probe=probe,sha256=hashlib.sha256(output.read_bytes()).hexdigest()));print(scene['state'],'encoded',flush=True)
(out/'manifest.json').write_text(json.dumps(dict(task='T10437',scope=capture['scope'],fps=capture['fps'],sameTimeline=True,scenes=reports),indent=2)+'\n')
