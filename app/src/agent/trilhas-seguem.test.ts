// A trilha acompanha a nota renomeada ou movida (T16650, achado #16176): pelo app (renomear, mover, a pasta) ou por
// fora (o Finder, o Obsidian). A de uma nota que saiu (apagada, ou que já não existia na abertura) sai da lista de
// Ajustes › Agente. Pasta falsa, nomes inventados, o agente nunca abre.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { tempDir } from "../../test/tmp.ts";
import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { directInvoke } from "../bun/ui-engine.ts";
import { type CapabilityDeps } from "../bun/ui-capabilities.ts";
import { folderKey, NotesFolders } from "../notes/folders-workspace.ts";
import { Vault } from "../notes/vault.ts";
import { HistoryStore } from "../store/history.ts";
import { type AppSettings, DEFAULT_SETTINGS, SettingsStore } from "../store/settings.ts";
import { agentDir } from "./adapter/open.ts";
import { AgentService } from "./service.ts";
import { TrilhaStore } from "./trilhas.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (prefix: string) => {
  const d = tempDir(prefix);
  dirs.push(d);
  return d;
};

describe("TrilhaStore.seguir", () => {
  test("a trilha vai para o caminho novo, a que saiu sai, as outras ficam; tudo no disco", () => {
    const dir = tmp("kiwi-trilhas-seguir-");
    let t = 1_000;
    const s = new TrilhaStore(dir, () => t++);
    s.aprender("orçamento da viagem para Lisboa", "Pessoal/Viagem.md");
    s.aprender("receita do bolo de cenoura", "Cozinha/Bolo.md");
    s.aprender("lista de livros para ler", "Leituras.md");
    const map = (p: string) => (p === "Pessoal/Viagem.md" ? "Arquivo/Lisboa 2026.md" : p === "Cozinha/Bolo.md" ? null : p);
    expect(s.seguir(null, map)).toBe(2);
    const paths = (st: TrilhaStore) => st.list().map((x) => x.path).sort();
    expect(paths(s)).toEqual(["Arquivo/Lisboa 2026.md", "Leituras.md"]);
    // As palavras e as vezes vão junto com a nota.
    expect(s.list().find((x) => x.path === "Arquivo/Lisboa 2026.md")).toMatchObject({ palavras: ["orçamento", "viagem", "Lisboa"], vezes: 1 });
    expect(paths(new TrilhaStore(dir))).toEqual(["Arquivo/Lisboa 2026.md", "Leituras.md"]);
    // Nada mudou: nada a gravar.
    expect(s.seguir(null, (p) => p)).toBe(0);
  });
});

describe("as trilhas seguem a nota no app (Ajustes › Agente)", () => {
  /** Uma pasta falsa, o agente de verdade (que nunca abre) e as capacidades, como as telas usam. */
  async function setup(files: Record<string, string>, trilhas: [pedido: string, nota: string][]) {
    const base = tmp("kiwi-trilhas-app-");
    const root = path.join(base, "V");
    const data = path.join(base, "data");
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), content);
    }
    // As trilhas de antes, no disco, como o app as deixou.
    const antes = new TrilhaStore(agentDir(data));
    for (const [pedido, nota] of trilhas) antes.aprender(pedido, nota);
    let agentSettings = { ...DEFAULT_SETTINGS.agent };
    const agent = new AgentService({
      data,
      settings: { load: async () => agentSettings, save: async (patch) => (agentSettings = { ...agentSettings, ...patch }) },
      claude: () => null,
      openHost: async () => {
        throw new Error("o agente não abre neste teste");
      },
    });
    const v = new Vault({ root, debounceMs: 20, trash: async () => {} });
    let settings: AppSettings = { ...DEFAULT_SETTINGS, notesShortcut: null };
    const caps = uiCapabilities({
      dictionary: { load: async () => [], save: async (t) => t },
      snippets: { load: async () => [], save: async (s) => s },
      history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
      dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
      settings: { load: async () => settings, save: async (patch) => (settings = { ...settings, ...patch, appearance: { ...settings.appearance, ...patch.appearance } }) },
      clipboardWrite: () => {},
      notes: v,
      agent,
    });
    const trails = async () => {
      const r = await directInvoke(caps, "agent.trails", {});
      if (!r.ok) throw new Error(JSON.stringify(r));
      return (r.value as { trilhas: { path: string; titulo: string }[] }).trilhas.map((t) => t.path).sort();
    };
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await directInvoke(caps, name as never, args as never);
      expect(r).toMatchObject({ ok: true });
    };
    await call("notes.list", {}); // abre o vault e liga quem segue as notas
    return { root, v, trails, call };
  }

  const until = async (ok: () => Promise<boolean>) => {
    for (let i = 0; i < 100 && !(await ok()); i++) await Bun.sleep(20);
  };

  test("renomear, mover a nota e renomear a pasta pelo app levam a trilha; apagar a tira", async () => {
    const { v, trails, call } = await setup(
      { "Viagem.md": "Lisboa", "Cozinha/Bolo.md": "cenoura", "Leituras.md": "livros", "Rascunho.md": "nada" },
      [["orçamento da viagem para Lisboa", "Viagem.md"], ["receita do bolo de cenoura", "Cozinha/Bolo.md"], ["lista de livros para ler", "Leituras.md"], ["rascunho da proposta antiga", "Rascunho.md"]],
    );
    await call("notes.rename", { path: "Viagem.md", newPath: "Lisboa 2026.md" });
    await call("folders.create", { path: "Arquivo" });
    await call("notes.move", { path: "Leituras.md", folder: "Arquivo" });
    await call("folders.rename", { path: "Cozinha", newPath: "Receitas" });
    await call("notes.delete", { path: "Rascunho.md" });
    expect(await trails()).toEqual(["Arquivo/Leituras.md", "Lisboa 2026.md", "Receitas/Bolo.md"]);
    v.close();
  });

  test("na abertura, sai a trilha de uma nota que já não existe", async () => {
    const { v, trails } = await setup({ "Viagem.md": "Lisboa" }, [["orçamento da viagem para Lisboa", "Viagem.md"], ["receita do bolo de cenoura", "Sumiu.md"]]);
    expect(await trails()).toEqual(["Viagem.md"]);
    v.close();
  });

  test("um rename por fora (o Finder, o Obsidian) leva a trilha; apagar por fora a tira", async () => {
    const { root, v, trails } = await setup(
      { "Viagem.md": "Lisboa", "Bolo.md": "cenoura" },
      [["orçamento da viagem para Lisboa", "Viagem.md"], ["receita do bolo de cenoura", "Bolo.md"]],
    );
    v.watch();
    // O FSEvents leva um instante para valer (T2792): grava uma prova até o watcher contar que viu.
    let seen = false;
    const off = v.onOtherFiles((paths) => (seen ||= paths.includes("prova-do-watcher.txt")));
    for (let i = 0; i < 200 && !seen; i++) {
      writeFileSync(path.join(root, "prova-do-watcher.txt"), String(i));
      await Bun.sleep(10);
    }
    off();
    rmSync(path.join(root, "prova-do-watcher.txt"), { force: true });
    expect(seen).toBe(true);
    await Bun.sleep(60);

    mkdirSync(path.join(root, "Arquivo"));
    renameSync(path.join(root, "Viagem.md"), path.join(root, "Arquivo", "Lisboa.md"));
    await until(async () => (await trails()).includes("Arquivo/Lisboa.md"));
    expect(await trails()).toEqual(["Arquivo/Lisboa.md", "Bolo.md"]);
    rmSync(path.join(root, "Bolo.md"));
    await until(async () => (await trails()).length === 1);
    expect(await trails()).toEqual(["Arquivo/Lisboa.md"]);
    v.close();
  });
});

describe("as trilhas de uma pasta de notas não mexem nas de outra (revisão do T16650)", () => {
  const abertas: NotesFolders[] = [];
  afterEach(async () => {
    for (const f of abertas.splice(0)) await f.close();
  });

  /** A pasta interna e uma de fora, com o mesmo `Viagem.md` nas duas, e o agente (que nunca abre) nas capacidades. */
  async function duasPastas() {
    const base = realpathSync(tmp("kiwi-trilhas-pastas-"));
    const data = path.join(base, "data");
    const interna = path.join(base, "home", "KiwiNotes");
    const fora = path.join(base, "home", "Outra pasta");
    mkdirSync(interna, { recursive: true });
    mkdirSync(fora, { recursive: true });
    writeFileSync(path.join(interna, "Viagem.md"), "Lisboa");
    writeFileSync(path.join(interna, "Bolo.md"), "cenoura");
    writeFileSync(path.join(fora, "Viagem.md"), "Porto");
    // As trilhas de antes, cada uma da sua pasta: `Bolo.md` só existe na interna.
    const antes = new TrilhaStore(agentDir(data));
    antes.aprender("orçamento da viagem para Lisboa", "Viagem.md", folderKey(interna));
    antes.aprender("receita do bolo de cenoura", "Bolo.md", folderKey(interna));
    antes.aprender("roteiro da viagem ao Porto", "Viagem.md", folderKey(fora));
    let agentSettings = { ...DEFAULT_SETTINGS.agent };
    const agent = new AgentService({
      data,
      settings: { load: async () => agentSettings, save: async (patch) => (agentSettings = { ...agentSettings, ...patch }) },
      claude: () => null,
      openHost: async () => {
        throw new Error("o agente não abre neste teste");
      },
    });
    const internalNotes = new Vault({ root: interna, trash: async () => {} });
    const folders = new NotesFolders({ dir: data, defaultRoot: interna, globalSettings: new SettingsStore(data), internalNotes, home: path.join(base, "home"), watch: false, limit: 20_000 });
    abertas.push(folders);
    const caps = uiCapabilities({
      ...folders.fixed,
      notesFolders: folders,
      chooseNotesFolder: async () => fora,
      history: new HistoryStore(data),
      dictionary: { load: async () => [], save: async () => [] },
      snippets: { load: async () => [], save: async () => [] },
      clipboardWrite: () => {},
      settingsChanged: () => {},
      agent,
    } as CapabilityDeps);
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await directInvoke(caps, name as never, args as never);
      expect(r).toMatchObject({ ok: true });
      return (r as { value: unknown }).value;
    };
    /** As trilhas como Ajustes › Agente mostra: a 1ª palavra e a nota. */
    const trails = async () =>
      ((await call("agent.trails", {})) as { trilhas: { palavras: string[]; path: string }[] }).trilhas.map((t) => `${t.palavras[0]} → ${t.path}`).sort();
    return { call, trails };
  }

  test("abrir a 2ª pasta não apaga as trilhas da 1ª", async () => {
    const { call, trails } = await duasPastas();
    await call("notes.list", {}); // a interna abre
    const todas = ["orçamento → Viagem.md", "receita → Bolo.md", "roteiro → Viagem.md"];
    expect(await trails()).toEqual(todas);
    expect(await call("notes.openFolder", {})).toMatchObject({ kind: "opened" });
    await call("notes.list", {}); // a de fora abre: não tem Bolo.md, e a trilha dele é da interna
    expect(await trails()).toEqual(todas);
  });

  test("um rename numa pasta não move a trilha do mesmo caminho na outra", async () => {
    const { call, trails } = await duasPastas();
    await call("notes.list", {});
    await call("notes.openFolder", {});
    await call("notes.rename", { path: "Viagem.md", newPath: "Porto.md" });
    expect(await trails()).toEqual(["orçamento → Viagem.md", "receita → Bolo.md", "roteiro → Porto.md"]);
  });
});
