// O Kiwi-cat em SVG num formato que o importador do Rive entende (T3151, spec #3133). O SVG da família
// (docs/brand/kiwi-cat-familia) desenha o gato dentro de um <svg> aninhado, com <use> e filtros. O Rive importa só o
// que está no nível de cima e ignora o resto: entrava só o fundo. Aqui:
// - o <svg id="safe-area"> (viewBox -128 -128 1280 1280 em 1024) vira um <g> com a mesma transformação;
// - cada <use href="#forma"> vira a própria <path>, com os atributos do <use>;
// - saem os filtros (o blur da aura, a luz de borda, o brilho dos olhos), o <style> e os comentários. No Rive eles são
//   refeitos com os efeitos dele (feather), e as partes mantêm os ids do SVG como nome.
//
// Uso: bun docs/brand/rive/svg-para-rive.ts docs/brand/kiwi-cat-familia/kiwi-cat-1-aura.svg > kiwi-cat-rive.svg

import { readFileSync } from "node:fs";

export function svgParaRive(svg: string): string {
  let s = svg.replace(/<!--[\s\S]*?-->/g, "").replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<title[\s\S]*?<\/title>/g, "");
  // As formas que os <use> repetem.
  const shapes = new Map<string, string>();
  for (const m of s.matchAll(/<path\s+id="([^"]+)"\s+d="([^"]+)"[^>]*\/>/g)) shapes.set(m[1]!, m[2]!);
  s = s.replace(/<use\s+([^>]*?)\/>/g, (_all, attrs: string) => {
    const ref = /href="#([^"]+)"/.exec(attrs)?.[1];
    const d = ref ? shapes.get(ref) : undefined;
    if (!d) throw new Error(`svg-para-rive: <use> sem forma: ${attrs}`);
    return `<path d="${d}" ${attrs.replace(/\s*(xlink:)?href="[^"]*"/, "")}/>`;
  });
  // O <svg> aninhado vira <g>: viewBox (vx vy vw vh) desenhado em width×height.
  s = s.replace(/<svg\s+id="safe-area"([^>]*)>([\s\S]*)<\/svg>(\s*)<\/g>/, (_all, attrs: string, inner: string, ws: string) => {
    const vb = /viewBox="([^"]+)"/.exec(attrs)![1]!.split(/\s+/).map(Number);
    const w = Number(/width="([^"]+)"/.exec(attrs)![1]);
    const k = w / vb[2]!;
    const tx = -vb[0]! * k;
    const ty = -vb[1]! * k;
    return `<g id="safe-area" transform="translate(${+tx.toFixed(4)} ${+ty.toFixed(4)}) scale(${+k.toFixed(6)})">${inner}</g>${ws}</g>`;
  });
  s = s.replace(/<filter\b[\s\S]*?<\/filter>/g, "").replace(/\s+filter="url\([^)]*\)"/g, "");
  if (/<svg\s+id="safe-area"/.test(s) || /<use\b/.test(s) || /filter=/.test(s)) throw new Error("svg-para-rive: sobrou svg aninhado, use ou filtro");
  return s.replace(/\n\s*\n+/g, "\n");
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) throw new Error("uso: bun svg-para-rive.ts <kiwi-cat.svg>");
  process.stdout.write(svgParaRive(readFileSync(file, "utf8")));
}
