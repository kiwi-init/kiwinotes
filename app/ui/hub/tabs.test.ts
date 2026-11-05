// As abas do hub (T4535, spec #4521): a pílula fica só na aba ativa e o hover clareia o texto, sem mexer em
// tamanho, sombra nem posição. O movimento em si é medido no WebKit (`scripts/hub-tabs-ui-check.ts` e
// `scripts/ui-scripts/hub-hover.json`); aqui ficam os contratos que dá para conferir no CSS, no `bun test`
// (T4671, #150).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

type Rule = { selectors: string[]; body: string; reduced: boolean };

const REDUCE = /prefers-reduced-motion:\s*reduce/;

/** Divide uma lista de seletores nas vírgulas de fora dos parênteses. */
function split(prelude: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < prelude.length; i++) {
    const ch = prelude[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(prelude.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(prelude.slice(start).trim());
  return out.filter(Boolean);
}

/** As regras simples do CSS, com o corpo achatado; `reduced` diz se estão dentro do @media de reduzir movimento. */
function rules(src: string): Rule[] {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  const walk = (text: string, reduced: boolean) => {
    let i = 0;
    while (i < text.length) {
      const brace = text.indexOf("{", i);
      if (brace < 0) break;
      const prelude = text.slice(i, brace).trim();
      let depth = 1;
      let j = brace + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
        j++;
      }
      const body = text.slice(brace + 1, j - 1);
      if (prelude.startsWith("@")) walk(body, reduced || REDUCE.test(prelude));
      else out.push({ selectors: split(prelude), body, reduced });
      i = j;
    }
  };
  walk(clean, false);
  return out;
}

/** A especificidade de um seletor como (b, c): atributos, classes e pseudo-classes; elementos. */
function specificity(selector: string): [number, number] {
  const simple = selector.match(/\[[^\]]*\]|\.[\w-]+|::?[\w-]+/g) ?? [];
  const rest = selector.replace(/\[[^\]]*\]|\.[\w-]+|::?[\w-]+/g, " ");
  const elements = rest.match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? [];
  return [simple.length, elements.length];
}

const beats = (a: [number, number], b: [number, number]) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

const hub = rules(readFileSync(path.join(import.meta.dir, "hub.css"), "utf8"));
const pills = hub.filter((r) => r.selectors.some((s) => s.includes(".kn-tabs-pill")));
const glide = pills.find((r) => r.body.includes("transition: transform"))!;

describe("as abas do hub", () => {
  test("a pílula desliza com a --glide, e só quando ela está se movendo", () => {
    expect(glide.selectors).toEqual(['.kn-tabs-pill[data-moving="true"]']);
    expect(glide.body).toContain("transition: transform var(--glide), width var(--glide)");
  });

  test('"Reduzir movimento" zera a pílula por conta própria, sem depender da base.css nem da ordem do arquivo', () => {
    const moving = specificity(glide.selectors[0]!);
    const zeros = pills.filter((r) => r.body.includes("transition: none"));
    // Uma regra do sistema (o @media) e uma dos Ajustes (:root[data-motion="reduced"]).
    expect(zeros).toHaveLength(2);
    for (const rule of zeros) {
      const winners = rule.selectors.filter((s) => s.includes('[data-moving="true"]'));
      expect(winners).toHaveLength(1);
      // Vence a regra da animação por especificidade, não por vir depois.
      expect(beats(specificity(winners[0]!), moving)).toBe(true);
    }
    expect(zeros.filter((r) => r.reduced)).toHaveLength(1);
    expect(zeros.filter((r) => r.selectors.some((s) => s.includes(':root[data-motion="reduced"] .kn-tabs-pill')))).toHaveLength(1);
  });

  test("o hover da aba não mexe em tamanho, sombra nem posição: só a cor", () => {
    const base = hub.find((r) => r.selectors.includes(".kn-tab"))!;
    expect(base.body).toContain("transition: color var(--fast)");
    expect(base.body).not.toContain("transform");
    expect(base.body).not.toContain("text-shadow");
    const hover = hub.find((r) => r.selectors.includes(".kn-tab:hover"))!;
    expect(hover.body).toContain("color: var(--ink)");
    expect(hover.body).not.toContain("transform");
    expect(hover.body).not.toContain("text-shadow");
  });
});
