// O desfazer das mudanças do agente (spec #9353), sobre um cofre de verdade num tmp, as mesmas capacidades das janelas
// (`uiCapabilities`), o histórico de versões das Notas e o registro do agente. As escritas são as ferramentas do Kiwi de
// verdade (`runKiwiTool`), como o agente falso as chama; nenhum agente roda aqui.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { uiCapabilities, type CapabilityDeps } from "../bun/ui-capabilities.ts";
import { NotesFolders } from "../notes/folders-workspace.ts";
import { Vault } from "../notes/vault.ts";
import { NoteVersions } from "../notes/versions.ts";
import { DEFAULT_SETTINGS, SettingsStore } from "../store/settings.ts";
import { HistoryStore } from "../store/history.ts";
import { ACTIVITY_KEEP_MS, AgentActivity } from "./activity.ts";
import { readerFromCapabilities } from "./tools/reader.ts";
import { runKiwiTool } from "./tools/tools.ts";
import { writerFromCapabilities } from "./tools/writer.ts";
import { keyOf, undo, UNDO_CAPABILITIES, undoNotesFromCapabilities, UndoError } from "./undo.ts";
import { viewChange } from "./change-view.ts";
import { tempDir } from "../../test/tmp.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const KIWI = "# Kiwi\n\nO Kiwi é um app de notas.\n\n## Prazo\n\nO prazo do Kiwi é março.\n\n## Equipe\n\nharry e jow.\n";
const IDEIAS = "# Ideias\n\nideias soltas\n";

type Caps = Record<string, (a: unknown) => unknown>;

/** O agente e o desfazer sobre as capacidades `caps`, com um relógio que só anda quando o teste manda. */
function harness(caps: Caps, base: string) {
  let clock = Date.parse("2026-11-13T12:00:00.000Z");
  const now = () => clock;
  const activity = new AgentActivity({ dir: path.join(base, "agent", "activity"), now });
  const reader = readerFromCapabilities(caps as never);
  const writer = writerFromCapabilities(caps as never);
  // As capacidades que o desfazer chama, anotadas: só as quatro dele.
  const called = new Set<string>();
  const recorded = new Proxy(caps, { get: (t, cap: string) => (a: unknown) => (called.add(cap), t[cap]!(a)) });
  const notes = undoNotesFromCapabilities(recorded as never);
  let n = 0;
  return {
    activity,
    called,
    tick: (ms = 1000) => (clock += ms),
    /** Um pedido novo ao agente: devolve o id dele. */
    request: async (text = "um pedido") => {
      const id = `p${++n}`;
      await activity.begin(id, text);
      return id;
    },
    /** O agente usa uma ferramenta de escrita no pedido `id`, e o registro anota, como o serviço faz. */
    write: async (id: string, tool: string, args: unknown) => {
      clock += 1000;
      const journal = { keep: (_p: string, before: string) => activity.keep(id, before), drop: (c: string) => activity.drop(c) };
      const r = await runKiwiTool({ reader, writer, journal }, tool, args);
      if (r.change) await activity.change(id, r.change);
      return r.value as Record<string, any>;
    },
    undo: (id: string, change?: number) => undo({ activity, notes, now }, id, change),
    /** O [Ver] da tela "Atividade do agente" (spec #9480). */
    view: (id: string, change: number) => viewChange({ activity, notes }, id, change),
  };
}

async function setup() {
  // O tempDir apaga no fim do teste e, no fim da suíte, de novo: o vault grava atrasado e recriava a pasta (#10966).
  const base = tempDir("kiwi-undo-");
  const root = path.join(base, "KiwiNotes");
  for (const [rel, content] of Object.entries({ "Projetos/Kiwi.md": KIWI, "Ideias.md": IDEIAS })) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  const trashed: string[] = [];
  const v = new Vault({ root, debounceMs: 20, trash: async (p) => void trashed.push(p) });
  const versions = new NoteVersions({ dir: path.join(base, "history") });
  const caps = uiCapabilities({
    dictionary: { load: async () => [], save: async (t) => t },
    snippets: { load: async () => [], save: async (s) => s },
    history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
    dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
    settings: { load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }), save: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }) },
    clipboardWrite: () => {},
    notes: v,
    versions,
  }) as Caps;
  const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
  /** Os textos das Versões de uma nota. */
  const versionTexts = async (p: string) => {
    const list = ((await caps["notes.versions"]!({ path: p })) as { versions: { id: string }[] }).versions;
    const out: string[] = [];
    for (const x of list) out.push(((await caps["notes.version"]!({ path: p, id: x.id })) as { content: string }).content);
    return out;
  };
  return { base, root, v, caps, read, versionTexts, trashed, ...harness(caps, base) };
}

const PRAZO_ABRIL = "# Kiwi\n\nO Kiwi é um app de notas.\n\n## Prazo\n\nO prazo é abril.\n\n## Equipe\n\nharry e jow.\n";

describe("o desfazer das mudanças do agente (spec #9353)", () => {
  test("uma mudança volta ao texto de antes; o texto do agente fica nas Versões; o registro anota; de novo não faz nada", async () => {
    const t = await setup();
    const id = await t.request("mude o prazo para abril");
    const { versao } = await t.write(id, "notes_read", { path: "Projetos/Kiwi.md" });
    await t.write(id, "notes_write", { path: "Projetos/Kiwi.md", section: "Prazo", text: "O prazo é abril.", version: versao });
    expect(t.read("Projetos/Kiwi.md")).toBe(PRAZO_ABRIL);

    t.tick(60_000);
    expect(await t.undo(id, 1)).toEqual({ request: id, notes: [{ path: "Projetos/Kiwi.md", result: "restored", changes: [1] }] });
    expect(t.read("Projetos/Kiwi.md")).toBe(KIWI);
    // O texto que o agente tinha escrito está nas Versões, na hora.
    expect(await t.versionTexts("Projetos/Kiwi.md")).toContain(PRAZO_ABRIL);
    // O registro: o que foi desfeito e quando.
    const [r] = await t.activity.list();
    expect(r!.changes[0]!.undone).toBe("2026-11-13T12:01:02.000Z");
    // Desfazer de novo: nada muda, e diz.
    expect(await t.undo(id, 1)).toEqual({
      request: id,
      notes: [{ path: "Projetos/Kiwi.md", result: "already", changes: [1], message: "Já tinha sido desfeita." }],
    });
    expect(await t.undo(id)).toMatchObject({ notes: [{ path: "Projetos/Kiwi.md", result: "already", changes: [1] }] });
    expect(t.read("Projetos/Kiwi.md")).toBe(KIWI);
    // Só as quatro capacidades do desfazer.
    expect([...t.called].every((c) => (UNDO_CAPABILITIES as readonly string[]).includes(c))).toBe(true);
  });

  test("o pedido inteiro: várias escritas na mesma nota voltam ao texto de antes da primeira, e cada nota volta", async () => {
    const t = await setup();
    const id = await t.request();
    await t.write(id, "notes_append", { path: "Projetos/Kiwi.md", section: "Equipe", text: "e o gato." });
    const { versao } = await t.write(id, "notes_read", { path: "Projetos/Kiwi.md" });
    await t.write(id, "notes_write", { path: "Projetos/Kiwi.md", section: "Prazo", text: "O prazo é abril.", version: versao });
    await t.write(id, "notes_append", { path: "Ideias.md", text: "- uma ideia do agente" });
    await t.write(id, "notes_create", { folder: "Projetos", title: "Resumo", text: "# Resumo\n\nfeito pelo agente\n" });
    expect(t.read("Ideias.md")).not.toBe(IDEIAS);

    const r = await t.undo(id);
    expect(r.notes).toEqual([
      { path: "Projetos/Kiwi.md", result: "restored", changes: [1, 2] },
      { path: "Ideias.md", result: "restored", changes: [3] },
      { path: "Projetos/Resumo.md", result: "trashed", changes: [4] },
    ]);
    expect(t.read("Projetos/Kiwi.md")).toBe(KIWI);
    expect(t.read("Ideias.md")).toBe(IDEIAS);
    expect(existsSync(path.join(t.root, "Projetos/Resumo.md"))).toBe(false);
    expect((await t.activity.get(id))!.changes.every((c) => c.undone)).toBe(true);
    expect((await t.undo(id)).notes.map((n) => n.result)).toEqual(["already", "already", "already"]);
  });

  test("uma mudança com outra escrita depois, na mesma nota, é recusada com o caminho; desfeita a mais nova, a velha passa", async () => {
    const t = await setup();
    const id = await t.request();
    await t.write(id, "notes_append", { path: "Ideias.md", text: "- primeira" });
    const afterFirst = t.read("Ideias.md");
    await t.write(id, "notes_append", { path: "Ideias.md", text: "- segunda" });
    const afterSecond = t.read("Ideias.md");

    const refused = await t.undo(id, 1);
    expect(refused.notes).toEqual([
      {
        path: "Ideias.md",
        result: "refused",
        changes: [1],
        reason: "E_LATER_WRITE",
        message: "Depois desta, o agente escreveu de novo em Ideias.md (a mudança 2 deste pedido). Desfaça primeiro a mais nova, ou o pedido inteiro.",
        // Para a tela (spec #9480): a mudança e o pedido, com a hora dele.
        later: { request: id, change: 2, at: "2026-11-13T12:00:00.000Z" },
      },
    ]);
    expect(t.read("Ideias.md")).toBe(afterSecond);

    expect((await t.undo(id, 2)).notes[0]!.result).toBe("restored");
    expect(t.read("Ideias.md")).toBe(afterFirst);
    expect((await t.undo(id, 1)).notes[0]!.result).toBe("restored");
    expect(t.read("Ideias.md")).toBe(IDEIAS);
  });

  test("uma escrita do agente na mesma nota, num pedido depois, também vem primeiro", async () => {
    const t = await setup();
    const p1 = await t.request();
    await t.write(p1, "notes_append", { path: "Ideias.md", text: "- do pedido 1" });
    const p2 = await t.request();
    await t.write(p2, "notes_append", { path: "Ideias.md", text: "- do pedido 2" });

    expect((await t.undo(p1)).notes[0]).toMatchObject({
      result: "refused",
      reason: "E_LATER_WRITE",
      message: `Depois desta, o agente escreveu de novo em Ideias.md, no pedido ${p2} (a mudança 1). Desfaça primeiro aquele.`,
      later: { request: p2, change: 1, at: (await t.activity.get(p2))!.at },
    });
    expect((await t.undo(p2)).notes[0]!.result).toBe("restored");
    expect((await t.undo(p1)).notes[0]!.result).toBe("restored");
    expect(t.read("Ideias.md")).toBe(IDEIAS);
  });

  test("a nota criada vai para a Lixeira só se ninguém escreveu nela, e o Desfazer do app a traz de volta nos 10 minutos", async () => {
    const t = await setup();
    const id = await t.request();
    const { path: p } = await t.write(id, "notes_create", { folder: "Projetos", title: "Resumo", text: "# Resumo\n\nfeito pelo agente\n" });
    // A pessoa escreveu nela: fica.
    const n = (await t.caps["notes.get"]!({ path: p })) as { version: string };
    await t.caps["notes.save"]!({ path: p, content: "# Resumo\n\nfeito pelo agente\n\nE uma linha minha.\n", baseVersion: n.version });
    expect((await t.undo(id)).notes[0]).toMatchObject({ result: "refused", reason: "E_CHANGED", message: `${p} mudou depois que o agente a criou. Ela fica onde está.` });
    expect(existsSync(path.join(t.root, p))).toBe(true);

    // Outra nota criada, intocada: vai.
    const id2 = await t.request();
    const { path: q } = await t.write(id2, "notes_create", { title: "Rascunho", text: "rascunho do agente" });
    expect((await t.undo(id2)).notes).toEqual([{ path: q, result: "trashed", changes: [1] }]);
    expect(existsSync(path.join(t.root, q))).toBe(false);
    // Dentro dos 10 minutos, o Desfazer das Notas (o `notes.restore`) traz de volta; nada foi para a Lixeira do macOS.
    expect(t.trashed).toEqual([]);
    await t.caps["notes.restore"]!({ path: q });
    expect(t.read(q)).toBe("rascunho do agente");
  });

  test("a nota editada, renomeada, movida ou apagada depois do agente: nada muda, e o texto de antes continua guardado", async () => {
    const t = await setup();
    const edits: [string, () => Promise<unknown>][] = [
      ["editada", async () => {
        const n = (await t.caps["notes.get"]!({ path: "Ideias.md" })) as { content: string; version: string };
        await t.caps["notes.save"]!({ path: "Ideias.md", content: `${n.content}\numa linha da pessoa, em outro trecho\n`, baseVersion: n.version });
      }],
      ["renomeada", () => Promise.resolve(t.caps["notes.rename"]!({ path: "Ideias.md", newPath: "Ideias 2.md" }))],
      ["movida", () => Promise.resolve(t.caps["notes.move"]!({ path: "Ideias.md", folder: "Projetos" }))],
      ["apagada", () => Promise.resolve(t.caps["notes.delete"]!({ path: "Ideias.md" }))],
    ];
    for (const [what, edit] of edits) {
      // Uma nota nova a cada volta, com o mesmo nome.
      if (!existsSync(path.join(t.root, "Ideias.md"))) writeFileSync(path.join(t.root, "Ideias.md"), IDEIAS);
      await t.v.open();
      await t.caps["notes.list"]!({});
      const id = await t.request(what);
      await t.write(id, "notes_append", { path: "Ideias.md", text: `- do agente (${what})` });
      await edit();
      const snapshot = existsSync(path.join(t.root, "Ideias.md")) ? t.read("Ideias.md") : null;
      const [n] = (await t.undo(id)).notes;
      expect(n).toMatchObject({ path: "Ideias.md", result: "refused", reason: what === "editada" ? "E_CHANGED" : "E_GONE" });
      expect(existsSync(path.join(t.root, "Ideias.md")) ? t.read("Ideias.md") : null).toBe(snapshot);
      // O texto de antes continua no registro, e a mudança não foi anotada como desfeita.
      const c = (await t.activity.get(id))!.changes[0]!;
      expect(await t.activity.copy(c.copy!)).toBe(IDEIAS);
      expect(c.undone).toBeUndefined();
      // Arruma para a próxima volta.
      for (const p of ["Ideias.md", "Ideias 2.md", "Projetos/Ideias.md"]) rmSync(path.join(t.root, p), { force: true });
    }
  });

  test("um pedido com várias notas se desfaz nota por nota: o resultado diz quais voltaram e por que as outras não", async () => {
    const t = await setup();
    const id = await t.request();
    await t.write(id, "notes_append", { path: "Ideias.md", text: "- do agente" });
    await t.write(id, "notes_append", { path: "Projetos/Kiwi.md", text: "Mais uma linha." });
    const n = (await t.caps["notes.get"]!({ path: "Ideias.md" })) as { content: string; version: string };
    await t.caps["notes.save"]!({ path: "Ideias.md", content: n.content + "da pessoa\n", baseVersion: n.version });

    const r = await t.undo(id);
    expect(r.notes.map((x) => [x.path, x.result, x.reason])).toEqual([
      ["Ideias.md", "refused", "E_CHANGED"],
      ["Projetos/Kiwi.md", "restored", undefined],
    ]);
    expect(t.read("Projetos/Kiwi.md")).toBe(KIWI);
    expect(t.read("Ideias.md")).toBe(n.content + "da pessoa\n");
    // A que voltou fica anotada; a outra não, e pode ser tentada de novo depois.
    expect((await t.activity.get(id))!.changes.map((c) => !!c.undone)).toEqual([false, true]);
  });

  test("30 dias pela idade da mudança: depois disso, não há mais o que desfazer, mesmo com a cópia no disco", async () => {
    const t = await setup();
    const id = await t.request();
    await t.write(id, "notes_append", { path: "Ideias.md", text: "- velho" });
    const after = t.read("Ideias.md");
    t.tick(ACTIVITY_KEEP_MS + 5_000);
    expect((await t.undo(id)).notes[0]).toMatchObject({ result: "refused", reason: "E_EXPIRED" });
    expect(t.read("Ideias.md")).toBe(after);
    // O próximo pedido limpa o registro velho: aí o pedido nem está mais lá.
    await t.request();
    await expect(t.undo(id)).rejects.toBeInstanceOf(UndoError);
  });

  test("um pedido ou uma mudança que não está no registro", async () => {
    const t = await setup();
    await expect(t.undo("nao-existe")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    await expect(t.undo("../fora")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    const id = await t.request();
    await t.write(id, "notes_append", { path: "Ideias.md", text: "- x" });
    await expect(t.undo(id, 2)).rejects.toMatchObject({ code: "E_NOT_FOUND", message: `O pedido ${id} não tem a mudança 2.` });
    // Um pedido que só leu: nada a desfazer.
    const leu = await t.request();
    await t.write(leu, "notes_read", { path: "Ideias.md" });
    expect(await t.undo(leu)).toEqual({ request: leu, notes: [] });
  });

  test("um desfazer que gravou e não chegou a anotar: na próxima vez, só anota", async () => {
    const t = await setup();
    const id = await t.request();
    await t.write(id, "notes_append", { path: "Ideias.md", text: "- x" });
    const n = (await t.caps["notes.get"]!({ path: "Ideias.md" })) as { version: string };
    await t.caps["notes.save"]!({ path: "Ideias.md", content: IDEIAS, baseVersion: n.version });
    expect((await t.undo(id)).notes[0]).toMatchObject({ result: "already", message: "Já estava de volta ao texto de antes." });
    expect((await t.activity.get(id))!.changes[0]!.undone).toBeString();
  });

  test("a gravação conferida: uma edição da pessoa bem no meio do desfazer não se perde", async () => {
    const t = await setup();
    const id = await t.request();
    await t.write(id, "notes_append", { path: "Ideias.md", text: "- x" });
    (t.v as any).beforeReplace = () => writeFileSync(path.join(t.root, "Ideias.md"), "a pessoa escreveu bem agora\n");
    expect((await t.undo(id)).notes[0]).toMatchObject({ result: "refused", reason: "E_CHANGED" });
    (t.v as any).beforeReplace = undefined;
    expect(t.read("Ideias.md")).toBe("a pessoa escreveu bem agora\n");
    expect((await t.activity.get(id))!.changes[0]!.undone).toBeUndefined();
  });

  test("uma ida à Lixeira recusada não leva embora o Desfazer de um apagar anterior do mesmo caminho (revisão do T9398)", async () => {
    const t = await setup();
    // Uma nota apagada (o Desfazer de 10 min começa), e outra criada com o mesmo nome.
    const first = (await t.caps["notes.create"]!({ title: "Rascunho", content: "a primeira" })) as { path: string };
    await t.caps["notes.delete"]!({ path: first.path });
    const again = (await t.caps["notes.create"]!({ title: "Rascunho", content: "a segunda" })) as { path: string; version: string };
    expect(again.path).toBe(first.path);
    // O apagar conferido passa na 1ª conferência e é recusado na 2ª, logo antes de a nota sair do lugar.
    (t.v as any).beforeReplace = () => writeFileSync(path.join(t.root, again.path), "a pessoa escreveu bem agora\n");
    await expect(Promise.resolve(t.caps["notes.delete"]!({ path: again.path, baseVersion: again.version }))).rejects.toMatchObject({ code: "E_CONFLICT" });
    (t.v as any).beforeReplace = undefined;
    expect(t.read(again.path)).toBe("a pessoa escreveu bem agora\n");
    // A primeira continua no Desfazer: nada foi para a Lixeira do macOS.
    expect(t.trashed).toEqual([]);
    rmSync(path.join(t.root, again.path));
    await t.caps["notes.restore"]!({ path: first.path });
    expect(t.read(first.path)).toBe("a primeira");
  });

  test("a ida à Lixeira conferida: uma edição bem no meio deixa a nota criada no lugar", async () => {
    const t = await setup();
    const id = await t.request();
    const { path: p } = await t.write(id, "notes_create", { title: "Rascunho", text: "do agente" });
    (t.v as any).beforeReplace = () => writeFileSync(path.join(t.root, p), "a pessoa escreveu bem agora\n");
    expect((await t.undo(id)).notes[0]).toMatchObject({ result: "refused", reason: "E_CHANGED" });
    (t.v as any).beforeReplace = undefined;
    expect(t.read(p)).toBe("a pessoa escreveu bem agora\n");
    await expect(Promise.resolve(t.caps["notes.restore"]!({ path: p }))).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  });
});

describe("o desfazer e a pasta de notas (spec #9353)", () => {
  async function rig() {
    const root = realpathSync(tempDir("kiwi-undo-folders-"));
    const home = path.join(root, "home");
    const dir = path.join(root, "data");
    const defaultRoot = path.join(home, "KiwiNotes");
    const a = path.join(home, "Obsidian A");
    const b = path.join(home, "Obsidian B");
    for (const p of [defaultRoot, a, b]) mkdirSync(p, { recursive: true });
    writeFileSync(path.join(a, "Ideias.md"), IDEIAS);
    writeFileSync(path.join(b, "Ideias.md"), IDEIAS);
    const internalNotes = new Vault({ root: defaultRoot, watch: false, trash: async () => {} });
    const folders = new NotesFolders({ dir, defaultRoot, globalSettings: new SettingsStore(dir), internalNotes, home, watch: false, limit: 20_000 });
    cleanups.push(() => folders.close());
    let chosen = a;
    const caps = uiCapabilities({
      ...folders.fixed,
      notesFolders: folders,
      chooseNotesFolder: async () => chosen,
      history: new HistoryStore(dir),
      dictionary: { load: async () => [], save: async () => [] },
      snippets: { load: async () => [], save: async () => [] },
      clipboardWrite: () => {},
      settingsChanged: () => {},
    } as CapabilityDeps) as Caps;
    const open = async (p: string) => {
      chosen = p;
      await caps["notes.openFolder"]!({});
    };
    return { a, b, caps, open, ...harness(caps, root) };
  }

  test("com outra pasta de notas aberta, o desfazer avisa e não muda nada; de volta à pasta, ele age", async () => {
    const r = await rig();
    await r.open(r.a);
    const id = await r.request();
    await r.write(id, "notes_append", { path: "Ideias.md", text: "- na pasta A" });
    const inA = readFileSync(path.join(r.a, "Ideias.md"), "utf8");
    const change = (await r.activity.get(id))!.changes[0]!;
    expect(change.folder).toMatch(/:\d+$/);

    await r.open(r.b);
    expect((await r.undo(id)).notes[0]).toMatchObject({ result: "refused", reason: "E_OTHER_FOLDER" });
    // Nada mudou em nenhuma das duas: a nota de mesmo nome na pasta B fica como estava.
    expect(readFileSync(path.join(r.a, "Ideias.md"), "utf8")).toBe(inA);
    expect(readFileSync(path.join(r.b, "Ideias.md"), "utf8")).toBe(IDEIAS);

    // A pasta A de novo: o id é outro (a pasta reabriu), mas é a mesma pasta.
    await r.open(r.a);
    expect(((await r.caps["notes.folder"]!({})) as { current: { id: string } }).current.id).not.toBe(change.folder);
    expect((await r.undo(id)).notes[0]).toMatchObject({ result: "restored" });
    expect(readFileSync(path.join(r.a, "Ideias.md"), "utf8")).toBe(IDEIAS);
  });

  test("a nota de mesmo nome em outra pasta é outra nota: a escrita nela não prende o desfazer desta (revisão do T9398)", async () => {
    const r = await rig();
    await r.open(r.a);
    const p1 = await r.request();
    await r.write(p1, "notes_append", { path: "Ideias.md", text: "- na pasta A" });
    await r.open(r.b);
    const p2 = await r.request();
    await r.write(p2, "notes_append", { path: "Ideias.md", text: "- na pasta B" });
    const inB = readFileSync(path.join(r.b, "Ideias.md"), "utf8");

    await r.open(r.a);
    // O p2 é da pasta B: daqui, ele avisa; o p1 volta, sem precisar do p2.
    expect((await r.undo(p2)).notes[0]).toMatchObject({ result: "refused", reason: "E_OTHER_FOLDER" });
    expect((await r.undo(p1)).notes).toEqual([{ path: "Ideias.md", result: "restored", changes: [1] }]);
    expect(readFileSync(path.join(r.a, "Ideias.md"), "utf8")).toBe(IDEIAS);
    expect(readFileSync(path.join(r.b, "Ideias.md"), "utf8")).toBe(inB);
  });

  test("um pedido que escreveu na mesma nota de duas pastas: cada pasta é uma nota no resultado", async () => {
    const r = await rig();
    await r.open(r.a);
    const id = await r.request();
    await r.write(id, "notes_append", { path: "Ideias.md", text: "- na pasta A" });
    await r.open(r.b);
    await r.write(id, "notes_append", { path: "Ideias.md", text: "- na pasta B" });
    // Na pasta B: a mudança 2 volta, e a 1 (da pasta A) não fica presa pela 2.
    expect((await r.undo(id, 1)).notes[0]).toMatchObject({ result: "refused", reason: "E_OTHER_FOLDER" });
    expect((await r.undo(id)).notes).toEqual([
      expect.objectContaining({ path: "Ideias.md", result: "refused", changes: [1], reason: "E_OTHER_FOLDER" }),
      { path: "Ideias.md", result: "restored", changes: [2] },
    ]);
    expect(readFileSync(path.join(r.b, "Ideias.md"), "utf8")).toBe(IDEIAS);
    await r.open(r.a);
    expect((await r.undo(id)).notes).toEqual([
      { path: "Ideias.md", result: "restored", changes: [1] },
      expect.objectContaining({ result: "already", changes: [2] }),
    ]);
    expect(readFileSync(path.join(r.a, "Ideias.md"), "utf8")).toBe(IDEIAS);
  });

  test("o [Ver] com outra pasta de notas aberta: só o antes, e nunca lê a nota de mesmo nome da pasta errada (spec #9480)", async () => {
    const r = await rig();
    await r.open(r.a);
    const id = await r.request();
    await r.write(id, "notes_append", { path: "Ideias.md", text: "- na pasta A" });
    const inA = readFileSync(path.join(r.a, "Ideias.md"), "utf8");
    await r.open(r.b);
    const other = await r.view(id, 1);
    expect(other).toMatchObject({ before: IDEIAS, state: "otherFolder" });
    expect(other.after).toBeUndefined();
    await r.open(r.a);
    expect(await r.view(id, 1)).toMatchObject({ state: "exact", after: inA });
  });

  test("a chave da pasta sai do id que o escritor anotou", () => {
    expect(keyOf("0123456789abcdef0123:7")).toBe("0123456789abcdef0123");
    expect(keyOf("internal:0123456789abcdef0123")).toBe("0123456789abcdef0123");
  });
});

describe("o [Ver] de uma mudança do agente (spec #9480)", () => {
  test("o antes e o depois exato; na 1ª de duas escritas na mesma nota, o depois é o que ela deixou, não a nota de agora", async () => {
    const t = await setup();
    const id = await t.request();
    await t.write(id, "notes_append", { path: "Ideias.md", text: "- primeira" });
    const afterFirst = t.read("Ideias.md");
    await t.write(id, "notes_append", { path: "Ideias.md", text: "- segunda" });
    const afterSecond = t.read("Ideias.md");

    expect(await t.view(id, 1)).toMatchObject({ request: id, change: 1, path: "Ideias.md", kind: "appended", before: IDEIAS, state: "exact", after: afterFirst });
    expect(await t.view(id, 2)).toMatchObject({ before: afterFirst, state: "exact", after: afterSecond });
    // Só lê: nada mudou, e só as capacidades de leitura.
    expect(t.read("Ideias.md")).toBe(afterSecond);
    expect([...t.called].sort()).toEqual(["notes.folder", "notes.get"]);
  });

  test("a escrita seguinte num outro pedido também dá o depois exato", async () => {
    const t = await setup();
    const p1 = await t.request();
    await t.write(p1, "notes_append", { path: "Ideias.md", text: "- do pedido 1" });
    const afterP1 = t.read("Ideias.md");
    const p2 = await t.request();
    await t.write(p2, "notes_append", { path: "Ideias.md", text: "- do pedido 2" });
    expect(await t.view(p1, 1)).toMatchObject({ state: "exact", after: afterP1 });
  });

  test("a nota criada: o antes é vazio, e o depois é o texto dela", async () => {
    const t = await setup();
    const id = await t.request();
    const { path: p } = await t.write(id, "notes_create", { folder: "Projetos", title: "Resumo", text: "# Resumo\n\nfeito pelo agente\n" });
    expect(await t.view(id, 1)).toMatchObject({ path: p, kind: "created", before: "", state: "exact", after: t.read(p) });
  });

  test("a nota mudada depois do agente: o depois é a nota de agora, marcado como mudado", async () => {
    const t = await setup();
    const id = await t.request();
    await t.write(id, "notes_append", { path: "Ideias.md", text: "- do agente" });
    const n = (await t.caps["notes.get"]!({ path: "Ideias.md" })) as { content: string; version: string };
    await t.caps["notes.save"]!({ path: "Ideias.md", content: n.content + "- minha\n", baseVersion: n.version });
    expect(await t.view(id, 1)).toMatchObject({ before: IDEIAS, state: "changed", after: t.read("Ideias.md") });
  });

  test("a nota que sumiu, a mudança já desfeita e a cópia que não está mais lá: só o antes (ou nada)", async () => {
    const t = await setup();
    const id = await t.request();
    await t.write(id, "notes_append", { path: "Ideias.md", text: "- do agente" });
    await t.write(id, "notes_append", { path: "Projetos/Kiwi.md", section: "Equipe", text: "e o gato." });
    await t.caps["notes.rename"]!({ path: "Ideias.md", newPath: "Outras ideias.md" });
    const gone = await t.view(id, 1);
    expect(gone).toMatchObject({ before: IDEIAS, state: "gone" });
    expect(gone.after).toBeUndefined();

    t.tick(5000);
    expect((await t.undo(id, 2)).notes[0]!.result).toBe("restored");
    const undone = await t.view(id, 2);
    expect(undone).toMatchObject({ before: KIWI, state: "undone", undone: expect.any(String) });
    expect(undone.after).toBeUndefined();

    // A cópia de antes sumiu do registro: o antes é null.
    const copy = (await t.activity.get(id))!.changes[0]!.copy!;
    const dir = path.join(t.base, "agent", "activity");
    const folder = (await Array.fromAsync(new Bun.Glob(`*_${id}`).scan({ cwd: dir, onlyFiles: false })))[0]!;
    rmSync(path.join(dir, folder, copy.split("/")[1]!));
    expect((await t.view(id, 1)).before).toBeNull();
  });

  test("um pedido ou uma mudança que não está no registro", async () => {
    const t = await setup();
    await expect(t.view("nao-existe", 1)).rejects.toBeInstanceOf(UndoError);
    const id = await t.request();
    await expect(t.view(id, 1)).rejects.toBeInstanceOf(UndoError);
    await expect(t.view("../fora", 1)).rejects.toBeInstanceOf(UndoError);
  });
});

