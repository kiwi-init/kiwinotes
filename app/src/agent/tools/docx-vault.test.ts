// O Kiwi Cat muda um docx de verdade (T21231, spec #21155): o `docx_read` e o `docx_edit` sobre um cofre num tmp, pelas
// capacidades das janelas (`uiCapabilities`) e pelo escritor ao vivo (`liveWriter`), a janela dizendo o parágrafo com o
// cursor (`files.editing`), e o desfazer da Atividade voltando o arquivo byte a byte. As chamadas são as do agente falso
// (`runKiwiTool`); nenhum agente roda aqui. Tudo inventado: o relatório de uma loja.

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Document, Packer, Paragraph, TextRun } from "docx";
import path from "node:path";

import { uiCapabilities } from "../../bun/ui-capabilities.ts";
import { Vault } from "../../notes/vault.ts";
import { NoteVersions } from "../../notes/versions.ts";
import { DEFAULT_SETTINGS } from "../../store/settings.ts";
import { tempDir } from "../../../test/tmp.ts";
import { AgentActivity } from "../activity.ts";
import { LiveWrites, liveWriter } from "../live-write.ts";
import { undo, undoNotesFromCapabilities } from "../undo.ts";
import { DocxDoc } from "./docx.ts";
import * as reader from "./reader.ts";
import { runKiwiTool, ToolError } from "./tools.ts";
import { writerFromCapabilities } from "./writer.ts";

const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close?.();
});


type Caps = Record<string, (a: unknown) => unknown>;

function setup(doc: Uint8Array) {
  const base = tempDir("kiwi-docx-");
  const root = path.join(base, "KiwiNotes");
  mkdirSync(path.join(root, "Loja"), { recursive: true });
  writeFileSync(path.join(root, P), doc);
  const v = new Vault({ root, debounceMs: 20, trash: async () => {} });
  vaults.push(v);
  const live = new LiveWrites();
  const caps = uiCapabilities({
    dictionary: { load: async () => [], save: async (t) => t },
    snippets: { load: async () => [], save: async (s) => s },
    history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
    dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
    settings: { load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }), save: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }) },
    clipboardWrite: () => {},
    notes: v,
    versions: new NoteVersions({ dir: path.join(base, "history") }),
    // Só o registro das escritas ao vivo: o `files.editing` da janela cai nele.
    agent: { liveWrites: live, trailsFollow: () => {} } as never,
  }) as Caps;
  let clock = Date.parse("2026-11-19T12:00:00.000Z");
  const now = () => clock;
  const activity = new AgentActivity({ dir: path.join(base, "agent", "activity"), now });
  const id = `p-${randomUUID()}`;
  // O servidor pega o aviso no `files.changed`, enquanto a gravação ainda corre: aqui, logo depois de o disco mudar.
  const avisos: ReturnType<LiveWrites["take"]> = [];
  const inner = writerFromCapabilities(caps as never);
  const disk = {
    ...inner,
    saveBytes: async (...a: Parameters<NonNullable<typeof inner.saveBytes>>) => {
      const r = await inner.saveBytes!(...a);
      avisos.push(...live.take([a[0]]));
      return r;
    },
  };
  const writer = liveWriter(disk, live, () => id);
  const ctx = { reader: reader.readerFromCapabilities(caps as never), writer };
  const tool = async (name: string, args: unknown) => {
    clock += 1000;
    const journal = { keep: (_p: string, before: string) => activity.keep(id, before), drop: (c: string) => activity.drop(c) };
    const r = await runKiwiTool({ ...ctx, journal }, name, args);
    if (r.change) await activity.change(id, r.change);
    return r.value as Record<string, any>;
  };
  return {
    root,
    caps,
    tool,
    avisos,
    begin: () => activity.begin(id, "acerte o relatório"),
    undo: () => undo({ activity, notes: undoNotesFromCapabilities(caps as never), now }, id),
    bytes: (rel: string) => readFileSync(path.join(root, rel)),
    write: (rel: string, data: string | Buffer) => writeFileSync(path.join(root, rel), data),
  };
}


const P = "Loja/relatorio.docx";

async function relatorio(): Promise<Uint8Array> {
  const d = new Document({
    sections: [
      {
        children: [
          new Paragraph("Relatório da loja"),
          new Paragraph({ children: [new TextRun("A loja vendeu "), new TextRun({ text: "40 canecas", bold: true }), new TextRun(" em março.")] }),
          new Paragraph("Ana revisa na sexta."),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(d));
}

const texts = (bytes: Uint8Array) => {
  const d = DocxDoc.open(new Uint8Array(bytes), "x.docx");
  try {
    return d.paragraphs().map((p) => d.text(p));
  } finally {
    d.close();
  }
};
const ids = (bytes: Uint8Array) => {
  const d = DocxDoc.open(new Uint8Array(bytes), "x.docx");
  try {
    return d.paragraphs().map((p) => d.id(p));
  } finally {
    d.close();
  }
};

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof ToolError ? e.code : String(e);
  }
};

describe("o Kiwi Cat muda o docx no cofre (T21231)", () => {
  test("lê, muda pela versão, o disco fica com o texto novo, e a janela recebe as operações", async () => {
    const doc = await relatorio();
    const t = setup(doc);
    await t.begin();
    const lido = await t.tool("docx_read", { caminho: P });
    expect(lido.paragrafos.map((p: { texto: string }) => p.texto)).toEqual(["Relatório da loja", "A loja vendeu 40 canecas em março.", "Ana revisa na sexta."]);
    const feito = await t.tool("docx_edit", {
      caminho: P,
      versao: lido.versao,
      mudancas: [
        { tipo: "trocar", paragrafo: 2, de: "40 canecas", para: "52 canecas" },
        { tipo: "inserir", depois_de: 3, texto: "Beto confere no sábado." },
      ],
    });
    expect(texts(t.bytes(P))).toEqual(["Relatório da loja", "A loja vendeu 52 canecas em março.", "Ana revisa na sexta.", "Beto confere no sábado."]);
    // O aviso da janela (spec #20843) vem pelo caminho, com as operações e a versão do que gravou.
    expect(t.avisos).toHaveLength(1);
    expect(t.avisos[0]).toMatchObject({ path: P, version: feito.versao, turnId: expect.any(String) });
    expect(t.avisos[0]!.docxOps!.map((o) => o.op)).toEqual(["replace", "insert"]);
    expect(t.avisos[0]!.docxOps![0]).toMatchObject({ paragraphId: ids(doc)[1], from: 14, to: 24, text: "52 canecas" });
    // A versão velha não grava mais.
    expect(await code(t.tool("docx_edit", { caminho: P, versao: lido.versao, mudancas: [{ tipo: "apagar", paragrafo: 3 }] }))).toBe("E_CHANGED");
  });

  test("o desfazer volta o docx byte a byte", async () => {
    const doc = await relatorio();
    const t = setup(doc);
    await t.begin();
    const lido = await t.tool("docx_read", { caminho: P });
    await t.tool("docx_edit", { caminho: P, versao: lido.versao, mudancas: [{ tipo: "apagar", paragrafo: 3 }] });
    expect(texts(t.bytes(P))).toHaveLength(2);
    const r = await t.undo();
    expect(r.notes.map((n: { path: string; result: string }) => `${n.path} ${n.result}`)).toEqual([`${P} restored`]);
    expect(Buffer.compare(t.bytes(P), Buffer.from(doc))).toBe(0);
  });
});

describe("files.editing: a janela diz o parágrafo com o cursor (contrato 1.93.0, T21231)", () => {
  test("o docx_edit no parágrafo com o cursor espera a pessoa sair; noutro, grava na hora", async () => {
    const doc = await relatorio();
    const t = setup(doc);
    await t.begin();
    const lido = await t.tool("docx_read", { caminho: P });
    const [, p2, p3] = ids(doc);
    expect(await t.caps["files.editing"]!({ path: `/${P}`, owner: "notes-1", paragraph: p2 })).toEqual({ ok: true });
    // Noutro parágrafo: grava na hora.
    const outro = await t.tool("docx_edit", { caminho: P, versao: lido.versao, mudancas: [{ tipo: "trocar", paragrafo: 3, de: "sexta", para: "quinta" }] });
    expect(texts(t.bytes(P))[2]).toBe("Ana revisa na quinta.");
    // No mesmo: espera.
    let feito = false;
    const pending = t.tool("docx_edit", { caminho: P, versao: outro.versao, mudancas: [{ tipo: "trocar", paragrafo: 2, de: "40", para: "41" }] }).then((r) => ((feito = true), r));
    await Bun.sleep(150);
    expect(feito).toBe(false);
    expect(texts(t.bytes(P))[1]).toBe("A loja vendeu 40 canecas em março.");
    // A pessoa vai para outro parágrafo: o gato grava.
    await t.caps["files.editing"]!({ path: `/${P}`, owner: "notes-1", paragraph: p3 });
    await pending;
    expect(feito).toBe(true);
    expect(texts(t.bytes(P))[1]).toBe("A loja vendeu 41 canecas em março.");
  });

  test("os argumentos errados são recusados", async () => {
    const t = setup(await relatorio());
    const call = async (args: unknown) => {
      try {
        await t.caps["files.editing"]!(args);
        return "ok";
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(await call({ path: P, owner: "notes-1", paragraph: null })).toBe("ok");
    expect(await call({ path: P, owner: "notes-1", paragraph: "" })).toContain("paragraph");
    expect(await call({ path: P, owner: "notes-1", paragraph: 3 })).toContain("paragraph");
    expect(await call({ path: P, owner: "notes-1", paragraph: "1A2B3C4D", cell: null })).toContain("not both");
  });
});
