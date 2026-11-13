# The v2 silhouette, traced by hand as a symmetric bezier outline (canvas 2048 x 2560), for the ghost field.
import numpy as np
from render import path_pts, mirror

def outline(P=None):
    P = P or {}
    tip = P.get("tip", (545, 680))
    # left half, from the top centre going left and down to the bottom centre
    segs = [
        (1023, P.get("notch", 845)),
        ((995, 845), (970, 836), (945, 822)),                 # the soft V between the ears
        ((820, 760), (660, 715), tip),                         # inner ear edge, a long straight-ish line up to the tip
        ((tip[0] - 22, tip[1] + 70), (562, 900), (572, 1080)), # outer ear edge, nearly vertical
        ((580, 1200), (590, 1330), (585, 1440)),               # head side at the eyes
        ((578, 1560), (520, 1700), (515, 1820)),               # the bell flares below the cheeks
        ((510, 1940), (620, 2040), (800, 2062)),               # base (it dissolves into wisps in the shader)
        ((900, 2070), (980, 2072), (1023, 2072)),
    ]
    return mirror(segs)
