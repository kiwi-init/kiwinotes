// O hover fluido (T3821, spec #3816): um movimento só, em tokens, para os botões; o "Reduzir movimento"
// desliga. A T3826 (as linhas e a barra lateral) usa os mesmos nomes.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ui = path.join(import.meta.dir, "..", "..");
const css = (p: string) => readFileSync(path.join(ui, p), "utf8");
/** O corpo da regra com este seletor exato (a primeira). */
const rule = (src: string, selector: string) => {
  const at = src.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`sem a regra ${selector}`);
  return src.slice(at, src.indexOf("}", at));
};

describe("o hover fluido", () => {
  test("os quatro tokens existem no :root, com o atraso de saída maior que o de entrada", () => {
    const tokens = css("src/styles/tokens.css");
    const value = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1]?.trim();
    expect(value("--hover-dur")).toMatch(/^0?\.\d+s$/);
    expect(value("--hover-ease")).toMatch(/^cubic-bezier\(/);
    // Sem mola (spec #12626): nenhum y da curva passa de 1, então o movimento não passa do ponto e volta.
    const ys = /^cubic-bezier\(([^)]+)\)$/.exec(value("--hover-ease")!)![1]!.split(",").map(Number);
    expect(ys[1]).toBeLessThanOrEqual(1);
    expect(ys[3]).toBeLessThanOrEqual(1);
    expect(ys[1]).toBeGreaterThanOrEqual(0);
    expect(value("--hover-in-delay")).toBe("0s");
    expect(value("--hover-out-delay")).toMatch(/^\d+ms$/);
  });

  test("o botão que expande anima a coluna do grid com os tokens, e o foco do teclado tem o mesmo visual", () => {
    const kit = css("src/kit/kit.css");
    const base = rule(kit, ".kn-expand");
    expect(base).toContain("grid-template-columns: auto minmax(0, 0fr)");
    expect(base).toContain("var(--hover-dur) var(--hover-ease) var(--hover-out-delay)");
    expect(kit).toContain(".kn-expand:hover,\n.kn-expand:focus-visible {\n  grid-template-columns: auto minmax(0, 1fr);");
    // O nome é cortado pela coluna enquanto ela encolhe (sem isto, vazava por cima do botão vizinho).
    expect(rule(kit, ".kn-expand-label")).toContain("justify-self: stretch");
  });

  // T4535 substituiu o hover das abas; seu contrato é medido no WebKit por scripts/hub-tabs-ui-check.ts.

  test('o "Reduzir movimento" (o do sistema e o dos Ajustes) zera toda transição', () => {
    const base = css("src/styles/base.css");
    expect(base).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition: none !important;/);
    expect(base).toMatch(/:root\[data-motion="reduced"\] \*[\s\S]*?transition: none !important;/);
  });
});
