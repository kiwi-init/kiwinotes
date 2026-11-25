// T1192: o AppEngine do Kiwi Notes, com o contrato, o canal local e a UI de fábrica. Sem janela e sem app: o `show`
// é de mentira e o canal é um Bun.serve em 127.0.0.1, como o canal local de dev.

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { DEFAULT_APPEARANCE } from "../shared/appearance.ts";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_MEETING_SETTINGS } from "../shared/meetings.ts";
import { DEFAULT_SHORTCUTS } from "../shared/shortcuts.ts";

import {
  type AppEngine,
  type AppEngineEvent,
  buildUipack,
  contractRefusal,
  generateSigningKey,
  type HostUi,
  signManifest,
  type UiManifest,
  uipackFileName,
} from "electrobun/bun/appengine";

import { UI_CAPABILITIES, UI_CONTRACT_VERSION, type AppSettings } from "../shared/ui-contract.ts";
import { DEFAULT_AGENT_SETTINGS, type SettingsPatch } from "../store/settings.ts";
import { ENGINE_CONTRACT_GLOBAL } from "./appengine-devkit.ts";
import { uiChannelFetch } from "./ui-channel-fetch.ts";
import { uiCapabilities } from "./ui-capabilities.ts";
import { revertWindow } from "./ui-appearance.ts";
import {
  builtInFrom,
  channelSource,
  channelUrl,
  channelUrlOrOff,
  createUiEngine,
  devServerAllowed,
  directInvoke,
  enginePreload,
  gateFetch,
  oneAtATime,
  remoteManifestUrl,
  UI_CHANNEL_POLL_MS,
  UI_CHANNEL_REMOTE,
  type UiChannelChoice,
  uiChannelFor,
} from "./ui-engine.ts";
import { tempDir } from "../../test/tmp.ts";

const key = generateSigningKey();
const trustedKeys = { [key.keyId]: key.publicKey };
const encode = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const BUILT_IN_SEQ = 1_000;

/** As notas têm testes próprios (src/notes/vault.test.ts); aqui só precisam existir. */
const notesStub = {
  root: "/nao-usado",
  notesContaining: () => [],
  onOtherFiles: () => () => {},
  open: async () => {},
  list: () => ({ folders: [], notes: [], tree: { path: "", name: "", folders: [], notes: [] }, files: [] }),
  get: async () => {
    throw new Error("not in this test");
  },
  save: async () => ({ saved: false as const, current: null as never }),
  create: async () => null as never,
  rename: async () => null as never,
  renameHeading: async () => ({ updatedNotes: 0, updatedReferences: 0, skippedPaths: [], warnings: [] }),
  renameTag: async () => ({ updatedNotes: 0, updatedReferences: 0, skippedPaths: [], warnings: [] }),
  linkWarnings: async () => [],
  delete: async () => true as const,
  search: () => [],
  backlinks: () => [],
  resolve: () => null,
  embed: () => null,
  moveNote: async () => null as never,
  duplicate: async () => null as never,
  restore: async () => null as never,
  locate: async () => "",
  locateFile: async () => ({ abs: "", mode: 0 }),
  readFile: async (p: unknown) => ({ path: String(p), size: 2, version: "v1", text: "oi" }),
  saveFile: async (p: unknown) => ({ saved: true as const, path: String(p), size: 2, version: "v2" }),
  createFile: async (folder: unknown, name: unknown) => ({ path: `${String(folder)}/${String(name)}`, size: 2, version: "v1" }),
  deleteFile: async () => true as const,
  renameFile: async () => ({ path: "", updatedLinks: 0, skippedPaths: [] }),
  getCanvas: async (p: unknown) => ({ path: String(p), content: "{}", version: "v1" }),
  saveCanvas: async (p: unknown) => ({ saved: true as const, path: String(p), version: "v2" }),
  createCanvas: async () => ({ path: "Quadro.canvas", content: "{}", version: "v1" }),
  renameCanvas: async (_a: unknown, b: unknown) => ({ path: String(b), content: "{}", version: "v1" }),
  createFolder: async () => null as never,
  moveFolder: async () => null as never,
  deleteFolder: async () => true as const,
  onExternalMoves: () => () => {},
  existing: () => ({ notes: new Set<string>(), folders: new Set<string>() }),
  tags: () => [],
  templates: () => [],
  daily: async () => null as never,
  createFromLink: async () => null as never,
  unlinkedMentions: () => [],
  linkMentions: async () => null as never,
  trashList: () => ({ items: [] }),
  trashEmpty: async () => ({ trashed: 0 }),
};

function fakeDeps() {
  const calls: string[] = [];
  const copied: string[] = [];
  const settings: AppSettings = { shortcuts: { ...DEFAULT_SHORTCUTS }, notesShortcut: "control+option+n", pinned: [], appearance: { ...DEFAULT_APPEARANCE }, templatesFolder: "Modelos", dailyFolder: "Diário", attachmentsFolder: "Anexos", ocr: true, semanticSearch: true, checkUpdates: true, language: "auto", savedSearches: [], microphone: "auto", showExtensions: false, cues: true, preciseDictation: false, meetings: { ...DEFAULT_MEETING_SETTINGS }, noteWidth: 760, agent: DEFAULT_AGENT_SETTINGS, kiwicat: { show: true, overlay: true, cor: "prisma-original", posicao: "center", tamanho: 1, voz: "en-a" }, firstRun: "done" };
  let t = 0;
  return {
    calls,
    copied,
    tick: (ms: number) => void (t += ms),
    deps: {
      dictionary: {
        load: async () => (calls.push("dictionary.load"), [{ term: "ORBIT", aliases: [] }]),
        save: async (terms: { term: string; aliases: string[] }[]) => (calls.push(`dictionary.save:${terms.length}`), terms),
      },
      snippets: { load: async () => [], save: async (s: { trigger: string; text: string }[]) => s },
      history: {
        search: async (p: object) => (calls.push(`history.search:${JSON.stringify(p)}`), { entries: [] }),
        delete: async (id: string) => (calls.push(`history.delete:${id}`), true),
        get: async () => null,
      },
      dictationNotes: { toNew: async () => { throw new Error("not used") }, append: async () => { throw new Error("not used") } },
      settings: {
        load: async () => ({ ...settings }),
        save: async (patch: SettingsPatch) => (calls.push(`settings.save:${JSON.stringify(patch)}`), Object.assign(settings, patch, { appearance: { ...settings.appearance, ...patch.appearance } }), { ...settings }),
      },
      settingsChanged: (s: AppSettings) => void calls.push(`settingsChanged:${s.notesShortcut}`),
      clipboardWrite: (text: string) => void copied.push(text),
      now: () => t,
      notes: notesStub,
    },
  };
}

// ---------------------------------------------------------------- canal local de mentira

function startChannel() {
  const sites = new Map<string, { manifest: UiManifest | null; bundles: Map<string, Uint8Array> }>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const [, window, name] = new URL(request.url).pathname.split("/");
      const site = sites.get(window ?? "");
      if (!site) return new Response("none", { status: 404 });
      if (name === "manifest.json") return site.manifest ? Response.json(site.manifest) : new Response("none", { status: 404 });
      const bundle = site.bundles.get(name ?? "");
      return bundle ? new Response(new Blob([bundle as Uint8Array<ArrayBuffer>])) : new Response("not found", { status: 404 });
    },
  });
  return {
    base: `http://127.0.0.1:${server.port}`,
    publish(window: string, seq: number, index: string, options: { requiresContract?: string; bundleBase?: string } = {}) {
      const site = sites.get(window) ?? { manifest: null, bundles: new Map() };
      sites.set(window, site);
      const uiVersion = `0.2.${seq}`;
      const { bytes, sha256 } = buildUipack(uiVersion, new Map([["index.html", encode(index)], ["assets/app.js", encode(`app(${seq})`)]]));
      const name = uipackFileName(uiVersion, sha256);
      site.bundles.set(name, bytes);
      site.manifest = signManifest(
        {
          format: "livewire-manifest/1",
          keyId: key.keyId,
          seq,
          uiVersion,
          bundleUrl: options.bundleBase ? `${options.bundleBase}${name}` : name,
          sha256,
          requiresContract: options.requiresContract ?? "^1.0.0",
          dataSchema: 1,
          publishedAt: Date.now(),
        },
        key.privateKeyPem,
      );
      return site.manifest;
    },
    stop: () => server.stop(true),
  };
}

// ---------------------------------------------------------------- engine montado como no app

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function rig(
  manifestUrl: string | null,
  opts: { readyTimeoutMs?: number; channel?: UiChannelChoice; remoteFetch?: typeof fetch; checkUpdates?: () => boolean | Promise<boolean>; canSwap?: () => boolean; dir?: string } = {},
) {
  const dir = opts.dir ?? tempDir("kiwinotes-ui-engine-test-");
  const shown: HostUi[] = [];
  const events: AppEngineEvent[] = [];
  const { deps } = fakeDeps();
  const engine: AppEngine = createUiEngine({
    name: "settings",
    dir,
    builtIn: { uiVersion: "0.1.0", seq: BUILT_IN_SEQ, files: () => new Map([["index.html", encode("<p>fábrica</p>")]]) },
    trustedKeys,
    capabilities: uiCapabilities(deps),
    channel: opts.channel ?? (manifestUrl ? { kind: "local", manifestUrl } : { kind: "off", reason: "test" }),
    remoteFetch: opts.remoteFetch,
    checkUpdates: opts.checkUpdates,
    show: (ui) => void shown.push(ui),
    readyTimeoutMs: opts.readyTimeoutMs ?? 2_000,
    probationMs: 50,
    ...(opts.canSwap ? { canSwap: opts.canSwap } : {}),
  });
  engine.on((e) => void events.push(e));
  cleanups.push(() => {
    engine.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    engine,
    shown,
    events,
    last: () => decode(shown.at(-1)!.index),
    until: (pred: (e: AppEngineEvent) => boolean) => waitFor(() => events.find(pred)),
  };
}

async function waitFor<T>(probe: () => T | undefined | null | false, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out");
    await Bun.sleep(5);
  }
}

// ---------------------------------------------------------------- contrato

describe("contrato 1.0.0 (T1192)", () => {
  test("só os nomes da lista: o resto é E_NO_CAPABILITY, até os herdados", async () => {
    const r = rig(null);
    for (const cap of ["fs.read", "shell.run", "constructor", "toString", "__proto__", ""]) {
      const out = await r.engine.invoke(cap, {});
      expect(out).toMatchObject({ ok: false, code: "E_NO_CAPABILITY" });
    }
    expect([...r.engine.contract.capabilities].sort()).toEqual([...UI_CAPABILITIES, "engine.info", "session.takeHandoff"].sort());
    expect(r.engine.contract.version).toBe(UI_CONTRACT_VERSION);
  });

  test("argumentos ruins dão E_BAD_ARGS, e os bons chegam ao app", async () => {
    const f = fakeDeps();
    const caps = uiCapabilities(f.deps);
    const call = (cap: string, args: unknown) => directInvoke(caps, cap, args);
    expect(await call("dictionary.get", {})).toMatchObject({ ok: true, value: [{ term: "ORBIT" }] });
    expect(await call("dictionary.get", { x: 1 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("dictionary.set", { terms: "ORBIT" })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("dictionary.set", { terms: [{ term: " SILO ", aliases: [] }, { term: "" }] })).toMatchObject({
      ok: true,
      value: [{ term: "SILO", aliases: [] }],
    });
    expect(await call("history.search", { limit: 0 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("history.search", { query: 42 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("history.search", { query: "reunião", limit: 10 })).toMatchObject({ ok: true });
    expect(await call("history.delete", {})).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("history.delete", { id: "abc" })).toMatchObject({ ok: true, value: true });
    expect(await call("history.search", [])).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(f.calls).toEqual(["dictionary.load", "dictionary.save:1", 'history.search:{"query":"reunião","limit":10}', "history.delete:abc"]);
  });

  test("settings: Kiwi-cat validates the show and overlay flags, and one alone keeps the other (spec #9810)", async () => {
    const f = fakeDeps(); const caps = uiCapabilities(f.deps);
    for (const value of [null, false, {}, { show: "false" }, { overlay: 1 }, { show: true, extra: 1 }])
      expect(await directInvoke(caps, "settings.set", { kiwicat: value })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await directInvoke(caps, "settings.set", { kiwicat: { show: false } })).toMatchObject({ ok: true, value: { kiwicat: { show: false, overlay: true } } });
    expect(await directInvoke(caps, "settings.set", { kiwicat: { overlay: false } })).toMatchObject({ ok: true, value: { kiwicat: { show: false, overlay: false } } });
    expect(await directInvoke(caps, "settings.set", { kiwicat: { show: true } })).toMatchObject({ ok: true, value: { kiwicat: { show: true, overlay: false } } });
  });

  test("settings: a paleta do gato, só uma das 5, e as outras chaves ficam (spec #14963)", async () => {
    const f = fakeDeps(); const caps = uiCapabilities(f.deps);
    expect((await directInvoke(caps, "settings.get", {}) as { value: AppSettings }).value.kiwicat.cor).toBe("prisma-original");
    for (const cor of ["#ffffff", "branco", "", null, 1, "padrao", "agente", "azul"])
      expect(await directInvoke(caps, "settings.set", { kiwicat: { cor } })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await directInvoke(caps, "settings.set", { kiwicat: { overlay: false } })).toMatchObject({ ok: true });
    expect(await directInvoke(caps, "settings.set", { kiwicat: { cor: "soul-claro" } })).toMatchObject({ ok: true, value: { kiwicat: { show: true, overlay: false, cor: "soul-claro", posicao: "center", tamanho: 1, voz: "en-a" } } });
    expect(await directInvoke(caps, "settings.set", { kiwicat: { cor: "prisma-original" } })).toMatchObject({ ok: true, value: { kiwicat: { cor: "prisma-original" } } });
    // A posição e o tamanho (spec #12949): uma das seis, e de 0,6 a 1,6, guardado em passos de 0,1; o resto fica.
    for (const kiwicat of [{ posicao: "meio" }, { posicao: 1 }, { tamanho: 0.5, voz: "en-a" }, { tamanho: 1.7, voz: "en-a" }, { tamanho: "1" }, { tamanho: Number.NaN }])
      expect(await directInvoke(caps, "settings.set", { kiwicat })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await directInvoke(caps, "settings.set", { kiwicat: { posicao: "bottom-left", tamanho: 1.33, voz: "en-a" } })).toMatchObject({ ok: true, value: { kiwicat: { cor: "prisma-original", posicao: "bottom-left", tamanho: 1.3, voz: "en-a" } } });
  });

  test("settings: a largura da nota, em px dentro dos limites (T5299)", async () => {
    const f = fakeDeps();
    const caps = uiCapabilities(f.deps);
    const call = (cap: string, args: unknown) => directInvoke(caps, cap, args);
    for (const bad of [479, 1401, "900", null, Number.NaN]) {
      expect(await call("settings.set", { noteWidth: bad })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    }
    expect(await call("settings.set", { noteWidth: 980.6 })).toMatchObject({ ok: true, value: { noteWidth: 981 } });
    expect(f.calls.filter((c) => c.startsWith("settings.save"))).toEqual(['settings.save:{"noteWidth":981}']);
  });

  test("settings: o idioma do app, o app.locale e o app.localeChanged só quando a língua ou a escolha mudam (T28190)", async () => {
    const f = fakeDeps();
    const changes: unknown[] = [];
    let system = ["en-US", "pt-BR"];
    const caps = uiCapabilities({ ...f.deps, systemLanguages: () => system, localeChanged: (l) => void changes.push(l) });
    const call = (cap: string, args: unknown) => directInvoke(caps, cap, args);
    for (const bad of ["es", "", null, 1, "AUTO"]) expect(await call("settings.set", { language: bad })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    // O Automático segue o macOS (T30629, `AUTO_FOLLOWS_SYSTEM`): com ele em inglês, o app também.
    expect(await call("app.locale", {})).toEqual({ ok: true, value: { setting: "auto", locale: "en", system: "en" } });
    expect(await call("app.locale", { x: 1 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    // Outro ajuste não avisa a língua.
    await call("settings.set", { cues: false });
    expect(changes).toEqual([]);
    expect(await call("settings.set", { language: "en" })).toMatchObject({ ok: true, value: { language: "en" } });
    expect(changes).toEqual([{ setting: "en", locale: "en", system: "en" }]);
    expect(await call("app.locale", {})).toEqual({ ok: true, value: { setting: "en", locale: "en", system: "en" } });
    // A mesma escolha de novo: nada.
    await call("settings.set", { language: "en" });
    expect(changes).toHaveLength(1);
    // De English para Português: a língua muda.
    await call("settings.set", { language: "pt" });
    expect(changes.at(-1)).toEqual({ setting: "pt", locale: "pt", system: "en" });
    // De Português para Automático: a língua não muda, mas a escolha sim (o seletor das outras janelas).
    system = ["pt-BR"];
    await call("settings.set", { language: "auto" });
    expect(changes).toHaveLength(3);
    expect(changes.at(-1)).toEqual({ setting: "auto", locale: "pt", system: "pt" });
    // Sem a língua do macOS (os testes, o headless sem KIWI_SYSTEM_LANG): o Automático fica em português.
    expect(await directInvoke(uiCapabilities(f.deps), "app.locale", {})).toEqual({ ok: true, value: { setting: "auto", locale: "pt", system: "pt" } });
  });

  test("settings: o modo preciso do ditado, e o estado dele com e sem a sessão do helper (T6602)", async () => {
    const f = fakeDeps();
    const caps = uiCapabilities(f.deps);
    const call = (cap: string, args: unknown) => directInvoke(caps, cap, args);
    for (const bad of ["true", 1, null]) {
      expect(await call("settings.set", { preciseDictation: bad })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    }
    expect(await call("dictation.preciseStatus", {})).toMatchObject({ ok: true, value: { enabled: false, phase: "off", size: 269_751_136 } });
    expect(await call("settings.set", { preciseDictation: true })).toMatchObject({ ok: true, value: { preciseDictation: true } });
    expect(f.calls.filter((c) => c.startsWith("settings.save"))).toEqual(['settings.save:{"preciseDictation":true}']);
    expect(await call("dictation.preciseStatus", {})).toMatchObject({ ok: true, value: { enabled: true, phase: "waiting" } });
    const live = uiCapabilities({ ...f.deps, precise: () => ({ enabled: true, phase: "downloading", done: 10, total: 100, size: 100 }) });
    expect(await directInvoke(live, "dictation.preciseStatus", {})).toMatchObject({ ok: true, value: { phase: "downloading", done: 10 } });
    expect(await call("dictation.preciseStatus", { x: 1 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  });

  test("settings: o atalho da janela Notas, um atalho ou null (T1499; qualquer atalho desde o T5349)", async () => {
    const f = fakeDeps();
    const caps = uiCapabilities(f.deps);
    const call = (cap: string, args: unknown) => directInvoke(caps, cap, args);
    expect(await call("settings.get", {})).toMatchObject({ ok: true, value: { notesShortcut: "control+option+n" } });
    expect(await call("settings.get", { x: 1 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    for (const bad of ["n", "shift+n", "control+option", 7, {}]) {
      expect(await call("settings.set", { notesShortcut: bad })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    }
    expect(await call("settings.set", { theme: "dark" })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    // O de antes entra nos `shortcuts`, no texto canônico.
    expect(await call("settings.set", { notesShortcut: "Command+Option+N" })).toMatchObject({
      ok: true, value: { notesShortcut: "option+command+n", shortcuts: { notes: "option+command+n" } },
    });
    expect(await call("settings.set", { notesShortcut: null })).toMatchObject({ ok: true, value: { notesShortcut: null, shortcuts: { notes: null } } });
    // Os ruins não chegaram a gravar nem a avisar o helper.
    expect(f.calls.filter((c) => c.startsWith("settingsChanged"))).toEqual(["settingsChanged:option+command+n", "settingsChanged:null"]);
  });

  test("settings: os atalhos (T5349) mudam só os dados, e dois nas mesmas teclas não gravam nada", async () => {
    const f = fakeDeps();
    const caps = uiCapabilities(f.deps);
    const call = (cap: string, args: unknown) => directInvoke(caps, cap, args);
    expect(await call("settings.set", { shortcuts: { dictation: "rightOption", meeting: "control+k r" } })).toMatchObject({
      ok: true, value: { shortcuts: { dictation: "rightOption", meeting: "control+k r", notes: "control+option+n" }, meetings: { shortcut: "control+k r" } },
    });
    // O mesmo atalho de outro, a mesma tecla modificadora, o começo de uma sequência: recusados.
    for (const shortcuts of [{ notes: "control+option+m" }, { notes: "double:rightOption" }, { palette: "control+k" }]) {
      expect(await call("settings.set", { shortcuts })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    }
    // Trocar os dois de uma vez vale.
    expect(await call("settings.set", { shortcuts: { notes: "control+option+m", meetingPause: null } })).toMatchObject({ ok: true });
    // Os do app só como uma combinação; e um nome que não existe.
    for (const shortcuts of [{ palette: "fn" }, { newNote: "control+k n" }, { quit: "command+q" }, ["fn"]]) {
      expect(await call("settings.set", { shortcuts })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    }
    expect(f.calls.filter((c) => c.startsWith("settings.save")).length).toBe(2);
  });

  test("shortcuts.record (T5349): o texto do helper, e os erros dele com o código do contrato", async () => {
    const f = fakeDeps();
    let next: () => Promise<string> = async () => "control+option+d";
    const call = (deps: object, cap: string) => directInvoke(uiCapabilities({ ...f.deps, ...deps }), cap, {});
    const shortcuts = { record: () => next(), cancel: () => void f.calls.push("cancel") };
    expect(await call({ shortcuts }, "shortcuts.record")).toMatchObject({ ok: true, value: { shortcut: "control+option+d" } });
    for (const [error, code] of [["cancelled", "E_CANCELLED"], ["invalid_shortcut", "E_BAD_ARGS"], ["hotkey_inactive", "E_NO_HELPER"]]) {
      next = async () => { throw new Error(error); };
      expect(await call({ shortcuts }, "shortcuts.record")).toMatchObject({ ok: false, code });
    }
    expect(await call({}, "shortcuts.record")).toMatchObject({ ok: false, code: "E_NO_HELPER" });
    // `bareKey` (1.27.0, T5458): chega ao helper; outro campo, não.
    const asked: unknown[] = [];
    const withBare = { record: async (bare?: boolean) => (asked.push(bare), "delete"), cancel: () => {} };
    expect(await directInvoke(uiCapabilities({ ...f.deps, shortcuts: withBare }), "shortcuts.record", { bareKey: true })).toMatchObject({ ok: true, value: { shortcut: "delete" } });
    expect(asked).toEqual([true]);
    expect(await directInvoke(uiCapabilities({ ...f.deps, shortcuts: withBare }), "shortcuts.record", { x: 1 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call({ shortcuts }, "shortcuts.cancelRecord")).toMatchObject({ ok: true });
    expect(f.calls).toContain("cancel");
  });

  test("settings: a Aparência muda só os campos dados, e um valor ruim não grava nada (T2503)", async () => {
    const f = fakeDeps();
    const caps = uiCapabilities(f.deps);
    const call = (cap: string, args: unknown) => directInvoke(caps, cap, args);
    expect(await call("settings.get", {})).toMatchObject({ ok: true, value: { appearance: DEFAULT_APPEARANCE } });
    for (const bad of [
      "dark",
      [],
      { mode: "sepia" },
      { darkTheme: "Abyssal Trench" },
      { darkTheme: "../x" },
      { textSize: 2 },
      { font: "comic-sans" },
      { motion: "none" },
      { theme: "dark" },
    ]) {
      expect(await call("settings.set", { appearance: bad })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    }
    // Um campo ruim no meio de um bom: nada grava.
    expect(await call("settings.set", { appearance: { mode: "dark", font: "x" } })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("settings.set", { appearance: { mode: "dark", darkTheme: "abyssal-trench" } })).toMatchObject({
      ok: true,
      value: { notesShortcut: "control+option+n", appearance: { ...DEFAULT_APPEARANCE, mode: "dark", darkTheme: "abyssal-trench" } },
    });
    // O resto fica: só a fonte muda.
    expect(await call("settings.set", { appearance: { font: "inter" } })).toMatchObject({
      ok: true,
      value: { appearance: { ...DEFAULT_APPEARANCE, mode: "dark", darkTheme: "abyssal-trench", font: "inter" } },
    });
    expect(f.calls.filter((c) => c.startsWith("settings.save"))).toHaveLength(2);
  });

  test("spelling checks one bounded word only, sanitizes output and degrades without a helper", async () => {
    const f = fakeDeps(); const calls: string[] = [];
    const caps = uiCapabilities({ ...f.deps, spelling: async (word, language) => {
      calls.push(`${word}:${language}`);
      return { available: true, misspelled: true, suggestions: ["reunião", "reunião", "ruim\nlinha"] };
    } });
    expect(await directInvoke(caps, "spelling.suggest", { word: "reuniao", language: "pt-BR" })).toMatchObject({ ok: true, value: { available: true, misspelled: true, suggestions: ["reunião"] } });
    expect(calls).toEqual(["reuniao:pt-BR"]);
    for (const args of [{ word: "duas palavras" }, { word: "a".repeat(129) }, { word: "erro\n" }, { word: "erro", language: "pt-BR\n" }, { word: "erro", extra: true }])
      expect(await directInvoke(caps, "spelling.suggest", args)).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(calls).toHaveLength(1);
    expect(await directInvoke(uiCapabilities(f.deps), "spelling.suggest", { word: "erro" })).toMatchObject({ ok: true, value: { available: false, suggestions: [] } });
  });

  test("clipboard.read is explicit, text only, bounded and unavailable without an adapter", async () => {
    const f = fakeDeps(); let reads = 0;
    const caps = uiCapabilities({ ...f.deps, clipboardRead: () => { reads++; return "texto local"; } });
    expect(reads).toBe(0);
    expect(await directInvoke(caps, "clipboard.read", {})).toMatchObject({ ok: true, value: "texto local" });
    expect(reads).toBe(1);
    expect(await directInvoke(caps, "clipboard.read", { unexpected: true })).toMatchObject({ ok: false });
    expect(reads).toBe(1);
    expect(await directInvoke(uiCapabilities(f.deps), "clipboard.read", {})).toMatchObject({ ok: false, code: "E_UNAVAILABLE" });
    const huge = uiCapabilities({ ...f.deps, clipboardRead: () => "a".repeat(1_000_001) });
    expect(await directInvoke(huge, "clipboard.read", {})).toMatchObject({ ok: false });
  });

  test("clipboard.write: só texto, com limite de tamanho e de ritmo (#1199)", async () => {
    const f = fakeDeps();
    const caps = uiCapabilities(f.deps);
    const call = (args: unknown) => directInvoke(caps, "clipboard.write", args);
    expect(await call({ text: 7 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call({ text: "x".repeat(100_001) })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call({ text: "oi" })).toMatchObject({ ok: true });
    expect(await call({ text: "de novo" })).toMatchObject({ ok: false, code: "E_RATE" });
    f.tick(400);
    expect(await call({ text: "depois" })).toMatchObject({ ok: true });
    expect(f.copied).toEqual(["oi", "depois"]);
  });

  test("uma UI que pede outro contrato é recusada antes de baixar", async () => {
    const ok = { requiresContract: "^1.0.0", uiVersion: "x" } as UiManifest;
    expect(contractRefusal(UI_CONTRACT_VERSION, ok)).toBeNull();
    expect(contractRefusal(UI_CONTRACT_VERSION, { ...ok, requiresContract: "^2.0.0" })).toContain("requires contract");
    expect(contractRefusal(UI_CONTRACT_VERSION, { ...ok, requiresContract: "banana" })).toContain("isn't a semver range");

    const channel = startChannel();
    cleanups.push(channel.stop);
    const r = rig(channelUrl(channel.base, "settings"));
    await r.engine.start();
    channel.publish("settings", BUILT_IN_SEQ + 1, "<p>pede 2.0</p>", { requiresContract: "^2.0.0" });
    expect(await r.engine.channel.check()).toMatchObject({ result: "refused" });
    expect(r.shown.map((ui) => decode(ui.index))).toEqual(["<p>fábrica</p>"]);
  });
});

// ---------------------------------------------------------------- troca e rollback

describe("troca e rollback pelo canal local (T1192)", () => {
  test("sem canal: a UI de fábrica, e o canal desligado não consulta nada", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    try {
      const r = rig(null);
      await r.engine.start();
      await r.until((e) => e.type === "built-in");
      expect(r.last()).toBe("<p>fábrica</p>");
      expect(await r.engine.channel.check()).toMatchObject({ result: "offline" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("uma UI nova entra sem rebuild; uma quebrada volta para a boa", async () => {
    const channel = startChannel();
    cleanups.push(channel.stop);
    const r = rig(channelUrl(channel.base, "settings"));
    await r.engine.start();
    await r.until((e) => e.type === "built-in");

    // Uma UI nova pelo canal: troca na hora, sobe (ready) e passa da prova.
    channel.publish("settings", BUILT_IN_SEQ + 1, "<p>nova</p>");
    expect(await r.engine.channel.check()).toMatchObject({ result: "available" });
    await waitFor(() => r.last() === "<p>nova</p>");
    r.engine.ready();
    await r.until((e) => e.type === "promoted");

    // Uma UI quebrada: erro antes do ready() → falha, banida, e volta para a nova.
    channel.publish("settings", BUILT_IN_SEQ + 2, "<p>quebrada</p>");
    expect(await r.engine.channel.check()).toMatchObject({ result: "available" });
    await waitFor(() => r.last() === "<p>quebrada</p>");
    r.engine.error("TypeError: boom");
    const failed = await r.until((e) => e.type === "failed");
    expect(failed).toMatchObject({ banned: true });
    await waitFor(() => r.last() === "<p>nova</p>");
    r.engine.ready();
    await waitFor(() => r.engine.showing?.uiVersion === `0.2.${BUILT_IN_SEQ + 1}`);
  });

  test("uma UI que nunca chama ready() volta para a de fábrica no prazo", async () => {
    const channel = startChannel();
    cleanups.push(channel.stop);
    const r = rig(channelUrl(channel.base, "settings"), { readyTimeoutMs: 100 });
    await r.engine.start();
    await r.until((e) => e.type === "built-in");
    channel.publish("settings", BUILT_IN_SEQ + 1, "<p>muda</p>");
    await r.engine.channel.check();
    await waitFor(() => r.last() === "<p>muda</p>");
    await r.until((e) => e.type === "failed");
    await waitFor(() => r.last() === "<p>fábrica</p>");
  });
});

// ---------------------------------------------------------------- canal remoto (spec #25011)

/**
 * O release `ui-channel` de mentira: o fetch do canal remoto, que serve as URLs do release a partir do canal local e
 * anota cada pedido. Qualquer outra URL é recusada, e o `fetch` global nunca é chamado (o teste quebra se for).
 */
function fakeRelease(local: { base: string }) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const remoteFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (!url.startsWith(UI_CHANNEL_REMOTE)) throw new Error(`refused: ${url}`);
    const file = url.slice(UI_CHANNEL_REMOTE.length);
    const manifest = /^([a-z-]+)\.manifest\.json$/.exec(file);
    return fetch(manifest ? `${local.base}/${manifest[1]}/manifest.json` : `${local.base}/settings/${file}`);
  }) as unknown as typeof fetch;
  return { calls, remoteFetch };
}

describe("canal remoto: o release ui-channel (spec #25011)", () => {
  const warn = () => {};

  test("o remoto é só o release ui-channel, um manifesto por janela", () => {
    expect(UI_CHANNEL_REMOTE).toBe("https://github.com/kiwi-init/kiwinotes/releases/download/ui-channel/");
    expect(remoteManifestUrl("settings")).toBe(`${UI_CHANNEL_REMOTE}settings.manifest.json`);
    expect(remoteManifestUrl("hub")).toBe(`${UI_CHANNEL_REMOTE}hub.manifest.json`);
  });

  test("desliga junto com as atualizações; o canal local de dev vem primeiro", () => {
    expect(uiChannelFor("hub", { env: undefined, updatesOff: null, warn })).toEqual({ kind: "remote", manifestUrl: remoteManifestUrl("hub") });
    for (const off of ["KIWI_DEBUG=1", "channel dev", "no release.baseUrl in this build"]) {
      expect(uiChannelFor("hub", { env: undefined, updatesOff: off, warn })).toEqual({ kind: "off", reason: `updates off (${off})` });
    }
    // O local de dev liga mesmo com as atualizações desligadas (o build de dev não tem Updater).
    expect(uiChannelFor("settings", { env: "http://127.0.0.1:5179", updatesOff: "channel dev", warn })).toEqual({
      kind: "local",
      manifestUrl: "http://127.0.0.1:5179/settings/manifest.json",
    });
    // Um KIWI_UI_CHANNEL errado desliga o canal, e não cai no remoto.
    const warnings: string[] = [];
    expect(uiChannelFor("settings", { env: "https://example.com", updatesOff: null, warn: (m) => warnings.push(m) })).toMatchObject({ kind: "off" });
    expect(warnings).toHaveLength(1);
  });

  test("o remoto busca a cada 6 h e só pelo fetch guardado; sem ele, fica desligado", async () => {
    const remote: UiChannelChoice = { kind: "remote", manifestUrl: remoteManifestUrl("settings") };
    const guarded = (async () => new Response("x")) as unknown as typeof fetch;
    expect(UI_CHANNEL_POLL_MS).toBe(6 * 60 * 60_000);
    expect(channelSource(remote, guarded)).toEqual({ manifestUrl: remoteManifestUrl("settings"), fetch: guarded, pollIntervalMs: UI_CHANNEL_POLL_MS });

    for (const off of [channelSource(remote, undefined), channelSource({ kind: "off", reason: "x" }, guarded)]) {
      expect(off.manifestUrl.startsWith("http://127.0.0.1/")).toBe(true);
      expect(off.fetch).not.toBe(guarded);
      await expect(off.fetch!("http://127.0.0.1/")).rejects.toThrow("the UI channel is off");
    }
  });

  test("uma UI nova chega pelo release: só o GET do manifesto e o do pack, nas URLs fixas", async () => {
    const local = startChannel();
    cleanups.push(local.stop);
    // O fetch global só chega ao canal falso local; a internet, nunca (nem com o código errado).
    const realFetch = globalThis.fetch;
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).startsWith(`${local.base}/`)) throw new Error(`no internet in tests: ${String(input)}`);
      return realFetch(input, init);
    }) as typeof fetch);
    const release = fakeRelease(local);
    try {
      const r = rig(null, { channel: { kind: "remote", manifestUrl: remoteManifestUrl("settings") }, remoteFetch: release.remoteFetch });
      await r.engine.start();
      await r.until((e) => e.type === "built-in");
      // O start já fez o GET do manifesto (abrir a janela); sem nada publicado, 404 e "offline".
      await waitFor(() => release.calls.length === 1);

      const manifest = local.publish("settings", BUILT_IN_SEQ + 1, "<p>do release</p>", { bundleBase: UI_CHANNEL_REMOTE });
      expect(await r.engine.channel.check()).toMatchObject({ result: "available" });
      await waitFor(() => r.last() === "<p>do release</p>");

      const manifestUrl = `${UI_CHANNEL_REMOTE}settings.manifest.json`;
      // O engine pode checar de novo depois da troca: só o manifesto se repete, e o pack é baixado uma vez.
      const urls = release.calls.map((c) => c.url);
      expect(urls.filter((u) => u !== manifestUrl)).toEqual([manifest.bundleUrl]);
      expect(urls.filter((u) => u === manifestUrl).length).toBeGreaterThanOrEqual(2);
      expect(manifest.bundleUrl.startsWith(UI_CHANNEL_REMOTE)).toBe(true);
      for (const { url, init } of release.calls) {
        expect(new URL(url).search).toBe("");
        expect(init?.method ?? "GET").toBe("GET");
        expect(init?.body).toBeUndefined();
        expect(init?.headers).toBeUndefined();
      }
      for (const [input] of fetchSpy.mock.calls) expect(String(input).startsWith(`${local.base}/`)).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("pelo fetch guardado que o windows.ts passa (uiChannelFetch, T25029): a UI do release chega, e o pack de outro host não sai", async () => {
    const local = startChannel();
    cleanups.push(local.stop);
    const realFetch = globalThis.fetch;
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).startsWith(`${local.base}/`)) throw new Error(`no internet in tests: ${String(input)}`);
      return realFetch(input, init);
    }) as typeof fetch);
    const release = fakeRelease(local);
    try {
      const r = rig(null, { channel: { kind: "remote", manifestUrl: remoteManifestUrl("settings") }, remoteFetch: uiChannelFetch(release.remoteFetch) });
      await r.engine.start();
      await r.until((e) => e.type === "built-in");

      // Um manifesto assinado com o pack em outro host: o guardado recusa antes de sair, e a fábrica continua.
      local.publish("settings", BUILT_IN_SEQ + 1, "<p>de fora</p>", { bundleBase: "https://example.com/ui/" });
      await r.engine.channel.check();
      await Bun.sleep(50);
      expect(r.last()).toBe("<p>fábrica</p>");
      expect(release.calls.some((c) => c.url.startsWith("https://example.com/"))).toBe(false);

      local.publish("settings", BUILT_IN_SEQ + 2, "<p>do release</p>", { bundleBase: UI_CHANNEL_REMOTE });
      expect(await r.engine.channel.check()).toMatchObject({ result: "available" });
      await waitFor(() => r.last() === "<p>do release</p>");
      for (const { url, init } of release.calls) {
        expect(url.startsWith(UI_CHANNEL_REMOTE)).toBe(true);
        expect(init).toMatchObject({ method: "GET", redirect: "manual", credentials: "omit", referrerPolicy: "no-referrer" });
      }
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("windows.ts dá ao canal remoto o fetch guardado (T25028 com o T25029)", () => {
    const src = readFileSync(path.join(import.meta.dirname, "windows.ts"), "utf8");
    expect(src).toContain("remoteFetch: uiChannelFetch()");
  });

  test("com as atualizações desligadas, o canal remoto não faz pedido nenhum", async () => {
    const local = startChannel();
    cleanups.push(local.stop);
    const release = fakeRelease(local);
    local.publish("settings", BUILT_IN_SEQ + 1, "<p>do release</p>", { bundleBase: UI_CHANNEL_REMOTE });
    const channel = uiChannelFor("settings", { env: undefined, updatesOff: "KIWI_DEBUG=1", warn });
    const r = rig(null, { channel, remoteFetch: release.remoteFetch });
    await r.engine.start();
    await r.until((e) => e.type === "built-in");
    expect(await r.engine.channel.check()).toMatchObject({ result: "offline" });
    expect(release.calls).toEqual([]);
    expect(r.last()).toBe("<p>fábrica</p>");
  });
});

// ---------------------------------------------------------------- Buscar atualizações (T25110)

describe("Buscar atualizações desligado: o canal da UI não faz GET nenhum (T25110)", () => {
  test("remoto: desligado, nem o GET de abrir nem o da checagem; ligar vale no próximo, sem reiniciar", async () => {
    const local = startChannel();
    cleanups.push(local.stop);
    const release = fakeRelease(local);
    local.publish("settings", BUILT_IN_SEQ + 1, "<p>do release</p>", { bundleBase: UI_CHANNEL_REMOTE });
    let on = false;
    const r = rig(null, { channel: { kind: "remote", manifestUrl: remoteManifestUrl("settings") }, remoteFetch: release.remoteFetch, checkUpdates: async () => on });
    await r.engine.start();
    await r.until((e) => e.type === "built-in");
    // Recusado antes da rede: o engine não acha nada e fica na de fábrica.
    for (let i = 0; i < 2; i++) expect((await r.engine.channel.check()).result).not.toBe("available");
    expect(release.calls).toEqual([]);
    expect(r.last()).toBe("<p>fábrica</p>");

    on = true;
    // Uma checagem que já estava na fila (o engine junta as que chegam juntas) pode ainda responder a de antes.
    let result = "";
    for (let i = 0; i < 3 && result !== "available"; i++) result = (await r.engine.channel.check()).result;
    expect(result).toBe("available");
    await waitFor(() => r.last() === "<p>do release</p>");
    expect(release.calls.length).toBeGreaterThanOrEqual(2);
  });

  test("o canal local de dev também para; o desligado do build fica desligado", async () => {
    const local = startChannel();
    cleanups.push(local.stop);
    local.publish("settings", BUILT_IN_SEQ + 1, "<p>local</p>");
    const realFetch = globalThis.fetch;
    const seen: string[] = [];
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
      seen.push(String(input));
      return realFetch(input, init);
    }) as typeof fetch);
    try {
      const r = rig(`${local.base}/settings/manifest.json`, { checkUpdates: () => false });
      await r.engine.start();
      await r.until((e) => e.type === "built-in");
      expect((await r.engine.channel.check()).result).not.toBe("available");
      expect(seen).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
    }

    const inner = Object.assign(async () => new Response("x"), {}) as unknown as typeof fetch;
    let n = 0;
    const counted = (async (i: string | URL | Request, init?: RequestInit) => (n++, inner(i, init))) as unknown as typeof fetch;
    const gated = gateFetch(counted, () => false);
    await expect(gated("https://example.com/x")).rejects.toThrow("Buscar atualizações is off");
    expect(n).toBe(0);
    expect(await (await gateFetch(counted, () => true)("https://example.com/x")).text()).toBe("x");
    expect(n).toBe(1);
  });
});

describe("Nova aparência pronta e Voltar (spec #25011)", () => {
  test("com canSwap false, a UI nova espera o Recarregar; o applyUpdate troca sem reabrir", async () => {
    const channel = startChannel();
    cleanups.push(channel.stop);
    const r = rig(channelUrl(channel.base, "settings"), { canSwap: () => false });
    await r.engine.start();
    await r.until((e) => e.type === "built-in");
    channel.publish("settings", BUILT_IN_SEQ + 1, "<p>nova</p>");
    expect(await r.engine.channel.check()).toMatchObject({ result: "available" });
    const waiting = await r.until((e) => e.type === "waiting");
    expect(waiting).toMatchObject({ manifest: { uiVersion: `0.2.${BUILT_IN_SEQ + 1}` } });
    // Esperando: a da tela continua a de fábrica, até o Recarregar.
    await Bun.sleep(50);
    expect(r.last()).toBe("<p>fábrica</p>");
    r.engine.applyUpdate();
    await waitFor(() => r.last() === "<p>nova</p>");
    r.engine.ready();
    await r.until((e) => e.type === "promoted");
  });

  test("a janela fechada sobe a nova na próxima abertura", async () => {
    const channel = startChannel();
    cleanups.push(channel.stop);
    const dir = tempDir("kiwinotes-ui-engine-test-");
    const first = rig(channelUrl(channel.base, "settings"), { canSwap: () => false, dir });
    await first.engine.start();
    channel.publish("settings", BUILT_IN_SEQ + 1, "<p>nova</p>");
    await first.engine.channel.check();
    await first.until((e) => e.type === "waiting");
    first.engine.stop();
    const again = rig(null, { canSwap: () => false, dir });
    await again.engine.start();
    await waitFor(() => again.last() === "<p>nova</p>");
  });

  test("o Voltar com uma nova esperando o Recarregar: sai da da tela num clique, e a que esperava não sobe", async () => {
    const channel = startChannel();
    cleanups.push(channel.stop);
    const dir = tempDir("kiwinotes-ui-engine-test-");
    const builtIn = { uiVersion: "0.1.0", seq: BUILT_IN_SEQ };
    const r = rig(channelUrl(channel.base, "settings"), { dir, canSwap: () => false });
    await r.engine.start();
    await r.until((e) => e.type === "built-in");
    // A "um" e depois a "dois" entram pelo Recarregar e passam da prova.
    for (const [seq, html] of [[BUILT_IN_SEQ + 1, "<p>um</p>"], [BUILT_IN_SEQ + 2, "<p>dois</p>"]] as const) {
      channel.publish("settings", seq, html);
      await r.engine.channel.check();
      await waitFor(() => r.events.filter((e) => e.type === "waiting").length === seq - BUILT_IN_SEQ);
      r.engine.applyUpdate();
      await waitFor(() => r.last() === html);
      r.engine.ready();
      await waitFor(() => r.events.filter((e) => e.type === "promoted").length === seq - BUILT_IN_SEQ);
    }
    // A "três" baixa e espera, com a "dois" na tela.
    channel.publish("settings", BUILT_IN_SEQ + 3, "<p>três</p>");
    await r.engine.channel.check();
    await waitFor(() => r.events.filter((e) => e.type === "waiting").length === 3);
    expect(r.last()).toBe("<p>dois</p>");
    const onScreen = { sha256: r.engine.showing!.sha256 };
    r.engine.stop();

    expect(revertWindow(dir, builtIn, onScreen)).toBe(true);
    const back = rig(null, { dir, canSwap: () => false });
    await back.engine.start();
    // A primeira que sobe já é a "um": não a "dois" (que, sem ready(), cairia na "um" pelo prazo e enganaria o teste).
    await waitFor(() => back.shown.length > 0);
    expect(back.shown.map((u) => decode(u.index))).toEqual(["<p>um</p>"]);
    back.engine.ready();
    await Bun.sleep(50);
    expect(back.last()).toBe("<p>um</p>");
  });

  test("o Voltar com o engine parado: a anterior boa sobe, e a desfeita não volta pelo canal", async () => {
    const channel = startChannel();
    cleanups.push(channel.stop);
    const dir = tempDir("kiwinotes-ui-engine-test-");
    const builtIn = { uiVersion: "0.1.0", seq: BUILT_IN_SEQ };
    const r = rig(channelUrl(channel.base, "settings"), { dir });
    await r.engine.start();
    for (const [seq, html] of [[BUILT_IN_SEQ + 1, "<p>um</p>"], [BUILT_IN_SEQ + 2, "<p>dois</p>"]] as const) {
      channel.publish("settings", seq, html);
      await r.engine.channel.check();
      await waitFor(() => r.last() === html);
      r.engine.ready();
      await waitFor(() => r.events.filter((e) => e.type === "promoted").length === seq - BUILT_IN_SEQ);
    }
    r.engine.stop();

    expect(revertWindow(dir, builtIn)).toBe(true);
    const back = rig(channelUrl(channel.base, "settings"), { dir });
    await back.engine.start();
    await waitFor(() => back.shown.length > 0);
    expect(back.shown.map((u) => decode(u.index))).toEqual(["<p>um</p>"]);
    // O canal ainda oferece a "dois": o engine recusa, ela está no bad.
    expect(await back.engine.channel.check()).not.toMatchObject({ result: "available" });
    expect(back.last()).toBe("<p>um</p>");
    back.engine.stop();

    // De novo: a "um" sai e sobe a de fábrica; mais um Voltar não tem o que desfazer.
    expect(revertWindow(dir, builtIn)).toBe(true);
    const factory = rig(null, { dir });
    await factory.engine.start();
    await factory.until((e) => e.type === "built-in");
    expect(factory.last()).toBe("<p>fábrica</p>");
    factory.engine.stop();
    expect(revertWindow(dir, builtIn)).toBe(false);
  });
});

// ---------------------------------------------------------------- partes do app

describe("partes do app", () => {
  test("o canal só aceita endereço local; sem a variável, desligado", () => {
    expect(channelUrl(undefined, "settings")).toBeNull();
    expect(channelUrl("http://127.0.0.1:5179", "history")).toBe("http://127.0.0.1:5179/history/manifest.json");
    expect(channelUrl("http://localhost:5179/", "settings")).toBe("http://localhost:5179/settings/manifest.json");
    for (const bad of ["https://ui.kiwinit.com", "http://192.168.0.10:5179", "file:///tmp/x", "nada"]) {
      expect(() => channelUrl(bad, "settings")).toThrow();
    }
  });

  test("o HMR pelo localhost só existe no canal dev, nunca no stable (#1199)", () => {
    expect(devServerAllowed("dev")).toBe(true);
    for (const ch of ["stable", "canary", "beta", ""]) expect(devServerAllowed(ch)).toBe(false);
  });

  test("o preload leva o contrato e depois o window.engine", () => {
    const js = enginePreload(UI_CAPABILITIES, "/*page*/");
    expect(js.startsWith(`globalThis.${ENGINE_CONTRACT_GLOBAL} = `)).toBe(true);
    expect(js.endsWith("/*page*/")).toBe(true);
    const contract = JSON.parse(js.slice(js.indexOf("=") + 1, js.indexOf(";\n")));
    expect(contract.version).toBe(UI_CONTRACT_VERSION);
    expect(contract.capabilities).toContain("clipboard.write");
  });

  test("abrir a janela: dois cliques seguidos abrem uma só, e um erro não vira rejeição (#1277)", async () => {
    const pending = new Map<string, Promise<void>>();
    const errors: unknown[] = [];
    let runs = 0;
    let release!: () => void;
    const open = () =>
      oneAtATime(pending, "history", async () => {
        runs++;
        await new Promise<void>((r) => (release = r));
      }, (e) => void errors.push(e));
    const first = open();
    const second = open();
    expect(second).toBe(first);
    release();
    await first;
    expect(runs).toBe(1);
    expect(pending.size).toBe(0);

    // Um erro ao abrir (sem ui.json, mkdir sem permissão): vai para o log, e a promessa resolve.
    const failing = oneAtATime(pending, "history", async () => {
      throw new Error("no ui.json");
    }, (e) => void errors.push(e));
    await expect(failing).resolves.toBeUndefined();
    expect(String(errors[0])).toContain("no ui.json");
    // Depois do erro, o próximo clique tenta de novo.
    await oneAtATime(pending, "history", async () => void runs++, (e) => void errors.push(e));
    expect(runs).toBe(2);
  });

  test("a UI de fábrica vem do ui.json e da pasta do bundle", () => {
    const dir = tempDir("kiwinotes-builtin-test-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(path.join(dir, "index.html"), "<p>x</p>");
    writeFileSync(path.join(dir, "assets", "a.js"), "a()");
    writeFileSync(path.join(dir, "ui.json"), JSON.stringify({ uiVersion: "0.1.0", seq: 42 }));
    const b = builtInFrom(dir);
    expect(b.uiVersion).toBe("0.1.0");
    expect(b.seq).toBe(42);
    expect([...b.files().keys()].sort()).toEqual(["assets/a.js", "index.html", "ui.json"]);
  });
});

describe("KIWI_UI_CHANNEL errado (T1378)", () => {
  test("cai no canal desligado com um aviso, e a janela abre com a UI de fábrica", () => {
    const warnings: string[] = [];
    expect(channelUrlOrOff("https://example.com", "settings", (m) => warnings.push(m))).toBeNull();
    expect(channelUrlOrOff("nada", "history", (m) => warnings.push(m))).toBeNull();
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("the UI channel stays off");
    expect(channelUrlOrOff(undefined, "settings", (m) => warnings.push(m))).toBeNull();
    expect(channelUrlOrOff("http://127.0.0.1:5179", "settings", (m) => warnings.push(m))).toBe("http://127.0.0.1:5179/settings/manifest.json");
    expect(warnings).toHaveLength(2);
  });
});
