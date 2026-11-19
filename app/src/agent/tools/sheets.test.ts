// As ferramentas da planilha do agente (T21114): ler as células e mudar o arquivo por operações, com o recálculo, a
// versão, a cópia de antes no registro e as operações para o Kiwi ao vivo. Num cofre de memória, com a planilha
// inventada de `test/fixtures/sheet/estoque.xlsx`.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { bytesVersion } from "../../notes/vault.ts";
import type { SheetOp } from "../../shared/sheet/ops.ts";
import { readXlsx } from "../../shared/sheet/xlsx.ts";
import { readDelimited } from "../../shared/sheet/delimited.ts";
import type { VaultReader } from "./reader.ts";
import { runKiwiTool, type KiwiToolContext } from "./tools.ts";
import type { VaultWriter } from "./writer.ts";
import { opsTouchCell, SheetEditing } from "../sheet-editing.ts";

const ESTOQUE = new Uint8Array(readFileSync(path.join(import.meta.dir, "../../../test/fixtures/sheet/estoque.xlsx")));
const CSV = new TextEncoder().encode("Nome;Cidade;Pedidos\nAna;Cidade A;3\nBeto;Cidade B;5\n");

function vault(files: Record<string, Uint8Array>) {
  const disk = new Map(Object.entries(files));
  const saves: { path: string; ops?: readonly SheetOp[] }[] = [];
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
    async saveBytes(p: string, base64: string, baseVersion: string, ops?: readonly SheetOp[]) {
      if (bytesVersion(disk.get(p)!) !== baseVersion) return { saved: false };
      const b = new Uint8Array(Buffer.from(base64, "base64"));
      disk.set(p, b);
      saves.push({ path: p, ops });
      return { saved: true, path: p, version: bytesVersion(b) };
    },
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

const cell = (bytes: Uint8Array, sheet: string, ref: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  const col = m[1]!.charCodeAt(0) - 65;
  return readXlsx(bytes, "x.xlsx").sheets.find((s) => s.name === sheet)!.rows[Number(m[2]) - 1]?.[col];
};

describe("sheets_read: as células da planilha, para mudar", () => {
  test("os valores, as fórmulas em inglês, o texto da moeda, as abas e a versão", async () => {
    const { ctx } = vault({ "Loja/estoque.xlsx": ESTOQUE });
    const r = await runKiwiTool(ctx, "sheets_read", { caminho: "Loja/estoque.xlsx", intervalo: "A1:E3" });
    const v = r.value as any;
    expect(v.versao).toBe(bytesVersion(ESTOQUE));
    expect(v.abas).toEqual(["Estoque", "Resumo", "Fornecedores"]);
    expect(v.aba).toBe("Estoque");
    expect(v.tamanho).toEqual({ linhas: 8, colunas: 5 });
    expect(v.intervalo).toBe("A1:E3");
    expect(v.linhas[1].slice(0, 4)).toEqual(["Caneca azul", "Cozinha", 7, 24.9]);
    expect(v.formulas).toEqual({ E2: "=C2*D2", E3: "=C3*D3" });
    expect(v.textos.D2).toBe("R$ 24,90");
    expect(r.target).toBe("Loja/estoque.xlsx");
  });

  test("outra aba pelo nome, sem diferenciar maiúscula; a aba que não existe diz quais há", async () => {
    const { ctx } = vault({ "estoque.xlsx": ESTOQUE });
    const v = (await runKiwiTool(ctx, "sheets_read", { caminho: "estoque.xlsx", aba: "fornecedores" })).value as any;
    expect(v.aba).toBe("Fornecedores");
    expect(v.linhas[2]).toEqual(["Vidraria Modelo", "Cidade B", 7]);
    await expect(runKiwiTool(ctx, "sheets_read", { caminho: "estoque.xlsx", aba: "Caixa" })).rejects.toThrow(/Estoque, Resumo, Fornecedores/);
  });

  test("o csv: tudo texto, sem abas; um arquivo que não é planilha volta para o files_read", async () => {
    const { ctx } = vault({ "clientes.csv": CSV });
    const v = (await runKiwiTool(ctx, "sheets_read", { caminho: "clientes.csv" })).value as any;
    expect(v.formato).toBe("csv");
    expect(v.abas).toBeUndefined();
    expect(v.linhas).toEqual([["Nome", "Cidade", "Pedidos"], ["Ana", "Cidade A", "3"], ["Beto", "Cidade B", "5"]]);
    await expect(runKiwiTool(ctx, "sheets_read", { caminho: "relatorio.pdf" })).rejects.toThrow(/files_read/);
  });

  test("o texto passa pelo filtro dos segredos, célula a célula", async () => {
    const { ctx } = vault({ "clientes.csv": CSV });
    const guard = {
      decide: async (_p: string, text: string) => ({ text: text.replace("Cidade A", "‹segredo 1›") }),
      heldIn: () => 0,
    };
    const v = (await runKiwiTool({ ...ctx, guard: guard as any }, "sheets_read", { caminho: "clientes.csv" })).value as any;
    expect(v.linhas[1]).toEqual(["Ana", "‹segredo 1›", "3"]);
  });
});

describe("sheets_edit: muda a planilha por operações, como a grade", () => {
  test("a célula muda, a fórmula que depende recalcula, e o resto do arquivo fica", async () => {
    const { ctx, disk, saves, kept } = vault({ "estoque.xlsx": ESTOQUE });
    const r = await runKiwiTool(ctx, "sheets_edit", { caminho: "estoque.xlsx", versao: bytesVersion(ESTOQUE), mudancas: [{ tipo: "celulas", celulas: { C2: 10 } }] });
    const after = disk.get("estoque.xlsx")!;
    expect(cell(after, "Estoque", "C2")?.value).toBe(10);
    expect(cell(after, "Estoque", "E2")).toMatchObject({ formula: "C2*D2", value: 249 });
    expect(cell(after, "Estoque", "B3")?.value).toBe("Jardim");
    expect(cell(after, "Resumo", "B1")?.formula).toBe("Estoque!C8");
    // A cópia de antes é o arquivo em base64, para o desfazer.
    expect(kept).toEqual([{ path: "estoque.xlsx", before: Buffer.from(ESTOQUE).toString("base64") }]);
    expect(r.change).toMatchObject({ kind: "replaced", path: "estoque.xlsx", version: bytesVersion(after), copy: "copia-1", before: ESTOQUE.length });
    expect((r.value as any).versao).toBe(bytesVersion(after));
    // As operações vão com a gravação, para a grade aberta tocar: a célula e o recálculo.
    const ops = saves[0]!.ops!;
    expect(ops[0]).toEqual({ op: "set", sheet: "Estoque", row: 1, col: 2, value: 10 });
    expect(ops.some((o) => o.op === "cached" && o.row === 1 && o.col === 4 && o.value === 249)).toBe(true);
  });

  test("a fórmula com '=', o texto, o apagar, e as linhas e colunas na ordem", async () => {
    const { ctx, disk } = vault({ "estoque.xlsx": ESTOQUE });
    await runKiwiTool(ctx, "sheets_edit", {
      caminho: "estoque.xlsx",
      versao: bytesVersion(ESTOQUE),
      mudancas: [
        { tipo: "inserir_linhas", linha: 2 },
        { tipo: "celulas", celulas: { A2: "Prato fundo", B2: "Cozinha", C2: 4, D2: 18, E2: "=C2*D2" } },
        { tipo: "celulas", aba: "Fornecedores", celulas: { B4: null } },
      ],
    });
    const after = disk.get("estoque.xlsx")!;
    expect(cell(after, "Estoque", "A2")?.value).toBe("Prato fundo");
    expect(cell(after, "Estoque", "E2")).toMatchObject({ formula: "C2*D2", value: 72 });
    expect(cell(after, "Estoque", "A3")?.value).toBe("Caneca azul");
    // A soma desceu com a linha de cima, como no Excel: a linha nova, acima do intervalo, fica de fora.
    expect(cell(after, "Estoque", "C9")?.formula).toBe("SUM(C3:C8)");
    expect(cell(after, "Fornecedores", "B4")).toBeUndefined();
  });

  test("a aba nova e o nome novo", async () => {
    const { ctx, disk } = vault({ "estoque.xlsx": ESTOQUE });
    await runKiwiTool(ctx, "sheets_edit", {
      caminho: "estoque.xlsx",
      versao: bytesVersion(ESTOQUE),
      mudancas: [
        { tipo: "renomear_aba", aba: "Resumo", nome: "Painel" },
        { tipo: "nova_aba", nome: "Notas" },
        { tipo: "celulas", aba: "Notas", celulas: { A1: "conferir os preços" } },
      ],
    });
    const names = readXlsx(disk.get("estoque.xlsx")!, "x.xlsx").sheets.map((s) => s.name);
    expect(names).toEqual(["Estoque", "Painel", "Fornecedores", "Notas"]);
    expect(cell(disk.get("estoque.xlsx")!, "Notas", "A1")?.value).toBe("conferir os preços");
  });

  test("o csv grava o número como texto e guarda o separador", async () => {
    const { ctx, disk } = vault({ "clientes.csv": CSV });
    await runKiwiTool(ctx, "sheets_edit", { caminho: "clientes.csv", versao: bytesVersion(CSV), mudancas: [{ tipo: "celulas", celulas: { C3: 6, A4: "Caio", B4: "Cidade C", C4: 1 } }] });
    const { rows, format } = readDelimited(disk.get("clientes.csv")!, "clientes.csv");
    expect(format.delimiter).toBe(";");
    expect(rows).toEqual([["Nome", "Cidade", "Pedidos"], ["Ana", "Cidade A", "3"], ["Beto", "Cidade B", "6"], ["Caio", "Cidade C", "1"]]);
  });

  test("a versão velha não grava, e nada vai ao registro", async () => {
    const { ctx, disk, kept } = vault({ "estoque.xlsx": ESTOQUE });
    await expect(runKiwiTool(ctx, "sheets_edit", { caminho: "estoque.xlsx", versao: "outra", mudancas: [{ tipo: "celulas", celulas: { C2: 1 } }] })).rejects.toMatchObject({ code: "E_CHANGED" });
    expect(disk.get("estoque.xlsx")).toBe(ESTOQUE);
    expect(kept).toEqual([]);
  });

  test("a mudança errada diz o porquê e não grava nada", async () => {
    const { ctx, disk, kept } = vault({ "estoque.xlsx": ESTOQUE, "clientes.csv": CSV });
    const v = bytesVersion(ESTOQUE);
    const bad = (mudancas: unknown, caminho = "estoque.xlsx", versao = v) => runKiwiTool(ctx, "sheets_edit", { caminho, versao, mudancas });
    await expect(bad([{ tipo: "celulas", celulas: { "linha 3": 1 } }])).rejects.toThrow(/não é uma célula/);
    await expect(bad([{ tipo: "celulas", aba: "Caixa", celulas: { A1: 1 } }])).rejects.toThrow(/não tem a aba Caixa/);
    await expect(bad([{ tipo: "nova_aba", nome: "Estoque" }])).rejects.toThrow(/já existe/);
    await expect(bad([{ tipo: "apagar_linhas", linha: 0 }])).rejects.toThrow(/a partir de 1/);
    await expect(bad([{ tipo: "pintar" }])).rejects.toThrow(/não é um tipo/);
    await expect(bad([])).rejects.toThrow(/vazio/);
    await expect(bad([{ tipo: "nova_aba", nome: "B" }], "clientes.csv", bytesVersion(CSV))).rejects.toThrow(/não tem abas/);
    expect(disk.get("estoque.xlsx")).toBe(ESTOQUE);
    expect(kept).toEqual([]);
  });

  test("a gravação recusada tira a cópia do registro", async () => {
    const { ctx, kept, dropped } = vault({ "estoque.xlsx": ESTOQUE });
    const writer = { ...ctx.writer!, saveBytes: async () => ({ saved: false as const }) } as VaultWriter;
    await expect(runKiwiTool({ ...ctx, writer }, "sheets_edit", { caminho: "estoque.xlsx", versao: bytesVersion(ESTOQUE), mudancas: [{ tipo: "celulas", celulas: { C2: 1 } }] })).rejects.toMatchObject({
      code: "E_CHANGED",
    });
    expect(kept).toHaveLength(1);
    expect(dropped).toEqual(["copia-1"]);
  });
});

describe("sheets_edit com a pessoa editando (T21114, spec #21033)", () => {
  const withEditing = (files: Record<string, Uint8Array>, ms = 60) => {
    const v = vault(files);
    const editing = new SheetEditing();
    (v.ctx.writer as VaultWriter).waitCells = (p, ops) => editing.waitFree(p, ops, ms);
    return { ...v, editing };
  };

  test("noutra célula, o gato grava na hora", async () => {
    const { ctx, disk, editing } = withEditing({ "estoque.xlsx": ESTOQUE });
    editing.set("janela", "estoque.xlsx", { sheet: "Estoque", row: 3, col: 0 });
    const t0 = Date.now();
    await runKiwiTool(ctx, "sheets_edit", { caminho: "estoque.xlsx", versao: bytesVersion(ESTOQUE), mudancas: [{ tipo: "celulas", celulas: { C2: 10 } }] });
    expect(Date.now() - t0).toBeLessThan(50);
    expect(cell(disk.get("estoque.xlsx")!, "Estoque", "C2")?.value).toBe(10);
  });

  test("na mesma célula, ele espera a pessoa sair e só então grava", async () => {
    const { ctx, disk, editing } = withEditing({ "estoque.xlsx": ESTOQUE }, 5_000);
    editing.set("janela", "estoque.xlsx", { sheet: "Estoque", row: 1, col: 2 });
    let gravou = false;
    const edit = runKiwiTool(ctx, "sheets_edit", { caminho: "estoque.xlsx", versao: bytesVersion(ESTOQUE), mudancas: [{ tipo: "celulas", celulas: { A2: "Caneca verde", C2: 10 } }] }).then(() => (gravou = true));
    await Bun.sleep(30);
    // Nada do lote passou na frente: nem a outra célula.
    expect(gravou).toBe(false);
    expect(disk.get("estoque.xlsx")).toBe(ESTOQUE);
    editing.set("janela", "estoque.xlsx", null);
    await edit;
    expect(cell(disk.get("estoque.xlsx")!, "Estoque", "C2")?.value).toBe(10);
    expect(cell(disk.get("estoque.xlsx")!, "Estoque", "A2")?.value).toBe("Caneca verde");
  });

  test("se a pessoa gravou a célula enquanto ele esperava, nada é escrito e ele relê", async () => {
    const { ctx, disk, editing } = withEditing({ "clientes.csv": CSV }, 5_000);
    editing.set("janela", "clientes.csv", { sheet: "", row: 1, col: 2 });
    const edit = runKiwiTool(ctx, "sheets_edit", { caminho: "clientes.csv", versao: bytesVersion(CSV), mudancas: [{ tipo: "celulas", celulas: { C2: 9 } }] });
    await Bun.sleep(20);
    const dela = new TextEncoder().encode("Nome;Cidade;Pedidos\nAna;Cidade A;4\nBeto;Cidade B;5\n");
    disk.set("clientes.csv", dela);
    editing.set("janela", "clientes.csv", null);
    await expect(edit).rejects.toMatchObject({ code: "E_CHANGED" });
    expect(disk.get("clientes.csv")).toBe(dela);
  });

  test("a caixa esquecida aberta: no teto, E_BUSY com a célula, e nada gravado", async () => {
    const { ctx, disk, editing, kept } = withEditing({ "estoque.xlsx": ESTOQUE }, 40);
    editing.set("janela", "estoque.xlsx", { sheet: "Estoque", row: 1, col: 2 });
    await expect(
      runKiwiTool(ctx, "sheets_edit", { caminho: "estoque.xlsx", versao: bytesVersion(ESTOQUE), mudancas: [{ tipo: "celulas", celulas: { C2: 10 } }] }),
    ).rejects.toMatchObject({ code: "E_BUSY", message: expect.stringContaining("C2 (aba Estoque)") });
    expect(disk.get("estoque.xlsx")).toBe(ESTOQUE);
    expect(kept).toHaveLength(0);
  });
});

describe("opsTouchCell", () => {
  test("escrever nela ou apagar a linha toca; inserir antes só empurra", () => {
    const c = { sheet: "A", row: 2, col: 1 };
    expect(opsTouchCell([{ op: "set", sheet: "a", row: 2, col: 1, value: 1 }], c)).toBe(true);
    expect(opsTouchCell([{ op: "set", sheet: "A", row: 2, col: 2, value: 1 }], c)).toBe(false);
    expect(opsTouchCell([{ op: "insertRows", sheet: "A", at: 0, count: 1 }, { op: "set", sheet: "A", row: 2, col: 1, value: 1 }], c)).toBe(false);
    expect(opsTouchCell([{ op: "insertRows", sheet: "A", at: 0, count: 1 }, { op: "set", sheet: "A", row: 3, col: 1, value: 1 }], c)).toBe(true);
    expect(opsTouchCell([{ op: "deleteCols", sheet: "A", at: 0, count: 2 }], c)).toBe(true);
    expect(opsTouchCell([{ op: "renameSheet", sheet: "A", name: "B" }, { op: "set", sheet: "B", row: 2, col: 1, value: 1 }], c)).toBe(true);
    expect(opsTouchCell([{ op: "set", sheet: "Outra", row: 2, col: 1, value: 1 }], c)).toBe(false);
  });
});
