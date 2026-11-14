// A bateria de tokens (spec #12137): o que o Kiwi põe em cada pedido ao agente, contra os tetos de tetos.json. Roda no
// `bun test` (o CI) e sozinha com `bun run test:tokens`, que imprime o relatório no fim. Nenhum agente é chamado.

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { fixedPrefix } from "../../src/agent/fixed-prefix.ts";
import { countTokens } from "../../src/agent/token-count.ts";
import { FULL, type Measure, prefixMeasures, REQUEST, toolMeasures } from "./measure.ts";

const TETOS = JSON.parse(readFileSync(path.join(import.meta.dir, "tetos.json"), "utf8")) as Record<string, number | string>;
const measured: Measure[] = [];

/** O relatório: a tabela do item, o valor e o teto (para o corpo do PR quando um teto muda). */
export function report(rows: readonly Measure[], tetos: Record<string, number | string>): string {
  const lines = ["| Item | Tokens | Teto | Folga |", "|---|---:|---:|---:|"];
  for (const r of rows) {
    const teto = typeof tetos[r.item] === "number" ? (tetos[r.item] as number) : NaN;
    lines.push(`| ${r.item} | ${r.tokens} | ${Number.isNaN(teto) ? "—" : teto} | ${Number.isNaN(teto) ? "—" : teto - r.tokens} |`);
  }
  return lines.join("\n");
}

/** Os itens acima do teto (ou sem teto), com a diferença, numa frase cada. */
export function overCeiling(rows: readonly Measure[], tetos: Record<string, number | string>): string[] {
  return rows.flatMap((r) => {
    const teto = tetos[r.item];
    if (typeof teto !== "number") return [`${r.item}: sem teto em tetos.json (mede ${r.tokens})`];
    return r.tokens > teto ? [`${r.item}: ${r.tokens} tokens, ${r.tokens - teto} acima do teto de ${teto}`] : [];
  });
}

afterAll(() => {
  if (process.env.KIWI_TOKENS_REPORT) console.log(`\nA bateria de tokens (spec #12137)\n\n${report(measured, TETOS)}\n`);
});

describe("o contador", () => {
  test("estável e local: o mesmo texto dá o mesmo número, e um texto maior dá mais", () => {
    expect(countTokens("")).toBe(0);
    expect(countTokens("oi")).toBe(1);
    expect(countTokens("organização")).toBe(3);
    expect(countTokens('{"a": [1, 2]}')).toBe(countTokens('{"a": [1, 2]}'));
    expect(countTokens('{"a": [1, 2]}')).toBe(11); // { " a " : [ 1 , 2 ] }
    expect(countTokens("a b c")).toBeLessThan(countTokens("a b c d"));
    // A mesma palavra, composta ou não (NFC), conta igual.
    expect(countTokens("ação")).toBe(countTokens("ação"));
  });
});

describe("o que o Kiwi manda ao agente fica abaixo do teto", () => {
  test("o começo fixo, no normal e no econômico", () => {
    const rows = prefixMeasures();
    measured.push(...rows);
    expect(overCeiling(rows, TETOS)).toEqual([]);
  });

  test("as ferramentas: as instruções do servidor e a lista", async () => {
    const rows = await toolMeasures();
    measured.push(...rows);
    expect(overCeiling(rows, TETOS)).toEqual([]);
  });
});

describe("o começo fixo", () => {
  test("é idêntico entre dois pedidos seguidos (o cache do agente)", () => {
    const a = fixedPrefix({ ...FULL, economy: false, request: REQUEST });
    const b = fixedPrefix({ ...FULL, economy: false, request: "Outro pedido, sem termo nenhum." });
    expect(b).toBe(a);
    // No econômico, tudo antes do glossário (que vai por último) também.
    const ea = fixedPrefix({ ...FULL, economy: true, request: REQUEST });
    const eb = fixedPrefix({ ...FULL, economy: true, request: "Outro pedido." });
    const head = (t: string) => t.slice(0, t.indexOf("[O glossário da pessoa"));
    expect(head(ea)).toBe(eb.slice(0, head(ea).length));
  });

  test("no modo econômico fica menor que no normal", () => {
    const [normal, economy] = prefixMeasures();
    expect(economy!.tokens).toBeLessThan(normal!.tokens);
  });
});

describe("a bateria pega o que cresceu", () => {
  test("passar do teto diz o item e a diferença; um item sem teto também falha", () => {
    expect(overCeiling([{ item: "x", tokens: 110 }], { x: 100 })).toEqual(["x: 110 tokens, 10 acima do teto de 100"]);
    expect(overCeiling([{ item: "x", tokens: 100 }], { x: 100 })).toEqual([]);
    expect(overCeiling([{ item: "y", tokens: 5 }], {})).toEqual(["y: sem teto em tetos.json (mede 5)"]);
    expect(report([{ item: "x", tokens: 90 }], { x: 100 })).toContain("| x | 90 | 100 | 10 |");
  });
});
