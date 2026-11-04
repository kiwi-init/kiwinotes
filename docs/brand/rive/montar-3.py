# A pose aprovada (a 3, #3636, #3641) no Rive: as camadas de literal/ (luz, corpo, cabeca) no espaço da foto, todas em
# (0,0), e os olhos vetoriais. Mesmo encaixe da pose anterior: a foto ×1,6, com o ponto (256, 320) em (512, 414) do palco.
# Apaga o gato antigo (o id "gato" do arquivo de ids que ESTADO aponta) e grava os ids novos em ESTADO/rive-3-ids.json.
#
# Uso: ESTADO=<pasta com rive-v3-ids.json> python3 docs/brand/rive/montar-3.py   (Rive aberto, kiwi-cat-roteiro na frente)
# Escrito pelo kind-koala (scratchpad/montar-3.py); aqui com o cliente do repo (rive-mcp.py).
import json, subprocess, sys, os
S = os.path.dirname(os.path.abspath(__file__))
R = os.path.join(S, "literal")
E = os.environ.get("ESTADO", S)
def run(*a):
    return subprocess.run([sys.executable, os.path.join(S, "rive-mcp.py"), *a], capture_output=True, text=True, env={**os.environ, "MAX": "4000"}).stdout.strip()
def t(name, args):
    out = run("t", name, json.dumps(args))
    if "[isError]" in out or not out.startswith("{"): raise SystemExit(f"{name} falhou: {out[:500]}")
    return json.loads(out.splitlines()[0])
AB = "2-18"
old = json.load(open(os.path.join(E, "rive-v3-ids.json")))["gato"]
t("delete_objects", {"objectIds": [old]})
assets = {n: json.loads(run("upload", os.path.join(R, f"{n}.webp")))["asset"]["id"] for n in ["luz", "corpo", "cabeca"]}
g = t("group_editor", {"name": "gato", "parentId": AB})["group"]["id"]
t("set_property_values", {"propertyValues": {g: {"13": 512, "14": 414, "16": 160, "17": 160}}})
ids = {"gato": g}
for n in ["luz", "corpo", "cabeca"]:
    ids[n] = t("assets_tool", {"command": "addImageInstance", "data": {"addImageInstance": {"assetId": assets[n], "parentId": g, "name": n, "x": 0, "y": 0}}})["imageId"]
eyes = t("group_editor", {"name": "eyes", "parentId": g})["group"]["id"]
t("set_property_values", {"propertyValues": {eyes: {"13": 0, "14": 0, "16": 100, "17": 100}}})
r = t("path_editor", {"command": "createParametricShapes", "data": {"createParametricShapes": {"shapes": [
    {"primitive": "ellipse", "name": "eye-left", "parentId": eyes, "x": 201 - 256, "y": 0, "width": 34, "height": 34, "paints": [{"paintType": "fill", "color": "#FFFFFF"}]},
    {"primitive": "ellipse", "name": "eye-right", "parentId": eyes, "x": 311 - 256, "y": 0, "width": 34, "height": 34, "paints": [{"paintType": "fill", "color": "#FFFFFF"}]}]}}})
ids["eyes"] = eyes
t("reorder_objects", {"operations": [{"objectId": i, "order": "sendToFront"} for i in [g, ids["luz"], ids["corpo"], ids["cabeca"], eyes]]})
json.dump(ids, open(os.path.join(E, "rive-3-ids.json"), "w"), indent=1)
print(json.dumps(ids))
