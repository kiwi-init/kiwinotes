// T1192: o AppEngine do Kiwi Notes, com o contrato, o canal local e a UI de fábrica. Sem janela e sem app: o `show`
// é de mentira e o canal é um Bun.serve em 127.0.0.1, como o canal local de dev.

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { DEFAULT_APPEARANCE } from "../shared/appearance.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
import { uiCapabilities } from "./ui-capabilities.ts";
import { builtInFrom, channelUrl, channelUrlOrOff, createUiEngine, devServerAllowed, directInvoke, enginePreload, oneAtATime } from "./ui-engine.ts";

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
  const settings: AppSettings = { shortcuts: { ...DEFAULT_SHORTCUTS }, notesShortcut: "control+option+n", pinned: [], appearance: { ...DEFAULT_APPEARANCE }, templatesFolder: "Modelos", dailyFolder: "Diário", attachmentsFolder: "Anexos", ocr: true, semanticSearch: true, savedSearches: [], microphone: "auto", showExtensions: false, cues: true, preciseDictation: false, meetings: { ...DEFAULT_MEETING_SETTINGS }, noteWidth: 760, agent: DEFAULT_AGENT_SETTINGS };
  let t = 0;
  return {
    calls,
    copied,
    tick: (ms: number) => void (t += ms),
    deps: {
      dictionary: {
        load: async () => (calls.push("dictionary.load"), [{ term: "DICOM", aliases: [] }]),
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
    publish(window: string, seq: number, index: string, options: { requiresContract?: string } = {}) {
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
          bundleUrl: name,
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

function rig(manifestUrl: string | null, opts: { readyTimeoutMs?: number } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "kiwinotes-ui-engine-test-"));
  const shown: HostUi[] = [];
  const events: AppEngineEvent[] = [];
  const { deps } = fakeDeps();
  const engine: AppEngine = createUiEngine({
    name: "settings",
    dir,
    builtIn: { uiVersion: "0.1.0", seq: BUILT_IN_SEQ, files: () => new Map([["index.html", encode("<p>fábrica</p>")]]) },
    trustedKeys,
    capabilities: uiCapabilities(deps),
    manifestUrl,
    show: (ui) => void shown.push(ui),
    readyTimeoutMs: opts.readyTimeoutMs ?? 2_000,
    probationMs: 50,
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
    expect(await call("dictionary.get", {})).toMatchObject({ ok: true, value: [{ term: "DICOM" }] });
    expect(await call("dictionary.get", { x: 1 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("dictionary.set", { terms: "DICOM" })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("dictionary.set", { terms: [{ term: " PACS ", aliases: [] }, { term: "" }] })).toMatchObject({
      ok: true,
      value: [{ term: "PACS", aliases: [] }],
    });
    expect(await call("history.search", { limit: 0 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("history.search", { query: 42 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("history.search", { query: "reunião", limit: 10 })).toMatchObject({ ok: true });
    expect(await call("history.delete", {})).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("history.delete", { id: "abc" })).toMatchObject({ ok: true, value: true });
    expect(await call("history.search", [])).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(f.calls).toEqual(["dictionary.load", "dictionary.save:1", 'history.search:{"query":"reunião","limit":10}', "history.delete:abc"]);
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
    const dir = mkdtempSync(path.join(tmpdir(), "kiwinotes-builtin-test-"));
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
