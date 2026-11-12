#!/usr/bin/env python3
"""Check controlled active sweeps; RGB8 tolerances, no performance claims.
Requires Pillow/NumPy. Run from any directory after kiwicat-active-exposure-check.ts.
"""
from pathlib import Path
import json
import sys
import numpy as np
from PIL import Image

repo = Path(__file__).resolve().parents[2]
root = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/kiwi-T8487-active-exposure')
mask = np.asarray(Image.open(repo / 'app/ui/kiwicat/assets/material-mask.webp').resize((640, 800), Image.Resampling.BILINEAR))[:, :, 2] >= 255
results = []
for folder in sorted(p for p in root.iterdir() if p.is_dir()):
    reference = np.asarray(Image.open(folder / 'reference.png').convert('RGB'), dtype=float) / 255
    low, high = reference.min(2), reference.max(2)
    chroma = (high - low) / np.maximum(high, .001)
    core = mask & (chroma > .4) & (low < .65) & (high > .15)
    # In the protected core, fog is neutral and its RGB minimum recovers the
    # background. Screen emission can then be measured independently of the
    # spatial noise or its brightness. Two code levels cover RGB8 quantization.
    emission = (reference - low[:, :, None]) / np.maximum(1 - low[:, :, None], .001)
    previous, minimum, surplus, peak = None, 0, 0, None
    paths = sorted(folder.glob('exposure-*.png'))
    assert len(paths) == 91 and core.sum() > 0
    for path in paths:
        raw = np.asarray(Image.open(path).convert('RGB'), dtype=np.int16)
        if previous is not None:
            minimum = min(minimum, int((raw - previous).min()))
        previous = raw
        output = raw / 255
        background = output.min(2)
        capped = background[:, :, None] + (1 - background[:, :, None]) * emission
        surplus = max(surplus, float(((output - capped) * 255)[core].max()))
        if path.stem == 'exposure-1.26':
            peak = float((np.abs(output - capped) * 255)[core].max())
    results.append(dict(case=folder.name, frames=len(paths), minimum_channel_delta=minimum,
        arc_core_pixels=int(core.sum()), max_channel_surplus_at_unity_emission_cap=surplus,
        peak126_max_absolute_error=peak if 'ouvindo' in folder.name else None))
assert len(results) == 2
assert all(r['minimum_channel_delta'] >= 0 and r['max_channel_surplus_at_unity_emission_cap'] <= 2 for r in results)
assert all(r['peak126_max_absolute_error'] <= 2 for r in results if r['peak126_max_absolute_error'] is not None)
(root / 'pixel-check.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))
