# Compare scheduling candidates against a previously captured approved source.
# Usage: python kiwicat-verify-scheduling.py BEFORE_DIR AFTER_DIR
import json, pathlib, subprocess, sys, numpy as np
from PIL import Image
before=pathlib.Path(sys.argv[1])
after=pathlib.Path(sys.argv[2])
diffs=[int(np.abs(np.array(Image.open(p).convert('RGB')).astype(int)-np.array(Image.open(after/p.name).convert('RGB')).astype(int)).max()) for p in before.glob('*.png')]
assert len(diffs)==15 and max(diffs)==0, diffs
r=json.loads((after/'report.json').read_text())
def frame(video,t):
    raw=subprocess.check_output(['ffmpeg','-v','error','-ss',str(t),'-i',str(after/video),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
    return np.frombuffer(raw,np.uint8).reshape(800,640,3)
colours=[frame('reduced-colour.webm',r['fixed'][k]).mean(axis=(0,1)) for k in ['sampleBefore','sampleAfter']]
change=float((colours[1][0]-colours[1][2])-(colours[0][0]-colours[0][2]))
assert change>5
idle=[frame('native-idle.webm',t) for t in [.8,2.8,5.8]]
idle_diff=[float(np.abs(idle[i].astype(int)-idle[0].astype(int)).mean()) for i in [1,2]]
assert min(idle_diff)>.02, idle_diff
sheet=Image.new('RGB',(640*3,800))
for i,a in enumerate(idle): sheet.paste(Image.fromarray(a),(i*640,0))
sheet.resize((960,400)).save(after/'native-idle-contact.webp')
result={'controlled_frames':15,'max_channel_difference':0,'native_reduced_colour_means':[x.tolist() for x in colours],'red_minus_blue_change':change,'native_idle_sample_seconds':[.8,2.8,5.8],'native_idle_mean_absolute_change':idle_diff,'live_stats':r['live'],'live_hidden_no_draw':r['liveHiddenNoDraw'],'scope':'Native video without screenshots/capture calls; controlled frames pixel-identical to5a78555; not a performance run'}
(after/'verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
