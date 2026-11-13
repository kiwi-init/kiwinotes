// A árvore com todos os arquivos do cofre (T3370, spec #3272): o vault lista o que não é nota, o watcher acompanha, e o
// `files.open` abre no app padrão do Mac (ou só no Finder, se o arquivo rodaria algo).

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { directInvoke } from "../bun/ui-engine.ts";
import { openMode } from "../shared/attachments.ts";
import { DEFAULT_SETTINGS } from "../store/settings.ts";
import { Vault } from "./vault.ts";
import { tempDir } from "../../test/tmp.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function vault(files: Record<string, string>) {
  const dir = tempDir("kiwinotes-files-test-");
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

  test("uma pasta apagada por fora avisa também pelos arquivos (o files.changed)", async () => {
    const { v, root } = await vault({ "Nota.md": "oi", "Fotos/a.png": "png" });
    v.watch();
    await watcherReady(root, v);
    const seen: string[][] = [];
    v.onOtherFiles((p) => void seen.push(p));
    rmSync(path.join(root, "Fotos"), { recursive: true });
    await waitFor(() => !v.list().files.length && seen.flat().some((p) => p.startsWith("Fotos")));
  });

  test("documento-pacote (.pages, .numbers, .key): arquivo na lista, sem virar pasta, e abre no app dele", async () => {
    const { v, root } = await vault({ "Nota.md": "oi", "Relatório.pages/Index.zip": "zip", "Relatório.pages/Data/foto.png": "png", "Contas.numbers/Index.zip": "z" });
    const { isPackageDir } = await import("../shared/attachments.ts");
    expect(isPackageDir("A.rtfd", ["TXT.rtf", "foto.png"])).toBe(true);
    expect(isPackageDir("A.key", ["Index.zip", "Ideia.md"])).toBe(false);
    expect(isPackageDir("A.key", ["Ideia.txt"])).toBe(false);
    expect(isPackageDir("A.zip", ["Index.zip"])).toBe(false);
    expect(v.list().files.map((f) => f.path)).toEqual(["Contas.numbers", "Relatório.pages"]);
    expect(v.list().folders).toEqual([]);
    expect(await v.locateFile("Relatório.pages")).toEqual({ abs: path.join(root, "Relatório.pages"), mode: 0 });
    expect(openMode("Relatório.pages", 0)).toBe("app");
    // Uma pasta comum continua não sendo arquivo.
    mkdirSync(path.join(root, "Pasta"));
    await expect(v.locateFile("Pasta")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    // O Pages salvando por dentro: o watcher vê o pacote, não os arquivos de dentro.
    v.watch();
    await watcherReady(root, v);
    writeFileSync(path.join(root, "Relatório.pages/Index.zip"), "zip 2");
    writeFileSync(path.join(root, "Novo.key"), "");
    rmSync(path.join(root, "Novo.key"));
    mkdirSync(path.join(root, "Novo.key"));
    writeFileSync(path.join(root, "Novo.key/Index.zip"), "z");
    // A lista inteira de uma vez: o scan troca o índice todo no fim, mas o teste espera o estado final, não o primeiro.
    const all = () => v.list().files.map((f) => f.path).join(",");
    await waitFor(() => all() === "Contas.numbers,Novo.key,Relatório.pages");
    expect(v.list().folders).not.toContain("Novo.key");
  });

  test("um pacote salvo com o app aberto (a pasta antes da marca) vira documento quando a marca chega (revisão #3492)", async () => {
    const { v, root } = await vault({ "Nota.md": "oi" });
    v.watch();
    await watcherReady(root, v);
    mkdirSync(path.join(root, "Novo.key"));
    await waitFor(() => v.list().folders.includes("Novo.key"));
    writeFileSync(path.join(root, "Novo.key/Index.zip"), "zip");
    await waitFor(() => v.list().files.map((f) => f.path).join(",") === "Novo.key" && !v.list().folders.length);
  });

  test("uma pasta comum chamada Projeto.key continua pasta, com as notas de dentro (revisão #3476)", async () => {
    const { v, root } = await vault({ "Projeto.key/Ideia.md": "a ideia", "Chaves.pages/senhas.txt": "x", "Fora.md": "fora" });
    expect(v.list().notes.map((n) => n.path)).toEqual(["Fora.md", "Projeto.key/Ideia.md"]);
    expect(v.list().folders).toEqual(["Chaves.pages", "Projeto.key"]);
    expect(v.list().files.map((f) => f.path)).toEqual(["Chaves.pages/senhas.txt"]);
    await expect(v.locateFile("Projeto.key")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    expect(v.search("ideia").map((h) => h.path)).toEqual(["Projeto.key/Ideia.md"]);
    // Editada por fora, a nota de dentro continua nota (o watcher não confunde com um pacote mudando).
    v.watch();
    await watcherReady(root, v);
    writeFileSync(path.join(root, "Projeto.key/Ideia.md"), "a ideia mudou no Obsidian");
    await waitFor(() => v.search("Obsidian").length === 1);
    expect(v.list().files.map((f) => f.path)).toEqual(["Chaves.pages/senhas.txt"]);
  });

  test("o clique num pacote (T3918): files.open abre no app ou no Finder, nunca E_NOT_FOUND", async () => {
    // As duas formas do iWork: o pacote antigo (`Index.zip`) e o de hoje (a pasta `Index/` com os `.iwa`).
    const { v } = await vault({
      "Projeto.key/Index.zip": "z",
      "Projeto.key/Metadata/Properties.plist": "p",
      "Notas.pages/Index/Document.iwa": "iwa",
      "Notas.pages/Metadata/DocumentIdentifier": "id",
      "Contas.numbers/Index/Document.iwa": "iwa",
      "Texto.rtfd/TXT.rtf": "{\\rtf1}",
    });
    expect(v.list().files.map((f) => f.path)).toEqual(["Contas.numbers", "Notas.pages", "Projeto.key", "Texto.rtfd"]);
    expect(v.list().folders).toEqual([]);
    const opened: [string, string][] = [];
    const caps = uiCapabilities({
      dictionary: { load: async () => [], save: async (t) => t },
      snippets: { load: async () => [], save: async (s) => s },
      history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
      dictationNotes: { toNew: async () => { throw new Error("not used") }, append: async () => { throw new Error("not used") } },
      settings: { load: async () => ({ ...DEFAULT_SETTINGS }), save: async () => ({ ...DEFAULT_SETTINGS }) },
      clipboardWrite: () => {},
      notes: v,
      openFile: (abs, mode) => void opened.push([path.basename(abs), mode]),
    });
    for (const p of ["Projeto.key", "Notas.pages", "Contas.numbers", "Texto.rtfd"]) {
      expect(await directInvoke(caps, "files.open", { path: p })).toEqual({ ok: true, value: true });
    }
    // O `.rtfd` não está na OPENS_IN_APP: só aparece no Finder.
    expect(opened).toEqual([["Projeto.key", "app"], ["Notas.pages", "app"], ["Contas.numbers", "app"], ["Texto.rtfd", "finder"]]);
  });

  test("a marca do iWork de hoje é o Index/Document.iwa: uma pasta Index comum não esconde notas (T3918)", async () => {
    const { v, root } = await vault({
      "Livro.pages/Index/Capítulo 1.md": "era uma vez",
      "Livro.pages/Index/Document.iwa": "iwa",
      "Fotos.key/Index/foto.png": "png",
    });
    expect(v.list().notes.map((n) => n.path)).toEqual(["Livro.pages/Index/Capítulo 1.md"]);
    expect(v.list().folders).toEqual(["Fotos.key", "Fotos.key/Index", "Livro.pages", "Livro.pages/Index"]);
    expect(v.list().files.map((f) => f.path)).toEqual(["Fotos.key/Index/foto.png", "Livro.pages/Index/Document.iwa"]);
    // O Keynote salvando um novo: a pasta e o `Index/` chegam antes do `Document.iwa`; com ele, vira documento.
    v.watch();
    await watcherReady(root, v);
    mkdirSync(path.join(root, "Novo.key/Index"), { recursive: true });
    await waitFor(() => v.list().folders.includes("Novo.key/Index"));
    writeFileSync(path.join(root, "Novo.key/Index/Document.iwa"), "iwa");
    await waitFor(() => v.list().files.some((f) => f.path === "Novo.key") && !v.list().folders.some((f) => f.startsWith("Novo.key")));
    expect(await v.locateFile("Novo.key")).toMatchObject({ mode: 0 });
  });

  test("locateFile: só arquivo do cofre que existe e não é nota", async () => {
    const { v, root } = await vault({ "Nota.md": "oi", "Anexos/a.pdf": "%PDF" });
    expect((await v.locateFile("Anexos/a.pdf")).abs).toBe(path.join(root, "Anexos/a.pdf"));
    const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code);
    expect(await code(v.locateFile("Nota.md"))).toBe("E_BAD_ARGS");
    expect(await code(v.locateFile("Anexos/b.pdf"))).toBe("E_NOT_FOUND");
    expect(await code(v.locateFile("Anexos"))).toBe("E_NOT_FOUND");
    expect(await code(v.locateFile("../fora.pdf"))).toBe("E_OUTSIDE_VAULT");
    expect(await code(v.locateFile(".obsidian/app.json"))).toBe("E_OUTSIDE_VAULT");
    expect(await code(v.locateFile(""))).toBe("E_BAD_ARGS");
  });

  test("openMode: só tipo de documento conhecido e sem o bit de execução abre no app; o resto, no Finder", () => {
    for (const f of ["contrato.pdf", "quadro.canvas", "foto.HEIC", "reunião.m4a", "demo.mov", "notas.txt", "plano.docx", "conta.numbers"]) {
      expect(openMode(`/x/${f}`, 0o644)).toBe("app");
    }
    // O que o `open` executaria ou importaria, e o que ninguém pôs na lista (revisão #3458): Finder.
    for (const f of ["instalar.command", "rodar.sh", "a.scpt", "Setup.pkg", "atalho.webloc", "evento.ics", "cartao.vcf", "x.itermcolors", "pagina.html", "desenho.svg", "foo.bin", "install", "LEIAME"]) {
      expect(openMode(`/x/${f}`, 0o644)).toBe("finder");
    }
    // Com o bit de execução, nem um PDF abre no app: o `open` trataria como executável.
    expect(openMode("/x/contrato.pdf", 0o755)).toBe("finder");
    expect(openMode("/x/contrato.pdf", 0o644 | 0o100)).toBe("finder");
  });

  test("files.open pelo engine: o app abre no lugar certo, e o showExtensions é um booleano", async () => {
    const { v, root } = await vault({ "Nota.md": "oi", "a.pdf": "%PDF", "rodar.command": "echo", "install": "#!/bin/sh\necho oi\n", "b.pdf": "%PDF" });
    // Um script sem extensão com +x (o caso da revisão #3458), e um "PDF" executável.
    chmodSync(path.join(root, "install"), 0o755);
    chmodSync(path.join(root, "b.pdf"), 0o755);
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
    expect(await call("files.open", { path: "install" })).toBe(true);
    expect(await call("files.open", { path: "b.pdf" })).toBe(true);
    expect(opened).toEqual([["a.pdf", "app"], ["rodar.command", "finder"], ["install", "finder"], ["b.pdf", "finder"]]);
    await expect(call("files.open", { path: "Nota.md" })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(call("files.open", { path: "sumiu.pdf" })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    expect(opened.length).toBe(4);

    expect(((await call("notes.list", {})) as { files: { path: string }[] }).files.map((f) => f.path)).toEqual(["a.pdf", "b.pdf", "install", "rodar.command"]);
    expect(DEFAULT_SETTINGS.showExtensions).toBe(false);
    expect(((await call("settings.set", { showExtensions: true })) as { showExtensions: boolean }).showExtensions).toBe(true);
    await expect(call("settings.set", { showExtensions: "sim" })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
  });
});
