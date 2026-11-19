// A prova da régua dos arquivos (spec #21156, T21236): lê a tabela de `docs/specs/regua-dos-arquivos.md` e roda, para
// cada tipo, o que dá para conferir sem tela. Um "cumpre" que quebra falha; um "falta" que passa pede a troca na tabela.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { openTarget, VIEWER_TYPES } from "../../src/shared/file-view.ts";
import { tempDir } from "../tmp.ts";
import { csvGrande, jsonGrande, PASTA, pequenas } from "./arquivos.ts";
import { Cofre, CONFERIR, FAMILIAS, medirAte } from "./conferir.ts";
import { ITENS, julgar, lerEstado, lerRegua, repetidas, semLinha, type Linha } from "./regua.ts";

const DOC = path.join(import.meta.dir, "../../../docs/specs/regua-dos-arquivos.md");
const regua = lerRegua(readFileSync(DOC, "utf8"));
const FORA = "abre fora";
/** O item 11 (tudo local): conta a rede durante as outras conferências do tipo. */
const TUDO_LOCAL = ITENS.indexOf("Tudo local");

describe("a tabela da régua", () => {
  test("todo tipo que as Notas abrem tem a linha dele (a nota, o quadro branco e cada um de VIEWER_TYPES)", () => {
    expect(semLinha(regua, ["md", "canvas", ...VIEWER_TYPES])).toEqual([]);
  });

  test("nenhuma extensão está em duas linhas", () => {
    expect(repetidas(regua)).toEqual([]);
  });

  test("cada linha que abre no Kiwi tem a sua fixture difícil, e cada fixture tem a sua linha", () => {
    const tipos = regua.filter((l) => l.tipo !== FORA).map((l) => l.tipo);
    expect(tipos.sort()).toEqual(Object.keys(FAMILIAS).sort());
  });

  test('"abre fora" é só dos tipos que o Kiwi manda para o app padrão, e a linha deles é toda "abre fora"', () => {
    const fora = regua.find((l) => l.tipo === FORA);
    expect(fora).toBeDefined();
    expect(fora!.exts.filter((e) => openTarget(`x.${e}`) !== "app")).toEqual([]);
    expect(fora!.estados.every((e) => e.kind === "fora")).toBe(true);
    expect(regua.filter((l) => l.tipo !== FORA && l.estados.some((e) => e.kind === "fora")).map((l) => l.tipo)).toEqual([]);
  });
});

// A pasta dos arquivos difíceis (T23519): o que está no repo é a saída do script, e só as pequenas. Uma fixture mexida
// à mão (ou trocada por um arquivo de verdade de alguém) e uma grande commitada quebram aqui.
describe("a pasta dos arquivos difíceis", () => {
  /** O teto de uma fixture no repo: a maior hoje tem uns 7 KB, e as grandes (50 mil linhas, 5 MB) passam de 1 MB. */
  const TETO = 32 * 1024;

  test("é a saída do `arquivos.ts --write`, byte a byte, sem um arquivo a mais nem a menos", async () => {
    const geradas = await pequenas();
    expect(readdirSync(PASTA).sort()).toEqual(Object.keys(geradas).sort());
    const diferentes = Object.entries(geradas)
      .filter(([nome, c]) => !readFileSync(path.join(PASTA, nome)).equals(Buffer.from(c)))
      .map(([nome]) => nome);
    expect(diferentes).toEqual([]);
  });

  test(`só as pequenas: nenhuma passa de ${TETO / 1024} KB, e as grandes, geradas no teste, ficam acima disso`, () => {
    const grandes = readdirSync(PASTA).filter((n) => statSync(path.join(PASTA, n)).size > TETO);
    expect(grandes).toEqual([]);
    expect(Buffer.byteLength(csvGrande())).toBeGreaterThan(TETO);
    expect(Buffer.byteLength(jsonGrande())).toBeGreaterThan(TETO);
  });
});

describe("a prova, tipo por tipo", () => {
  let cofre: Cofre;
  beforeAll(async () => {
    cofre = new Cofre(tempDir("regua-"));
    await cofre.abrir();
  }, 60_000);
  afterAll(() => cofre?.fechar());

  for (const linha of regua.filter((l) => l.tipo !== FORA)) {
    test(linha.tipo, async () => {
      const problemas: string[] = [];
      const rede = cofre.rede;
      for (const [i, conferir] of Object.entries(CONFERIR)) {
        const item = Number(i);
        const estado = linha.estados[item]!;
        if (estado.kind !== "cumpre" && estado.kind !== "falta") continue;
        const p = julgar(linha.tipo, item, estado, await conferir!(cofre, linha.tipo));
        if (p) problemas.push(p);
      }
      const local = cofre.rede === rede ? null : `${cofre.rede - rede} pedido(s) de rede`;
      const p = julgar(linha.tipo, TUDO_LOCAL, linha.estados[TUDO_LOCAL]!, local);
      if (p) problemas.push(p);
      expect(problemas).toEqual([]);
    }, 60_000);
  }
});

describe("o teste do teste", () => {
  const tabela = (linhas: string[]) =>
    [
      "<!-- regua:inicio -->",
      `| Tipo | Extensões | ${ITENS.join(" | ")} |`,
      `|${"---|".repeat(ITENS.length + 2)}`,
      ...linhas,
      "<!-- regua:fim -->",
    ].join("\n");
  const cumpreTudo = Array(ITENS.length).fill("cumpre").join(" | ");

  test("um tipo sem linha quebra", () => {
    const r = lerRegua(tabela([`| texto | \`txt\` \`log\` | ${cumpreTudo} |`]));
    expect(semLinha(r, ["txt", "log", "formato-novo"])).toEqual(["formato-novo"]);
  });

  test('um "cumpre" que quebra falha, com o tipo, o item e o motivo', () => {
    expect(julgar("csv", 5, { kind: "cumpre" }, "o arquivo gravado mudou além da edição")).toBe(
      'csv › 6. Gravar não estraga: a régua diz "cumpre", e quebrou: o arquivo gravado mudou além da edição',
    );
    expect(julgar("csv", 5, { kind: "cumpre" }, null)).toBeNull();
  });

  test('um "falta" que passa pede a troca para "cumpre" na tabela; o que ainda falha passa', () => {
    expect(julgar("docx", 3, { kind: "falta", ref: "issue #156" }, null)).toContain('Troque para "cumpre" na tabela');
    expect(julgar("docx", 3, { kind: "falta", ref: "issue #156" }, "a busca não acha o conteúdo")).toBeNull();
  });

  test("o tempo de abrir falha se todas as medidas passam do máximo, ou se a 1ª passa do teto dela (T22099)", async () => {
    // Um relógio falso (T23067): cada abertura "leva" o tempo que diz, e uma máquina ocupada não muda a conta.
    let agora = 0;
    const relogio = () => agora;
    const leva = (ms: number) => {
      agora += ms;
    };
    const medir = <T>(f: () => Promise<T>, vezes?: number) => medirAte(f, 40, vezes, undefined, relogio);

    let n = 0;
    const lentoUmaVez = await medir(async () => leva(n++ === 0 ? 60 : 5));
    expect(lentoUmaVez).toMatchObject({ ok: true, ms: [60, 5] });

    const rapido = await medir(async () => (leva(5), "aberto"));
    expect(rapido).toMatchObject({ r: "aberto", ok: true, ms: [5] });
    // Exatamente no máximo ainda passa.
    expect(await medir(async () => leva(40))).toMatchObject({ ok: true, ms: [40] });

    const sempreLento = await medir(async () => leva(60), 3);
    expect(sempreLento).toMatchObject({ ok: false, fria: false, ms: [60, 60, 60] });

    // A fria acima do teto (2× o máximo) falha mesmo que as outras fossem rápidas: o código carregado não esconde a 1ª.
    let m = 0;
    const friaLenta = await medir(async () => leva(m++ === 0 ? 100 : 5));
    expect(friaLenta).toMatchObject({ ok: false, fria: true, ms: [100] });
    // No teto, ainda não é fria demais: é uma medida lenta, e a seguinte decide.
    let k = 0;
    const friaNoTeto = await medir(async () => leva(k++ === 0 ? 80 : 5));
    expect(friaNoTeto).toMatchObject({ ok: true, fria: false, ms: [80, 5] });
  });

  test('"n/a" e "abre fora" não rodam', () => {
    expect(julgar("mídia", 7, { kind: "na", motivo: "sem texto" }, "qualquer")).toBeNull();
    expect(julgar("doc", 0, { kind: "fora" }, "qualquer")).toBeNull();
  });

  test("a célula precisa dizer o que fecha a falta, e o n/a precisa do motivo", () => {
    expect(lerEstado("falta spec #21065")).toEqual({ kind: "falta", ref: "spec #21065" });
    expect(lerEstado("falta issue #156")).toEqual({ kind: "falta", ref: "issue #156" });
    expect(() => lerEstado("falta")).toThrow();
    expect(() => lerEstado("n/a")).toThrow();
    expect(() => lerEstado("talvez")).toThrow();
  });

  test("as listas do código entram pelo nome, e a linha com coluna faltando quebra", () => {
    const [l] = lerRegua(tabela([`| mídia | \`MEDIA_TYPES\` | ${cumpreTudo} |`])) as [Linha];
    expect(l.exts).toContain("wav");
    expect(() => lerRegua(tabela(["| texto | `txt` | cumpre |"]))).toThrow();
  });
});
