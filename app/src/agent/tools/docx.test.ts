// As ferramentas do docx do agente (T21231, spec #21155 3b): ler os parágrafos e mudar o texto pelo motor sem tela, com
// a versão, a cópia de antes no registro, a espera da pessoa e as operações para o Kiwi ao vivo. Num cofre de memória,
// com um docx inventado na hora.

import { describe, expect, test } from "bun:test";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";

import { bytesVersion } from "../../notes/vault.ts";
import type { DocxOp } from "../../shared/docx/ops.ts";
import { SheetEditing } from "../sheet-editing.ts";
import { DocxDoc } from "./docx.ts";
import type { VaultReader } from "./reader.ts";
import { runKiwiTool, type KiwiToolContext } from "./tools.ts";
import type { VaultWriter } from "./writer.ts";

/** O relatório inventado de uma loja de exemplo: título, texto com negrito, uma tabela e um parágrafo vazio. */
async function relatorio(): Promise<Uint8Array> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Relatório da loja", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun("A loja vendeu "), new TextRun({ text: "40 canecas", bold: true }), new TextRun(" em março.")] }),
          new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph("Caderno")] }), new TableCell({ children: [new Paragraph("12")] })] })] }),
          new Paragraph("Ana revisa na sexta e Beto revisa no sábado."),
          new Paragraph(""),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

function vault(files: Record<string, Uint8Array>, editing?: SheetEditing) {
  const disk = new Map(Object.entries(files));
  const saves: { path: string; ops?: readonly DocxOp[] }[] = [];
  const kept: { path: string; before: string }[] = [];
  const dropped: string[] = [];
  const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
  const reader = {
    async file(p: string) {
      const b = disk.get(p);
      if (!b) throw Object.assign(new Error(`não há ${p}`), { code: "E_NOT_FOUND" });
      return { path: p, size: b.length, version: bytesVersion(b), base64: b64(b) };
    },
  } as unknown as VaultReader;
  const writer = {
    async folder() {
      return null;
    },
    async getBytes(p: string) {
      const b = disk.get(p)!;
      return { base64: b64(b), version: bytesVersion(b) };
    },
    async saveBytes(p: string, base64: string, baseVersion: string, _sheet?: unknown, ops?: readonly DocxOp[]) {
      if (bytesVersion(disk.get(p)!) !== baseVersion) return { saved: false };
      const b = new Uint8Array(Buffer.from(base64, "base64"));
      disk.set(p, b);
      saves.push({ path: p, ...(ops ? { ops } : {}) });
      return { saved: true, path: p, version: bytesVersion(b) };
    },
    ...(editing ? { waitParagraphs: (p: string, ids: readonly string[], ms?: number) => editing.waitParagraphs(p, ids, ms) } : {}),
  } as unknown as VaultWriter;
  const journal = {
    async keep(p: string, before: string) {
      kept.push({ path: p, before });
      return `copia-${kept.length}`;
    },
    async drop(copy: string) {
      dropped.push(copy);
    },
  };
  const ctx: KiwiToolContext = { reader, writer, journal };
  return { ctx, disk, saves, kept, dropped };
}

/** O texto de cada parágrafo de um docx, pelo mesmo motor. */
function texts(bytes: Uint8Array): string[] {
  const d = DocxDoc.open(bytes, "x.docx");
  try {
    return d.paragraphs().map((p) => d.text(p));
  } finally {
    d.close();
  }
}

function ids(bytes: Uint8Array): string[] {
  const d = DocxDoc.open(bytes, "x.docx");
  try {
    return d.paragraphs().map((p) => d.id(p));
  } finally {
    d.close();
  }
}

const P = "Loja/relatorio.docx";

describe("docx_read: os parágrafos numerados, para mudar", () => {
  test("o texto de cada um, os da tabela na ordem, a versão e o total", async () => {
    const bytes = await relatorio();
    const { ctx } = vault({ [P]: bytes });
    const v = (await runKiwiTool(ctx, "docx_read", { caminho: P })).value as any;
    expect(v.versao).toBe(bytesVersion(bytes));
    expect(v.total).toBe(6);
    expect(v.paragrafos).toEqual([
      { n: 1, texto: "Relatório da loja" },
      { n: 2, texto: "A loja vendeu 40 canecas em março." },
      { n: 3, texto: "Caderno", tabela: 1, linha: 1, coluna: 1 },
      { n: 4, texto: "12", tabela: 1, linha: 1, coluna: 2 },
      { n: 5, texto: "Ana revisa na sexta e Beto revisa no sábado." },
      { n: 6, texto: "" },
    ]);
    expect(v.avisos).toBeUndefined();
  });

  test("de/ate e o aviso do que falta", async () => {
    const { ctx } = vault({ [P]: await relatorio() });
    const v = (await runKiwiTool(ctx, "docx_read", { caminho: P, de: 2, ate: 3 })).value as any;
    expect(v.paragrafos.map((p: any) => p.n)).toEqual([2, 3]);
    expect(v.avisos[0]).toContain("de: 4");
  });

  test("só docx; um arquivo que não abre é um erro claro", async () => {
    const { ctx } = vault({ "a.xlsx": new Uint8Array([1]), "b.docx": new TextEncoder().encode("não é um docx") });
    await expect(runKiwiTool(ctx, "docx_read", { caminho: "a.xlsx" })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(runKiwiTool(ctx, "docx_read", { caminho: "b.docx" })).rejects.toMatchObject({ code: "E_FAILED" });
  });
});

describe("docx_edit: muda o texto, guarda o de antes e manda as operações", () => {
  test("trocar, reescrever, inserir e apagar, pelos números da leitura; o resto fica", async () => {
    const bytes = await relatorio();
    const before = ids(bytes);
    const { ctx, disk, saves, kept } = vault({ [P]: bytes });
    const r = await runKiwiTool(ctx, "docx_edit", {
      caminho: P,
      versao: bytesVersion(bytes),
      mudancas: [
        { tipo: "trocar", paragrafo: 2, de: "40 canecas", para: "52 canecas" },
        { tipo: "inserir", depois_de: 0, texto: "Rascunho" },
        { tipo: "inserir", depois_de: 2, texto: "Primeira linha nova\nSegunda linha nova" },
        { tipo: "reescrever", paragrafo: 5, texto: "Ana revisa tudo." },
        { tipo: "apagar", paragrafo: 6 },
      ],
    });
    const after = disk.get(P)!;
    expect(texts(after)).toEqual([
      "Rascunho",
      "Relatório da loja",
      "A loja vendeu 52 canecas em março.",
      "Primeira linha nova",
      "Segunda linha nova",
      "Caderno",
      "12",
      "Ana revisa tudo.",
    ]);
    expect((r.value as any).versao).toBe(bytesVersion(after));
    expect(r.change).toMatchObject({ kind: "replaced", path: P, copy: "copia-1" });
    expect(kept).toEqual([{ path: P, before: Buffer.from(bytes).toString("base64") }]);

    // As operações para o ao vivo: os ids de antes, e os novos são os do arquivo gravado.
    const ops = saves[0]!.ops!;
    const now = ids(after);
    expect(ops[0]).toEqual({ op: "replace", paragraphId: before[1]!, from: 14, to: 24, text: "52 canecas" });
    expect(ops[1]).toEqual({ op: "insert", after: null, paragraphId: now[0]!, text: "Rascunho" });
    expect(ops[2]).toEqual({ op: "insert", after: before[1]!, paragraphId: now[3]!, text: "Primeira linha nova" });
    expect(ops[3]).toEqual({ op: "insert", after: now[3]!, paragraphId: now[4]!, text: "Segunda linha nova" });
    expect(ops[4]).toEqual({ op: "replace", paragraphId: before[4]!, from: 0, to: 44, text: "Ana revisa tudo." });
    expect(ops[5]).toEqual({ op: "delete", paragraphId: before[5]! });
    // Os parágrafos que ficaram mantêm o id.
    expect(now.filter((id) => before.includes(id))).toEqual(before.slice(0, 5));
  });

  test("o id do parágrafo é o mesmo a cada abertura, num arquivo que não o traz", async () => {
    const bytes = await relatorio();
    expect(new TextDecoder("latin1").decode(bytes)).not.toContain("paraId");
    expect(ids(bytes)).toEqual(ids(bytes));
    expect(new Set(ids(bytes)).size).toBe(6);
  });

  test("o negrito fora do trecho trocado fica", async () => {
    const bytes = await relatorio();
    const { ctx, disk } = vault({ [P]: bytes });
    await runKiwiTool(ctx, "docx_edit", { caminho: P, versao: bytesVersion(bytes), mudancas: [{ tipo: "trocar", paragrafo: 2, de: "março", para: "abril" }] });
    const d = DocxDoc.open(disk.get(P)!, P);
    try {
      const p = d.paragraphs()[1]!;
      const [hit] = d.find(p, "40 canecas", "teste");
      const font = (d as any).run({ op: "getFont", span: { start: { paragraph: p, offset: hit!.from }, end: { paragraph: p, offset: hit!.to } } }, "teste");
      expect(JSON.stringify(font)).toContain('"bold":true');
    } finally {
      d.close();
    }
  });

  test("um trecho que não está, ou que aparece duas vezes: nada é escrito", async () => {
    const bytes = await relatorio();
    const { ctx, disk, kept } = vault({ [P]: bytes });
    const v = bytesVersion(bytes);
    await expect(runKiwiTool(ctx, "docx_edit", { caminho: P, versao: v, mudancas: [{ tipo: "trocar", paragrafo: 2, de: "garrafas", para: "x" }] })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    await expect(runKiwiTool(ctx, "docx_edit", { caminho: P, versao: v, mudancas: [{ tipo: "trocar", paragrafo: 5, de: "revisa", para: "lê" }] })).rejects.toMatchObject({
      code: "E_BAD_ARGS",
      message: expect.stringContaining("2 vezes"),
    });
    // A primeira mudança valia, a segunda não: o lote inteiro não grava.
    await expect(
      runKiwiTool(ctx, "docx_edit", { caminho: P, versao: v, mudancas: [{ tipo: "reescrever", paragrafo: 1, texto: "Outro" }, { tipo: "apagar", paragrafo: 99 }] }),
    ).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    expect(disk.get(P)).toBe(bytes);
    expect(kept).toEqual([]);
  });

  test("a versão velha dá E_CHANGED, sem escrever", async () => {
    const bytes = await relatorio();
    const { ctx, disk } = vault({ [P]: bytes });
    await expect(runKiwiTool(ctx, "docx_edit", { caminho: P, versao: "velha", mudancas: [{ tipo: "apagar", paragrafo: 6 }] })).rejects.toMatchObject({ code: "E_CHANGED" });
    expect(disk.get(P)).toBe(bytes);
  });

  test("o parágrafo apagado não volta a ser usado no mesmo lote", async () => {
    const bytes = await relatorio();
    const { ctx } = vault({ [P]: bytes });
    await expect(
      runKiwiTool(ctx, "docx_edit", { caminho: P, versao: bytesVersion(bytes), mudancas: [{ tipo: "apagar", paragrafo: 6 }, { tipo: "reescrever", paragrafo: 6, texto: "x" }] }),
    ).rejects.toMatchObject({ code: "E_BAD_ARGS", message: expect.stringContaining("apagado") });
  });
});

describe("docx_edit: inserir_linha, uma linha de tabela (T23627)", () => {
  test("logo abaixo da linha do parágrafo, uma célula por texto; a operação traz os ids novos", async () => {
    const bytes = await relatorio();
    const before = ids(bytes);
    const { ctx, disk, saves, kept } = vault({ [P]: bytes });
    const r = await runKiwiTool(ctx, "docx_edit", {
      caminho: P,
      versao: bytesVersion(bytes),
      mudancas: [
        { tipo: "inserir_linha", depois_de: 4, celulas: ["Caneca", "40"] },
        // A segunda abaixo da mesma linha vai depois da primeira; a célula que falta fica vazia.
        { tipo: "inserir_linha", depois_de: 3, celulas: ["Lápis"] },
      ],
    });
    const after = disk.get(P)!;
    expect(texts(after)).toEqual(["Relatório da loja", "A loja vendeu 40 canecas em março.", "Caderno", "12", "Caneca", "40", "Lápis", "", "Ana revisa na sexta e Beto revisa no sábado.", ""]);
    expect(r.change).toMatchObject({ kind: "replaced", path: P, copy: "copia-1" });
    expect(kept).toHaveLength(1);
    const now = ids(after);
    expect(saves[0]!.ops).toEqual([
      { op: "insertRow", after: before[3]!, cells: [{ paragraphId: now[4]!, text: "Caneca" }, { paragraphId: now[5]!, text: "40" }] },
      { op: "insertRow", after: now[4]!, cells: [{ paragraphId: now[6]!, text: "Lápis" }, { paragraphId: now[7]!, text: "" }] },
    ]);
    // A tabela ganhou as linhas, na ordem.
    const v = (await runKiwiTool(ctx, "docx_read", { caminho: P })).value as any;
    expect(v.paragrafos.filter((p: any) => p.tabela).map((p: any) => `${p.linha}.${p.coluna} ${p.texto}`)).toEqual(["1.1 Caderno", "1.2 12", "2.1 Caneca", "2.2 40", "3.1 Lápis", "3.2 "]);
  });

  test("fora de uma tabela, ou com células demais: nada é escrito", async () => {
    const bytes = await relatorio();
    const { ctx, disk, kept } = vault({ [P]: bytes });
    const v = bytesVersion(bytes);
    await expect(runKiwiTool(ctx, "docx_edit", { caminho: P, versao: v, mudancas: [{ tipo: "inserir_linha", depois_de: 2, celulas: ["x"] }] })).rejects.toMatchObject({
      code: "E_BAD_ARGS",
      message: expect.stringContaining("não está numa tabela"),
    });
    await expect(runKiwiTool(ctx, "docx_edit", { caminho: P, versao: v, mudancas: [{ tipo: "inserir_linha", depois_de: 3, celulas: ["a", "b", "c"] }] })).rejects.toMatchObject({
      code: "E_BAD_ARGS",
      message: expect.stringContaining("2 células"),
    });
    await expect(runKiwiTool(ctx, "docx_edit", { caminho: P, versao: v, mudancas: [{ tipo: "inserir_linha", depois_de: 3, celulas: [] }] })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    expect(disk.get(P)).toBe(bytes);
    expect(kept).toEqual([]);
  });

  test("a pessoa escrevendo na linha de cima não prende: a linha nova não muda nenhum parágrafo dela", async () => {
    const bytes = await relatorio();
    const editing = new SheetEditing();
    const { ctx, disk } = vault({ [P]: bytes }, editing);
    editing.setParagraph("janela", P, ids(bytes)[3]!);
    await runKiwiTool(ctx, "docx_edit", { caminho: P, versao: bytesVersion(bytes), mudancas: [{ tipo: "inserir_linha", depois_de: 4, celulas: ["Caneca", "40"] }] });
    expect(texts(disk.get(P)!)).toContain("Caneca");
  });
});

describe("a pessoa escrevendo no parágrafo (spec #21155)", () => {
  test("o gato espera ela sair, e grava depois", async () => {
    const bytes = await relatorio();
    const editing = new SheetEditing();
    const { ctx, disk } = vault({ [P]: bytes }, editing);
    editing.setParagraph("janela", P, ids(bytes)[1]!);
    const run = runKiwiTool(ctx, "docx_edit", { caminho: P, versao: bytesVersion(bytes), mudancas: [{ tipo: "trocar", paragrafo: 2, de: "40", para: "41" }] });
    await Bun.sleep(30);
    expect(disk.get(P)).toBe(bytes);
    editing.setParagraph("janela", P, null);
    await run;
    expect(texts(disk.get(P)!)[1]).toBe("A loja vendeu 41 canecas em março.");
  });

  test("o cursor em outro parágrafo não prende; preso até o fim do prazo, E_BUSY", async () => {
    const bytes = await relatorio();
    const editing = new SheetEditing();
    editing.setParagraph("janela", P, ids(bytes)[0]!);
    expect(await editing.waitParagraphs(P, [ids(bytes)[1]!], 50)).toEqual({ busy: null, waited: false });
    expect(await editing.waitParagraphs(P, [ids(bytes)[0]!], 30)).toEqual({ busy: ids(bytes)[0]!, waited: true });

    const { ctx, disk } = vault({ [P]: bytes }, editing);
    (ctx.writer as any).waitParagraphs = (p: string, i: readonly string[]) => editing.waitParagraphs(p, i, 30);
    await expect(runKiwiTool(ctx, "docx_edit", { caminho: P, versao: bytesVersion(bytes), mudancas: [{ tipo: "reescrever", paragrafo: 1, texto: "x" }] })).rejects.toMatchObject({
      code: "E_BUSY",
    });
    expect(disk.get(P)).toBe(bytes);
  });

  test("ela gravou enquanto o gato esperava: E_CHANGED, nada por cima do dela", async () => {
    const bytes = await relatorio();
    const editing = new SheetEditing();
    const { ctx, disk } = vault({ [P]: bytes }, editing);
    editing.setParagraph("janela", P, ids(bytes)[1]!);
    const run = runKiwiTool(ctx, "docx_edit", { caminho: P, versao: bytesVersion(bytes), mudancas: [{ tipo: "trocar", paragrafo: 2, de: "40", para: "41" }] });
    await Bun.sleep(20);
    const dela = new Uint8Array([...bytes, 0]);
    disk.set(P, dela);
    editing.setParagraph("janela", P, null);
    await expect(run).rejects.toMatchObject({ code: "E_CHANGED" });
    expect(disk.get(P)).toBe(dela);
  });
});
