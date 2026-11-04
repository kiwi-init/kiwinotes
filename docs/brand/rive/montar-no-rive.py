# O Kiwi-cat de frente no Rive (T3151): as camadas da referência (recortar-referencia.ts) e a névoa do earnest-walrus
# (nevoa/manifest.json), no espaço da foto 512×640 escalado 1,6 com o centro da cabeça em (512, 430) do palco.
# O grupo "gato" fica no ponto da foto (256, 320); cada imagem vai no deslocamento do centro dela até esse ponto.
import json, subprocess, sys, os
# O cliente MCP (rive.py) e a lista dos assets enviados (rive-v3-assets.txt) ficam numa pasta de trabalho: KIWI_RIVE_DIR.
S = os.environ.get("KIWI_RIVE_DIR", os.path.dirname(os.path.abspath(__file__)))
R = os.path.dirname(os.path.abspath(__file__))
def t(name, args):
    out = subprocess.run([sys.executable, os.path.join(S, "rive-mcp.py") if os.path.exists(os.path.join(S, "rive-mcp.py")) else os.path.join(S, "rive.py"), "t", name, json.dumps(args)], capture_output=True, text=True, env={**os.environ, "MAX": "4000"}).stdout.strip()
    if "[isError]" in out or not out.startswith("{"): raise SystemExit(f"{name} falhou: {out[:500]}\n{json.dumps(args)[:300]}")
    return json.loads(out.splitlines()[0])
A = {l.split()[1]: l.split()[0] for l in open(os.path.join(S, "rive-v3-assets.txt")) if l.strip()}
AB = "2-18"
K = 1.6
CX, CY = 256, 320
def node(name, parent, x=0, y=0, scale=100):
    g = t("group_editor", {"name": name, "parentId": parent})["group"]["id"]
    # O group_editor compensa a transformação do pai: zera e põe a nossa.
    t("set_property_values", {"propertyValues": {g: {"13": x, "14": y, "16": scale, "17": scale}}})
    return g
def img(asset, parent, x, y, name=None):
    return t("assets_tool", {"command": "addImageInstance", "data": {"addImageInstance": {"assetId": A[asset], "parentId": parent, "name": name or asset, "x": x, "y": y}}})["imageId"]
gato = node("gato", AB, 102.4 + CX * K, -98 + CY * K, K * 100)
ids = {"gato": gato}
order = []
# Luzes atrás de tudo (as das orelhas vão nos grupos delas)
for n in ["luz-corpo", "luz-cabeca"]:
    ids[n] = img(n, gato, 0, 0); order.append(ids[n])
# Corpo e manchas da névoa (o corpo num grupo com o pivô na base, para a respiração)
manifest = json.load(open(os.path.join(R, "nevoa", "manifest.json")))
box = {m["name"]: m for m in manifest}
cb = box["corpo"]
corpo = node("corpo", gato, cb["x"] + cb["w"] / 2 - CX, cb["y"] + cb["h"] * 0.8 - CY)
ids["corpo"] = corpo; order.append(corpo)
ids["corpo-img"] = img("corpo", corpo, 0, -cb["h"] * 0.3)
nevoa = node("nevoa-cor", gato); ids["nevoa-cor"] = nevoa; order.append(nevoa)
for m in manifest[1:]:
    ids[m["name"]] = img(m["name"], nevoa, m["x"] + m["w"] / 2 - CX, m["y"] + m["h"] / 2 - CY)
# Orelhas: o grupo no pivô (a base), a imagem e a luz deslocadas para o centro da foto ficar no lugar.
for side, piv in (("esquerda", (205, 265)), ("direita", (2 * CX - 1 - 205, 265))):
    g = node(f"ear-{'left' if side == 'esquerda' else 'right'}", gato, piv[0] - CX, piv[1] - CY)
    ids[f"orelha-{side}"] = g; order.append(g)
    img(f"luz-orelha-{side}", g, CX - piv[0], CY - piv[1])
    img(f"orelha-{side}", g, CX - piv[0], CY - piv[1])
head = node("head", gato); ids["head"] = head; order.append(head)
img("cabeca", head, 0, 0)
ids["brilho"] = img("brilho", head, 0, 0)
eyes = node("eyes", head)
r = t("path_editor", {"command": "createParametricShapes", "data": {"createParametricShapes": {"shapes": [
    {"primitive": "ellipse", "name": "eye-left", "parentId": eyes, "x": -55, "y": 0, "width": 34, "height": 34, "paints": [{"paintType": "fill", "color": "#FFFFFF"}]},
    {"primitive": "ellipse", "name": "eye-right", "parentId": eyes, "x": 55, "y": 0, "width": 34, "height": 34, "paints": [{"paintType": "fill", "color": "#FFFFFF"}]}]}}})
ids["eyes"] = eyes
ids.update({s["name"]: s["id"] for s in r["shapes"]})
# Ordem: luzes, corpo, cor, orelhas, cabeça (com brilho e olhos dentro, nessa ordem)
t("reorder_objects", {"operations": [{"objectId": i, "order": "sendToFront"} for i in [gato] + order]})
json.dump(ids, open(os.path.join(S, "rive-v3-ids.json"), "w"), indent=1)
print(json.dumps(ids))
