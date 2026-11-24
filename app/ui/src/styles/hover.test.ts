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

  test("o nome cresce por cima, sem mexer na largura do botão, e o foco do teclado abre igual (T26124)", () => {
    const kit = css("src/kit/kit.css");
    // Nada de grid nem de largura que anda: era o que empurrava os vizinhos (spec #26101).
    expect(kit).not.toContain("grid-template-columns: auto minmax(0, 1fr)");
    expect(kit).not.toMatch(/\.kn-expand[^{]*\{[^}]*width: auto/);
    // A camada anima só o recorte e a opacidade, com os tokens da abertura e do fechamento.
    const label = rule(kit, ".kn-expand-label");
    expect(label).toContain("position: absolute");
    expect(label).toContain("clip-path var(--expand-close) var(--expand-close-ease)");
    expect(kit).toContain(".kn-expand:not([data-placing]):hover > .kn-expand-label,\n.kn-expand:not([data-placing]):focus-visible > .kn-expand-label {");
    expect(kit).toContain("clip-path var(--expand-open) var(--expand-open-ease) var(--expand-in-delay)");
    // O texto entra depois da largura.
    expect(kit).toContain("calc(var(--expand-in-delay) + var(--expand-text-after))");
    const tokens = css("src/styles/tokens.css");
    const ms = (name: string) => {
      const v = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)![1]!.trim();
      return v.endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000;
    };
    expect(ms("--expand-in-delay")).toBeGreaterThanOrEqual(120);
    expect(ms("--expand-in-delay")).toBeLessThanOrEqual(180);
    expect(ms("--expand-open")).toBeGreaterThanOrEqual(350);
    expect(ms("--expand-open")).toBeLessThanOrEqual(450);
    expect(ms("--expand-close")).toBeLessThan(ms("--expand-open"));
    // Sem passar do ponto e sem o salto do 1º quadro: a curva começa no máximo 3x mais rápida que a média.
    const [x1, y1, , y2] = /cubic-bezier\(([^)]+)\)/.exec(/--expand-open-ease:\s*([^;]+);/.exec(tokens)![1]!)![1]!.split(",").map(Number);
    expect(y1! / x1!).toBeLessThanOrEqual(3);
    expect(Math.max(y1!, y2!)).toBeLessThanOrEqual(1);
  });

  test("reduzir movimento (o do Mac e o do Kiwi) deixa só o fade da camada", () => {
    const kit = css("src/kit/kit.css");
    expect(kit).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n  \.kn-expand\.kn-expand[\s\S]*?transition: opacity 0\.15s linear !important;/);
    expect(kit).toMatch(/:root\[data-motion="reduced"\] \.kn-expand\.kn-expand > \.kn-expand-label \{[^}]*transition: opacity 0\.15s linear !important;/);
  });

  // T4535 substituiu o hover das abas; seu contrato é medido no WebKit por scripts/hub-tabs-ui-check.ts.

  test('o "Reduzir movimento" (o do sistema e o dos Ajustes) zera toda transição', () => {
    const base = css("src/styles/base.css");
    expect(base).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition: none !important;/);
    expect(base).toMatch(/:root\[data-motion="reduced"\] \*[\s\S]*?transition: none !important;/);
  });
});
