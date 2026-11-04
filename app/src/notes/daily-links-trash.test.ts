// T2593: a nota do dia, o link que cria a nota, "Mencionada sem link" e a Lixeira do app. Tudo num tmp.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { directInvoke } from "../bun/ui-engine.ts";
import { type AppSettings, DEFAULT_SETTINGS } from "../store/settings.ts";
import { contextOf, linkSpans, unlinkedSpans } from "./mentions.ts";
import { isDate, localDate, UNDO_DIR, Vault } from "./vault.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function files(root: string, f: Record<string, string>) {
  for (const [rel, content] of Object.entries(f)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
}

async function vault(f: Record<string, string> = {}, o: { undoMs?: number; now?: () => number } = {}) {
  const root = path.join(mkdtempSync(path.join(tmpdir(), "kn-2593-")), "V");
  dirs.push(path.dirname(root));
  files(root, f);
  const trashed: string[] = [];
  const make = () =>
    new Vault({
      root,
      undoMs: o.undoMs ?? 60_000,
      now: o.now,
      trash: async (abs) => {
        trashed.push(path.relative(root, abs));
        rmSync(abs, { recursive: true });
      },
    });
  const v = make();
  await v.open();
  const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
  return { v, root, trashed, read, make };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

describe("a nota do dia", () => {
  test("cria vazia na pasta, na data local, e da 2ª vez devolve a mesma", async () => {
    const now = () => new Date(2026, 10, 4, 23, 30).getTime(); // 23h30 local de 4/11: ainda é dia 4
    const { v, read } = await vault({}, { now });
    const n = await v.daily(undefined, "Diário");
    expect(n).toMatchObject({ path: "Diário/2026-11-04.md", content: "" });
    writeFileSync(path.join(v.root, "Diário/2026-11-04.md"), "já escrevi");
    expect((await v.daily(undefined, "Diário")).content).toBe("já escrevi");
    expect(read("Diário/2026-11-04.md")).toBe("já escrevi");
    expect((await v.daily("2026-01-31", "Diário/Arquivo")).path).toBe("Diário/Arquivo/2026-01-31.md");
    expect(await code(v.daily("2026-02-30", "Diário"))).toBe("E_BAD_ARGS");
    expect(await code(v.daily("ontem", "Diário"))).toBe("E_BAD_ARGS");
    expect(await code(v.daily(undefined, "../fora"))).toBe("E_OUTSIDE_VAULT");
  });

  test("isDate e localDate", () => {
    expect(isDate("2026-11-04")).toBe(true);
    expect(isDate("2026-13-01")).toBe(false);
    expect(localDate(new Date(2026, 0, 2, 0, 5).getTime())).toBe("2026-01-02");
  });
});

describe("o link que cria a nota", () => {
  test("[[Pasta/Nota]] cria na pasta; [[Nota]] na pasta de `from`, ou na raiz; seção e apelido não entram", async () => {
    const { v } = await vault({ "Projetos/Plano.md": "[[Sub/Nova]] [[Ideia#Seção|apelido]]" });
    expect((await v.createFromLink("[[Sub/Nova]]", "Projetos/Plano.md")).path).toBe("Sub/Nova.md");
    expect((await v.createFromLink("Ideia#Seção|apelido", "Projetos/Plano.md")).path).toBe("Projetos/Ideia.md");
    expect((await v.createFromLink("Solta", undefined)).path).toBe("Solta.md");
    // Já existe: a mesma, sem criar outra ("Ideia 2").
    expect((await v.createFromLink("ideia", "Outra/x.md")).path).toBe("Projetos/Ideia.md");
    expect(v.list().notes.map((n) => n.path)).toEqual(["Projetos/Ideia.md", "Projetos/Plano.md", "Solta.md", "Sub/Nova.md"]);
    expect(await code(v.createFromLink("[[]]", undefined))).toBe("E_BAD_ARGS");
    expect(await code(v.createFromLink("../fora/x", undefined))).toBe("E_OUTSIDE_VAULT");
  });
});

describe("Mencionada sem link", () => {
  test("unlinkedSpans: sem acento nem maiúscula, palavra inteira, fora de link, código e frontmatter", () => {
    const text = "---\ntitle: Kiwi Notes\n---\nUso o kiwi notes, o [[Kiwi Notes]] e `Kiwi Notes`; KiwiNotesX não; [o Kiwi Notes](x)\nKÍWI NOTES!";
    const spans = unlinkedSpans(text, "Kiwi Notes");
    expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(["kiwi notes", "KÍWI NOTES"]);
    expect(contextOf(text, spans[0]!)).toBe("Uso o kiwi notes, o [[Kiwi Notes]] e `Kiwi Notes`; KiwiNotesX não; [o Kiwi Notes](x)");
    expect(unlinkedSpans("ok ok ok", "Ok")).toEqual([]); // curto demais
  });

  test("linkSpans: a mesma grafia vira [[Alvo]]; outra vira [[Alvo|texto]]", () => {
    const t = "Kiwi Notes e kiwi notes";
    expect(linkSpans(t, unlinkedSpans(t, "Kiwi Notes"), "Kiwi Notes")).toBe("[[Kiwi Notes]] e [[Kiwi Notes|kiwi notes]]");
  });

  test("unlinkedMentions e linkMentions pelo vault, com o nome repetido levando o caminho", async () => {
    const { v, read } = await vault({
      "Projetos/Plano.md": "",
      "Arquivo/Plano.md": "",
      "Diário.md": "falei do plano hoje. [[Plano]] já linkado",
      "Outra.md": "nada aqui",
    });
    // A outra "Plano" (vazia) não cita; a própria nota nunca entra.
    expect(v.unlinkedMentions("Projetos/Plano.md")).toEqual([
      { path: "Diário.md", title: "Diário", context: "falei do plano hoje. [[Plano]] já linkado" },
    ]);
    const r = await v.linkMentions("Diário.md", "Projetos/Plano.md");
    expect(r.count).toBe(1);
    // "Plano" acha duas notas: o link leva o caminho para apontar para a certa.
    expect(read("Diário.md")).toBe("falei do [[Projetos/Plano|plano]] hoje. [[Plano]] já linkado");
    expect((await v.linkMentions("Diário.md", "Projetos/Plano.md")).count).toBe(0);
    expect(await code(v.linkMentions("Diário.md", "Nada.md"))).toBe("E_NOT_FOUND");
  });
});

describe("a Lixeira do app", () => {
  test("o que espera o Desfazer aparece como kiwi, com o prazo; depois, como macos, e o registro fica entre sessões", async () => {
    let t = Date.parse("2026-11-04T10:00:00Z");
    const { v, make, root } = await vault({ "A.md": "", "P/b.md": "" }, { undoMs: 30, now: () => t });
    await v.delete("A.md");
    expect(v.trashList().items).toEqual([
      { path: "A.md", kind: "note", deletedAt: "2026-11-04T10:00:00.000Z", where: "kiwi", until: "2026-11-04T10:00:00.030Z" },
    ]);
    await Bun.sleep(100);
    t += 1000;
    await v.deleteFolder("P");
    expect(await v.trashEmpty()).toEqual({ trashed: 1 });
    expect(v.trashList().items.map((i) => [i.path, i.kind, i.where])).toEqual([
      ["P", "folder", "macos"],
      ["A.md", "note", "macos"],
    ]);
    const again = make();
    await again.open();
    expect(again.trashList().items.map((i) => i.path)).toEqual(["P", "A.md"]);
    expect(existsSync(path.join(root, UNDO_DIR, "registry.json"))).toBe(true);
  });

  test("o que sobrou de uma sessão que caiu vai para o Lixo e entra no registro; o registry.json não é apagado", async () => {
    const { root, make } = await vault({ "x.md": "" });
    mkdirSync(path.join(root, UNDO_DIR, "1-ab"), { recursive: true });
    writeFileSync(path.join(root, UNDO_DIR, "1-ab", "Esquecida.md"), "x");
    writeFileSync(path.join(root, UNDO_DIR, "1-ab", ".meta.json"), JSON.stringify({ path: "Pasta/Esquecida.md", kind: "note", deletedAt: new Date().toISOString() }));
    const v = make();
    await v.open();
    expect(v.trashList().items.map((i) => [i.path, i.where])).toEqual([["Pasta/Esquecida.md", "macos"]]);
    const w = make();
    await w.open(); // a 2ª abertura não apaga o registro achando que é uma caixa
    expect(w.trashList().items).toHaveLength(1);
  });

  test("o registro esquece o que tem mais de 30 dias", async () => {
    let t = Date.parse("2026-01-01T00:00:00Z");
    const { v } = await vault({ "Velha.md": "", "Nova.md": "" }, { undoMs: 10, now: () => t });
    await v.delete("Velha.md");
    await v.trashEmpty();
    t += 31 * 86_400_000;
    await v.delete("Nova.md");
    await v.trashEmpty();
    expect(v.trashList().items.map((i) => i.path)).toEqual(["Nova.md"]);
  });
});

describe("pelas capacidades (contrato 1.8.0)", () => {
  test("notes.daily usa a pasta das settings; settings.set { dailyFolder } valida; trash.* respondem", async () => {
    const { v } = await vault({ "x.md": "Plano de hoje" });
    let settings: AppSettings = { ...DEFAULT_SETTINGS, notesShortcut: null };
    let revealed = 0;
    const caps = uiCapabilities({
      dictionary: { load: async () => [], save: async (t) => t },
      snippets: { load: async () => [], save: async (s) => s },
      history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
      dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
      settings: { load: async () => settings, save: async (patch) => (settings = { ...settings, ...patch, appearance: { ...settings.appearance, ...patch.appearance } }) },
      clipboardWrite: () => {},
      notes: v,
      revealTrash: () => void revealed++,
    });
    const call = (cap: string, args: unknown) => directInvoke(caps, cap, args);
    expect(await call("settings.set", { dailyFolder: "Jornal" })).toMatchObject({ ok: true, value: { dailyFolder: "Jornal" } });
    expect(await call("notes.daily", { date: "2026-11-04" })).toMatchObject({ ok: true, value: { path: "Jornal/2026-11-04.md" } });
    expect(await call("settings.set", { dailyFolder: "../fora" })).toMatchObject({ ok: false, code: "E_OUTSIDE_VAULT" });
    expect(await call("settings.set", { dailyFolder: "" })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("notes.createFromLink", { link: "[[Plano]]", from: "x.md" })).toMatchObject({ ok: true, value: { path: "Plano.md" } });
    expect(await call("notes.unlinkedMentions", { path: "Plano.md" })).toMatchObject({ ok: true, value: [{ path: "x.md" }] });
    expect(await call("notes.linkMentions", { path: "x.md", target: "Plano.md" })).toMatchObject({ ok: true, value: { count: 1 } });
    await call("notes.delete", { path: "x.md" });
    expect(await call("trash.list", {})).toMatchObject({ ok: true, value: { items: [{ path: "x.md", where: "kiwi" }] } });
    expect(await call("trash.empty", {})).toEqual({ ok: true, value: { trashed: 1 } });
    expect(await call("trash.reveal", {})).toEqual({ ok: true, value: true });
    expect(revealed).toBe(1);
    expect(await call("trash.list", { x: 1 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  });
});
