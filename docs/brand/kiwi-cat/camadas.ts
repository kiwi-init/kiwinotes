// T3720: prepara as mesmas camadas da prancha aprovada (T3747), em WebP lossless.
// A preparação usa Pillow/NumPy; o app recebe só bitmaps e animações DOM/WAAPI.
// Primeiro: python3 -m venv /tmp/kiwi-imagens && /tmp/kiwi-imagens/bin/pip install -r docs/brand/kiwi-cat/gerada/requirements.txt
// Uso: KIWI_IMAGE_PYTHON=/tmp/kiwi-imagens/bin/python bun docs/brand/kiwi-cat/camadas.ts
import { spawnSync } from "node:child_process";
import path from "node:path";
const python = process.env.KIWI_IMAGE_PYTHON ?? "python3";
const result = spawnSync(python, [path.join(import.meta.dirname, "preparar-intro.py")], { stdio: "inherit" });
if (result.status !== 0) throw new Error("camadas: preparação falhou; instale gerada/requirements.txt num venv e indique KIWI_IMAGE_PYTHON");
