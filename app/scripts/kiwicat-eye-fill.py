"""Derive an eye-free reference using the approved board's harmonic fill.
Only the old eye discs+5px change; no source asset is overwritten.
"""
from pathlib import Path
import importlib.util, hashlib,json
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parents[2]
script=root/'docs/brand/kiwi-cat/estados/montar.py'
spec=importlib.util.spec_from_file_location('approved_board',script)
board=importlib.util.module_from_spec(spec);spec.loader.exec_module(board)
source=root/'app/ui/kiwicat/assets/reference.webp'
image=Image.open(source).convert('RGB');filled=board.fill_hidden_eyes(image,1)
a=np.array(image);b=np.array(filled)
y,x=np.ogrid[:image.height,:image.width];outside=np.ones(a.shape[:2],bool)
for e in board.META['eyes']:outside&=(x-e['cx'])**2+(y-e['cy'])**2>(e['r']+5)**2
assert np.array_equal(a[outside],b[outside])
out=source.with_name('reference-no-eyes.webp');filled.save(out,format='WEBP',lossless=True,method=6)
assert np.array_equal(np.array(Image.open(out).convert('RGB')),b)
report={'method':'existing approved montar.py fill_hidden_eyes; boundary-matched harmonic fill only inside source eye discs+5px','outside_eye_discs_max_channel_error':0,'size':list(image.size),'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'derived_sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'bytes':out.stat().st_size,'source_unchanged':True}
(root/'docs/brand/kiwi-cat/caretas/preenchimento-olhos.json').write_text(json.dumps(report,indent=2)+'\n')
print(report)
