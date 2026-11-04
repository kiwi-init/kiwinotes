// Aplica o `direcao.json` do diretor (T3065) no SVG: as mudanças de tempo e de curva entram no `animation:` das regras,
// exatamente com os números que o harry deixou, e saem da lista. As notas ficam: são para o agente ler e responder.
//
//   bun docs/brand/diretor/aplicar.ts [--direcao docs/brand/kiwi-cat-familia/direcao.json] [--svg OUTRO.svg] [--seco] [--forcar]
//
// --seco mostra o que mudaria e não grava. --svg aplica em outro arquivo (uma cópia, para testar). --forcar aplica
// mesmo quando o arquivo mudou depois da marcação. Depois, para a intro do app: `bun docs/brand/intro/gerar.ts`.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { aplicar, type Direcao, regras, tempo } from "./animacao.ts";

const raiz = path.resolve(import.meta.dir, "../../..");
const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const direcaoAbs = path.resolve(raiz, arg("--direcao") ?? "docs/brand/kiwi-cat-familia/direcao.json");
if (!existsSync(direcaoAbs)) {
  console.error(`aplicar: não achei ${path.relative(raiz, direcaoAbs)}. Salve no diretor antes.`);
  process.exit(2);
}
const direcao = JSON.parse(readFileSync(direcaoAbs, "utf8")) as Direcao;
const svgAbs = path.resolve(raiz, arg("--svg") ?? direcao.svg);
const seco = process.argv.includes("--seco");
const outroSvg = arg("--svg") !== undefined;

const antes = readFileSync(svgAbs, "utf8");
const r = aplicar(antes, direcao.mudancas, process.argv.includes("--forcar"));

const velho = new Map(regras(antes).flatMap((g) => g.itens.map((i) => [`${g.seletor}|${i.nome}`, i] as const)));
for (const m of r.aplicadas) {
  const v = velho.get(`${m.seletor.replace(/\s*,\s*/g, ",")}|${m.animacao}`)!;
  const mud = [
    m.duracao !== undefined && m.duracao !== v.duracao ? `duração ${tempo(v.duracao)} → ${tempo(m.duracao)}` : "",
    m.atraso !== undefined && m.atraso !== v.atraso ? `atraso ${tempo(v.atraso)} → ${tempo(m.atraso)}` : "",
    m.curva !== undefined && m.curva !== v.curva ? `curva ${v.curva} → ${m.curva}` : "",
  ].filter(Boolean);
  console.log(`✓ ${m.seletor} ${m.animacao}: ${mud.join(", ") || "sem mudança"}`);
}
for (const x of r.recusadas) console.log(`✗ ${x.mudanca.seletor} ${x.mudanca.animacao}: ${x.motivo}`);
if (direcao.notas.length) console.log(`${direcao.notas.length} nota(s) no direcao.json para o agente ler (ficam lá).`);

if (seco) {
  console.log("--seco: nada gravado.");
} else if (r.aplicadas.length) {
  writeFileSync(svgAbs, r.svg);
  // Só tira da lista o que entrou no arquivo de verdade (não numa cópia de teste).
  if (!outroSvg) {
    const resto = direcao.mudancas.filter((m) => !r.aplicadas.includes(m));
    writeFileSync(direcaoAbs, `${JSON.stringify({ ...direcao, mudancas: resto }, null, 2)}\n`);
  }
  console.log(`Gravado: ${path.relative(raiz, svgAbs)}. Para a intro do app: bun docs/brand/intro/gerar.ts`);
}
process.exit(r.recusadas.length ? 1 : 0);
