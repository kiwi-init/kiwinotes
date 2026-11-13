import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DEFAULT_SETTINGS } from "../store/settings.ts";
import path from "node:path";

import { directInvoke } from "../bun/ui-engine.ts";
import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { HistoryStore } from "../store/history.ts";
import {
  appendBlock,
  DICTATION_MARK,
  dictationBlock,
  dictationMark,
  dictationNote,
  dictationRef,
  DictationNotes,
  FALLBACK_TITLE,
  INBOX,
  titleFromDictation,
} from "./fromDictation.ts";
import { Vault } from "./vault.ts";
import { tempDir } from "../../test/tmp.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = tempDir("kiwinotes-fromdictation-");
  dirs.push(d);
  return d;
}

async function vault(files: Record<string, string> = {}) {
  const root = path.join(tmp(), "KiwiNotes");
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  const v = new Vault({ root, debounceMs: 20, trash: async (abs) => rmSync(abs) });
  vaults.push(v);
  await v.open();
  return { v, root, notes: new DictationNotes(v) };
}

/** 3 de novembro de 2026, 14:30, no fuso local (a legenda e o frontmatter usam o fuso de quem ditou). */
const AT = new Date(2026, 10, 3, 14, 30, 12);
/** Ids de ditado como os do Histórico (`<ISO>-<4 hex>`). */
const ID = "2026-11-03T17:30:12.000Z-ab12";
const ID2 = "2026-11-03T17:30:40.000Z-cd34";
const MARK = `*🎙 ditado às 14:30* %%dictation:${ID}%%`;

describe("o formato do trecho ditado (T1320)", () => {
  test("a legenda do B v4 numa linha em itálico, embaixo do texto, com o id do ditado num comentário do Obsidian", () => {
    expect(dictationMark(AT)).toBe("*🎙 ditado às 14:30*");
    expect(dictationBlock("  Ficou decidido começar pela tomografia.  ", AT, ID)).toBe(`Ficou decidido começar pela tomografia.\n${MARK}`);
    expect(DICTATION_MARK.test(dictationBlock("oi", AT, ID))).toBe(true);
    expect(DICTATION_MARK.test("*🎙 ditado às 14:30*")).toBe(true); // as notas do T1320, sem id
    expect(dictationMark(new Date(2026, 0, 1, 9, 5))).toBe("*🎙 ditado às 09:05*");
  });

  test("o id não fecha o comentário nem quebra a linha (T1565)", () => {
    expect(dictationRef(ID)).toBe(`%%dictation:${ID}%%`);
    expect(dictationRef("a%%b\nc d")).toBe("%%dictation:abcd%%");
    expect(() => dictationRef("%%")).toThrow();
  });

  test("a nota nova tem o frontmatter com a data e source: dictation", () => {
    expect(dictationNote("Oi.", AT, ID)).toBe(`---\ndate: 2026-11-03T14:30\nsource: dictation\n---\n\nOi.\n${MARK}\n`);
  });

  test("o título é a 1ª frase, sem pontuação no fim e sem o que um nome de arquivo não leva", () => {
    expect(titleFromDictation("Ficou decidido começar pela tomografia. E o raio-x fica para depois.")).toBe("Ficou decidido começar pela tomografia");
    expect(titleFromDictation("Será que dá? Acho que sim.")).toBe("Será que dá");
    expect(titleFromDictation("Ligar para a Ana amanhã")).toBe("Ligar para a Ana amanhã");
    expect(titleFromDictation("Projeto: PACS/RIS #1 [urgente]")).toBe("Projeto PACS RIS 1 urgente");
    expect(titleFromDictation("v1.2 do app saiu.")).toBe("v1.2 do app saiu");
    expect(titleFromDictation("linha um\nlinha dois")).toBe("linha um linha dois");
    expect(titleFromDictation("...")).toBe(FALLBACK_TITLE);
    expect(titleFromDictation("")).toBe(FALLBACK_TITLE);
  });

  test("um título longo é cortado numa palavra, perto de 60 caracteres", () => {
    const long = "Precisamos revisar todos os contratos de manutenção dos equipamentos de tomografia antes de março";
    const title = titleFromDictation(long);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(long.startsWith(title)).toBe(true);
    expect(long[title.length]).toBe(" ");
  });

  test("acrescentar põe uma linha em branco antes do trecho e termina com quebra de linha", () => {
    expect(appendBlock("# Ideias\n\nUma.\n\n\n", "B\n*m*")).toBe("# Ideias\n\nUma.\n\nB\n*m*\n");
    expect(appendBlock("", "B")).toBe("B\n");
  });
});

describe("DictationNotes (T1320)", () => {
  test("nota nova: em Caixa de entrada/, com título da 1ª frase, e a 2ª vez não duplica", async () => {
    const { v, root, notes } = await vault();
    const text = "Comprar café. E açúcar também.";
    const a = await notes.toNew(text, AT, ID);
    expect(a).toMatchObject({ created: true, already: false, note: { path: `${INBOX}/Comprar café.md`, title: "Comprar café" } });
    expect(readFileSync(path.join(root, a.note.path), "utf8")).toBe(dictationNote(text, AT, ID));
    const b = await notes.toNew(text, AT, ID);
    expect(b).toMatchObject({ created: false, already: true, note: { path: a.note.path } });
    expect(v.list().notes).toHaveLength(1);
  });

  test("dois envios ao mesmo tempo fazem uma nota só", async () => {
    const { v, notes } = await vault();
    const results = await Promise.all([notes.toNew("Oi.", AT, ID), notes.toNew("Oi.", AT, ID), notes.toNew("Oi.", AT, ID)]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(v.list().notes).toHaveLength(1);
  });

  test("outro ditado com a mesma 1ª frase é outra nota (Título 2), não some", async () => {
    const { v, notes } = await vault();
    await notes.toNew("Reunião. Primeira.", AT, ID);
    const later = new Date(AT.getTime() + 60_000);
    const b = await notes.toNew("Reunião. Segunda.", later, ID2);
    expect(b.note.path).toBe(`${INBOX}/Reunião 2.md`);
    expect(v.list().notes).toHaveLength(2);
  });

  test("dois ditados iguais no mesmo minuto são dois trechos: o id decide, não o texto e a hora (T1565)", async () => {
    const { v, root, notes } = await vault({ "Compras.md": "# Compras\n" });
    const sameMinute = new Date(AT.getTime() + 20_000);
    expect((await notes.toNew("Comprar pão.", AT, ID)).created).toBe(true);
    const b = await notes.toNew("Comprar pão.", sameMinute, ID2);
    expect(b).toMatchObject({ created: true, already: false, note: { path: `${INBOX}/Comprar pão 2.md` } });
    expect(v.list().notes.filter((n) => n.folder === INBOX)).toHaveLength(2);
    // No acréscimo, o mesmo: os dois entram na nota.
    await notes.append("Compras.md", "Comprar pão.", AT, ID);
    expect((await notes.append("Compras.md", "Comprar pão.", sameMinute, ID2)).already).toBe(false);
    expect((await notes.append("Compras.md", "Comprar pão.", sameMinute, ID2)).already).toBe(true);
    expect(readFileSync(path.join(root, "Compras.md"), "utf8").match(/Comprar pão\./g)).toHaveLength(2);
  });

  test("o índice atrasado não decide: a nota candidata é relida do disco (T1565)", async () => {
    const { v, root, notes } = await vault();
    const a = await notes.toNew("Ligar para a Ana.", AT, ID);
    // No Obsidian, a pessoa apaga o trecho; o watcher (desligado aqui) ainda não viu, e o índice segue com o id.
    writeFileSync(path.join(root, a.note.path), "---\nsource: dictation\n---\n\nOutra coisa.\n");
    expect(v.notesContaining(dictationRef(ID)).map((n) => n.path)).toEqual([a.note.path]);
    const b = await notes.toNew("Ligar para a Ana.", AT, ID);
    expect(b).toMatchObject({ created: true, already: false, note: { path: `${INBOX}/Ligar para a Ana 2.md` } });
    // E uma candidata que sumiu do disco também não conta.
    const { notes: notes2, root: root2 } = await vault();
    const c = await notes2.toNew("Oi.", AT, ID);
    rmSync(path.join(root2, c.note.path));
    expect((await notes2.toNew("Oi.", AT, ID)).created).toBe(true);
  });

  test("nota rápida (fresh): não procura nada, e cria", async () => {
    const { v, notes } = await vault();
    const calls: string[] = [];
    const original = v.notesContaining.bind(v);
    v.notesContaining = (t: string) => (calls.push(t), original(t));
    expect((await notes.toNew("Oi.", AT, ID, { fresh: true })).created).toBe(true);
    expect(calls).toEqual([]);
  });

  test("acrescentar numa nota que existe: o trecho vai no fim, e a 2ª vez não repete", async () => {
    const { root, notes } = await vault({ "Projetos/PACS.md": "# PACS\n\nMover os estudos.\n" });
    const a = await notes.append("Projetos/PACS.md", "Começar pela tomografia.", AT, ID);
    expect(a).toMatchObject({ created: false, already: false, note: { path: "Projetos/PACS.md" } });
    const after = readFileSync(path.join(root, "Projetos/PACS.md"), "utf8");
    expect(after).toBe(`# PACS\n\nMover os estudos.\n\nComeçar pela tomografia.\n${MARK}\n`);
    expect((await notes.append("Projetos/PACS.md", "Começar pela tomografia.", AT, ID)).already).toBe(true);
    expect(readFileSync(path.join(root, "Projetos/PACS.md"), "utf8")).toBe(after);
  });

  test("uma edição de fora no meio (o Obsidian) não se perde: acrescenta na versão de agora", async () => {
    const { v, root } = await vault({ "Ideias.md": "Uma.\n" });
    const abs = path.join(root, "Ideias.md");
    let raced = false;
    // O vault de verdade, com a 1ª leitura "velha": entre o get e o save, alguém escreve no arquivo.
    const racing = {
      open: () => v.open(),
      create: v.create.bind(v),
      notesContaining: v.notesContaining.bind(v),
      get: async (p: unknown) => {
        const note = await v.get(p);
        if (!raced) {
          raced = true;
          writeFileSync(abs, "Uma.\nDuas, do Obsidian.\n");
        }
        return note;
      },
      save: v.save.bind(v),
    };
    const r = await new DictationNotes(racing).append("Ideias.md", "Três.", AT, ID);
    expect(r.already).toBe(false);
    expect(readFileSync(abs, "utf8")).toBe(`Uma.\nDuas, do Obsidian.\n\nTrês.\n${MARK}\n`);
  });

  test("nota que não existe ou fora do vault: o erro do vault, sem criar nada", async () => {
    const { v, notes } = await vault();
    await expect(notes.append("Nada.md", "x", AT, ID)).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    await expect(notes.append("../fora.md", "x", AT, ID)).rejects.toMatchObject({ code: "E_OUTSIDE_VAULT" });
    expect(v.list().notes).toHaveLength(0);
    // Depois de um erro, a fila segue andando.
    expect((await notes.toNew("Oi.", AT, ID)).created).toBe(true);
  });
});

describe("history.toNote, a capacidade do Histórico (T1320)", () => {
  async function rig() {
    const { v, root, notes } = await vault({ "Projetos/PACS.md": "# PACS\n" });
    const history = new HistoryStore(path.join(tmp(), "data"));
    const caps = uiCapabilities({
      dictionary: { load: async () => [], save: async (t) => t },
      snippets: { load: async () => [], save: async (s) => s },
      history,
      dictationNotes: notes,
      settings: { load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }), save: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }) },
      clipboardWrite: () => {},
      notes: v,
    });
    const call = (args: unknown) => directInvoke(caps, "history.toNote", args);
    return { v, root, history, call };
  }

  test("sem path, uma nota nova com o texto do ditado e a hora dele; de novo, a mesma", async () => {
    const { v, root, history, call } = await rig();
    const entry = await history.add({ raw: "x", text: "Ligar para a Ana. Sobre o laudo.", at: AT });
    const first = await call({ id: entry.id });
    expect(first).toMatchObject({ ok: true, value: { created: true, already: false, note: { path: `${INBOX}/Ligar para a Ana.md` } } });
    expect(readFileSync(path.join(root, `${INBOX}/Ligar para a Ana.md`), "utf8")).toContain("*🎙 ditado às 14:30*");
    expect(await call({ id: entry.id })).toMatchObject({ ok: true, value: { created: false, already: true } });
    expect(v.list().notes.filter((n) => n.folder === INBOX)).toHaveLength(1);
  });

  test("com path, no fim da nota que existe", async () => {
    const { root, history, call } = await rig();
    const entry = await history.add({ raw: "x", text: "Começar pela tomografia.", at: AT });
    expect(await call({ id: entry.id, path: "Projetos/PACS.md" })).toMatchObject({ ok: true, value: { already: false } });
    expect(readFileSync(path.join(root, "Projetos/PACS.md"), "utf8")).toBe(`# PACS\n\nComeçar pela tomografia.\n*🎙 ditado às 14:30* %%dictation:${entry.id}%%\n`);
  });

  test("argumentos ruins e ditado que não existe", async () => {
    const { history, call } = await rig();
    const entry = await history.add({ raw: "x", text: "Oi.", at: AT });
    expect(await call({})).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call({ id: entry.id, extra: 1 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call({ id: entry.id, path: 3 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call({ id: "2026-11-03T17:30:12.000Z-dead" })).toMatchObject({ ok: false, code: "E_NOT_FOUND" });
    expect(await call({ id: "lixo" })).toMatchObject({ ok: false, code: "E_NOT_FOUND" });
    expect(await call({ id: entry.id, path: "../fora.md" })).toMatchObject({ ok: false, code: "E_OUTSIDE_VAULT" });
  });
});

describe("HistoryStore.get (T1320)", () => {
  test("acha o ditado pelo id, e null para o que não existe ou foi apagado", async () => {
    const history = new HistoryStore(path.join(tmp(), "data"));
    const a = await history.add({ raw: "a", text: "A", at: new Date(2026, 10, 2, 23, 59) });
    const b = await history.add({ raw: "b", text: "B", at: new Date(2026, 10, 3, 0, 1) });
    expect((await history.get(a.id))?.text).toBe("A");
    expect((await history.get(b.id))?.text).toBe("B");
    expect(await history.get("lixo")).toBeNull();
    expect(await history.get(`${a.id.slice(0, 24)}-ffff`)).toBeNull();
    await history.delete(a.id);
    expect(await history.get(a.id)).toBeNull();
  });
});
