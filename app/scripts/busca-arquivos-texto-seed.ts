// Os arquivos inventados do roteiro `ui-scripts/busca-arquivos-texto.json` (T21240): o .py, o .json e o .csv não
// passam pelo `files.create`, que só cria txt, csv, xlsx, docx e pdf. Rode antes do `cli start`, na pasta de dados vazia:
//
//   bun scripts/busca-arquivos-texto-seed.ts DIR
//   bun run cli start --data DIR --no-helper
//   bun run cli ui notes --script scripts/ui-scripts/busca-arquivos-texto.json --out DIR/prints --data DIR

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("uso: bun scripts/busca-arquivos-texto-seed.ts DIR");
const vault = path.join(dir, "vault");
const files: Record<string, string> = {
  // A palavra fica na linha 92, perto do fim: o visualizador tem de rolar até ela.
  "Codigo/horta.py": Array.from({ length: 30 }, (_, i) => `def passo_${i}():\n    return ${i}\n\n`).join("") + "def colher():\n    return 'carambola madura'\n",
  // Linha 42: a grade rola e seleciona a A42.
  "Dados/vendas.csv": "fruta;kg\n" + Array.from({ length: 40 }, (_, i) => `item ${i};${i}\n`).join("") + "carambola;3\n",
  // Só o nome tem a palavra.
  "Dados/carambola-precos.json": '{\n  "fruta": "caju",\n  "estoque": 12\n}\n',
};
for (const [rel, text] of Object.entries(files)) {
  mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
  writeFileSync(path.join(vault, rel), text);
}
console.log(`${Object.keys(files).length} arquivos em ${vault}`);
