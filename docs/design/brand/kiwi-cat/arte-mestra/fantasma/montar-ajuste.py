# Monta ajuste.html a partir do modelo (ajuste.tpl.html), do shader (ajuste.frag) e da máscara da v2 (o núcleo escuro
# de kiwi-cat-candidata-v2.png, 512 × 640, 1 bit, em base64: mascara-v2.b64).
import pathlib
h = pathlib.Path(__file__).parent
t = (h / "ajuste.tpl.html").read_text(); fs = (h / "ajuste.frag").read_text(); m = (h / "mascara-v2.b64").read_text().strip()
assert "`" not in fs
(h / "ajuste.html").write_text(t.replace("__FS__", fs).replace("__MASK__", m))
