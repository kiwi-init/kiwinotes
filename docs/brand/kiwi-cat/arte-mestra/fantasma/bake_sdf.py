# Bake the traced outline's signed distance field (canvas units, negative inside) at 512 x 640 for the ghost shader.
import sys, base64, json; sys.path.insert(0, ".")
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd
from ghost_shape import outline
S = 0.5
im = Image.new("L", (int(2048 * S), int(2560 * S)), 0)
ImageDraw.Draw(im).polygon([(x * S, y * S) for x, y in outline()], fill=255)
m = np.asarray(im) > 127
d = (nd.distance_transform_edt(~m) - nd.distance_transform_edt(m)) / S
d = d.reshape(640, 2, 512, 2).mean((1, 3)).astype(np.float32)
open(sys.argv[1] if len(sys.argv) > 1 else "sdf.json", "w").write(json.dumps({"w": 512, "h": 640, "data": base64.b64encode(d.tobytes()).decode()}))
