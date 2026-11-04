// A árvore com todos os arquivos do cofre (T3370, spec #3272): o vault lista o que não é nota, o watcher acompanha, e o
// `files.open` abre no app padrão do Mac (ou só no Finder, se o arquivo rodaria algo).

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { directInvoke } from "../bun/ui-engine.ts";
import { openMode } from "../shared/attachments.ts";
import { DEFAULT_SETTINGS } from "../store/settings.ts";
import { Vault } from "./vault.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function vault(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "kiwinotes-files-test-"));
  dirs.push(dir);
  const root = path.join(dir, "KiwiNotes");
  mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  const v = new Vault({ root, debounceMs: 20, trash: async (abs) => rmSync(abs, { recursive: true }) });
  vaults.push(v);
  await v.open();
  return { v, root };
}

async function waitFor(probe: () => boolean, ms = 3000) {
  for (const end = Date.now() + ms; !probe(); await Bun.sleep(10)) if (Date.now() > end) throw new Error("timed out");
}

/** O FSEvents do macOS leva um tempo para começar a valer (T2792): escreve uma prova até o watcher ver. */
async function watcherReady(root: string, v: Vault) {
  let seen = false;
  const off = v.onOtherFiles((paths) => (seen ||= paths.includes("prova-do-watcher.txt")));
  const probe = path.join(root, "prova-do-watcher.txt");
  for (let i = 0; i < 200 && !seen; i++) {
    writeFileSync(probe, String(i));
    await Bun.sleep(10);
  }
  off();
  rmSync(probe, { force: true });
  if (!seen) throw new Error("o watcher não começou a valer em 2 s");
  await waitFor(() => !v.list().files.some((f) => f.path === "prova-do-watcher.txt"));
}

describe("os arquivos que não são nota (T3370)", () => {
  test("o list traz todos, fora os ocultos e as notas, com tamanho e data", async () => {
    const { v } = await vault({
      "Nota.md": "oi",
      "Anexos/planta.png": "png!",
      "Projetos/quadro.canvas": "{}",
      "Projetos/contrato.pdf": "%PDF",
      ".obsidian/app.json": "{}",
      ".DS_Store": "x",
    });
    const files = v.list().files;
    expect(files.map((f) => f.path)).toEqual(["Anexos/planta.png", "Projetos/contrato.pdf", "Projetos/quadro.canvas"]);
    expect(files[0]!.size).toBe(4);
    expect(Number.isNaN(Date.parse(files[0]!.mtime))).toBe(false);
    expect(v.list().notes.map((n) => n.path)).toEqual(["Nota.md"]);
  });

  test("o watcher acompanha o que entra e sai por fora (o Finder, o Obsidian)", async () => {
    const { v, root } = await vault({ "Nota.md": "oi" });
    v.watch();
    await watcherReady(root, v);
    writeFileSync(path.join(root, "foto.jpg"), "jpg");
    await waitFor(() => v.list().files.some((f) => f.path === "foto.jpg"));
    rmSync(path.join(root, "foto.jpg"));
    await waitFor(() => !v.list().files.some((f) => f.path === "foto.jpg"));
  });

  test("locateFile: só arquivo do cofre que existe e não é nota", async () => {
    const { v, root } = await vault({ "Nota.md": "oi", "Anexos/a.pdf": "%PDF" });
    expect(await v.locateFile("Anexos/a.pdf")).toBe(path.join(root, "Anexos/a.pdf"));
    const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code);
    expect(await code(v.locateFile("Nota.md"))).toBe("E_BAD_ARGS");
    expect(await code(v.locateFile("Anexos/b.pdf"))).toBe("E_NOT_FOUND");
    expect(await code(v.locateFile("Anexos"))).toBe("E_NOT_FOUND");
    expect(await code(v.locateFile("../fora.pdf"))).toBe("E_OUTSIDE_VAULT");
    expect(await code(v.locateFile(".obsidian/app.json"))).toBe("E_OUTSIDE_VAULT");
    expect(await code(v.locateFile(""))).toBe("E_BAD_ARGS");
  });

  test("openMode: o que rodaria algo no `open` só aparece no Finder", () => {
    expect(openMode("/x/contrato.pdf")).toBe("app");
    expect(openMode("/x/quadro.canvas")).toBe("app");
    expect(openMode("/x/foto.HEIC")).toBe("app");
    for (const f of ["instalar.command", "rodar.sh", "a.scpt", "Setup.pkg", "atalho.webloc", "x.app", "y.terminal"]) {
      expect(openMode(`/x/${f}`)).toBe("finder");
    }
  });

  test("files.open pelo engine: o app abre no lugar certo, e o showExtensions é um booleano", async () => {
    const { v, root } = await vault({ "Nota.md": "oi", "a.pdf": "%PDF", "rodar.command": "echo" });
    const opened: [string, string][] = [];
    let settings = { ...DEFAULT_SETTINGS };
    const caps = uiCapabilities({
      dictionary: { load: async () => [], save: async (t) => t },
      snippets: { load: async () => [], save: async (s) => s },
      history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
      dictationNotes: { toNew: async () => { throw new Error("not used") }, append: async () => { throw new Error("not used") } },
      settings: { load: async () => settings, save: async (patch) => (settings = { ...settings, ...patch, appearance: settings.appearance }) },
      clipboardWrite: () => {},
      notes: v,
      openFile: (abs, mode) => void opened.push([path.relative(root, abs), mode]),
    });
    const call = async (cap: string, args: unknown) => {
      const r = await directInvoke(caps, cap, args);
      if (!r.ok) throw r;
      return r.value;
    };
    expect(await call("files.open", { path: "a.pdf" })).toBe(true);
    expect(await call("files.open", { path: "rodar.command" })).toBe(true);
    expect(opened).toEqual([["a.pdf", "app"], ["rodar.command", "finder"]]);
    await expect(call("files.open", { path: "Nota.md" })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(call("files.open", { path: "sumiu.pdf" })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    expect(opened.length).toBe(2);

    expect(((await call("notes.list", {})) as { files: { path: string }[] }).files.map((f) => f.path)).toEqual(["a.pdf", "rodar.command"]);
    expect(DEFAULT_SETTINGS.showExtensions).toBe(false);
    expect(((await call("settings.set", { showExtensions: true })) as { showExtensions: boolean }).showExtensions).toBe(true);
    await expect(call("settings.set", { showExtensions: "sim" })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
  });
});
