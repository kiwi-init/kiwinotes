// Os projetos (spec #9874): a lógica pura, as capacidades sobre um cofre de verdade num tmp, e o que muda por fora com
// o watcher de verdade (como as fixadas, `pinned.test.ts`). Nenhum agente aqui: o agente falso está em
// `src/headless/agent-cli.test.ts`, e as ferramentas pelo MCP em `src/agent/tools/tools.test.ts`.

import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type CapabilityDeps, uiCapabilities } from "../bun/ui-capabilities.ts";
import { directInvoke } from "../bun/ui-engine.ts";
import { DEFAULT_SETTINGS } from "../store/settings.ts";
import { findProjects } from "./project-finder.ts";
import { checkMark, followProjects, freeFolderName, mapProjects, openTasks, type ProjectEntry, ProjectError, STATUS_OUTLINE_MAX } from "./projects.ts";
import { Vault } from "./vault.ts";
import { tempDir } from "../../test/tmp.ts";

const now = (notes: string[], folders: string[]) => ({ notes: new Set(notes), folders: new Set(folders) });
const none = { moves: new Map<string, string>(), gone: [] as string[] };

describe("openTasks: as caixas abertas, pela estrutura da nota", () => {
  test("conta só `- [ ]` de verdade: não a marcada, nem a de dentro de código, de comentário ou do frontmatter", () => {
    const note = [
      "---",
      "todo: - [ ] no frontmatter não conta",
      "---",
      "# Plano",
      "",
      "- [ ] uma",
      "- [x] feita",
      "- [X] feita também",
      "  - [ ] aninhada",
      "* [ ] com asterisco",
      "1. [ ] numerada",
      "",
      "```",
      "- [ ] dentro de código",
      "```",
      "",
      "    - [ ] código indentado",
      "",
      "%% - [ ] num comentário %%",
      "",
      "texto - [ ] no meio da frase não é caixa",
      "",
    ].join("\n");
    expect(openTasks(note)).toBe(4);
    expect(openTasks("")).toBe(0);
  });
});

describe("mapProjects: o que muda pelo app", () => {
  const list: ProjectEntry[] = [
    { folder: "Clientes/Acme", main: "Clientes/Acme/Acme.md", mainIno: 7 },
    { folder: "Kiwi", main: "Kiwi/Kiwi.md" },
  ];
  const moveUnder = (from: string, to: string) => (p: string) => (p === from || p.startsWith(`${from}/`) ? `${to}${p.slice(from.length)}` : p);
  const dropUnder = (gone: string) => (p: string) => (p === gone || p.startsWith(`${gone}/`) ? null : p);

  test("a pasta renomeada ou movida leva o projeto, com a nota principal e o inode", () => {
    expect(mapProjects(list, moveUnder("Clientes", "Trabalho/Clientes"))).toEqual([
      { folder: "Trabalho/Clientes/Acme", main: "Trabalho/Clientes/Acme/Acme.md", mainIno: 7 },
      { folder: "Kiwi", main: "Kiwi/Kiwi.md" },
    ]);
  });

  test("a nota principal renomeada vai junto; apagada ou movida para fora, o projeto fica sem ela", () => {
    expect(mapProjects(list, moveUnder("Kiwi/Kiwi.md", "Kiwi/Visão.md"))[1]).toEqual({ folder: "Kiwi", main: "Kiwi/Visão.md" });
    expect(mapProjects(list, dropUnder("Kiwi/Kiwi.md"))[1]).toEqual({ folder: "Kiwi", main: null });
    expect(mapProjects(list, moveUnder("Kiwi/Kiwi.md", "Outra/Kiwi.md"))[1]).toEqual({ folder: "Kiwi", main: null });
  });

  test("a pasta apagada (ou a de cima dela) acaba com o projeto", () => {
    expect(mapProjects(list, dropUnder("Clientes"))).toEqual([{ folder: "Kiwi", main: "Kiwi/Kiwi.md" }]);
  });
});

describe("followProjects: o que muda por fora", () => {
  const acme: ProjectEntry = { folder: "Clientes/Acme", main: "Clientes/Acme/Acme.md", mainIno: 7 };

  test("a pasta renomeada vai para onde a nota principal foi", () => {
    const r = { moves: new Map([["Clientes/Acme/Acme.md", "Clientes/ACME Ltda/Acme.md"]]), gone: [] };
    const out = followProjects([acme], r, now(["Clientes/ACME Ltda/Acme.md"], ["Clientes", "Clientes/ACME Ltda"]), new Map([["Clientes/ACME Ltda/Acme.md", 7]]));
    expect(out).toEqual([{ folder: "Clientes/ACME Ltda", main: "Clientes/ACME Ltda/Acme.md", mainIno: 7 }]);
  });

  test("sem a nota principal, a pasta vai para onde as outras notas foram", () => {
    const sem: ProjectEntry = { folder: "Kiwi", main: null };
    const r = { moves: new Map([["Kiwi/Sub/a.md", "Apps/Kiwi/Sub/a.md"]]), gone: [] };
    expect(followProjects([sem], r, now(["Apps/Kiwi/Sub/a.md"], ["Apps", "Apps/Kiwi", "Apps/Kiwi/Sub"]))).toEqual([{ folder: "Apps/Kiwi", main: null }]);
  });

  test("a nota principal renomeada na mesma pasta vai junto; apagada, o projeto fica sem ela", () => {
    const renamed = { moves: new Map([["Clientes/Acme/Acme.md", "Clientes/Acme/Visão.md"]]), gone: [] };
    expect(followProjects([acme], renamed, now(["Clientes/Acme/Visão.md"], ["Clientes", "Clientes/Acme"]), new Map([["Clientes/Acme/Visão.md", 7]]))).toEqual([
      { folder: "Clientes/Acme", main: "Clientes/Acme/Visão.md", mainIno: 7 },
    ]);
    const gone = { moves: new Map<string, string>(), gone: ["Clientes/Acme/Acme.md"] };
    expect(followProjects([acme], gone, now([], ["Clientes", "Clientes/Acme"]))).toEqual([{ folder: "Clientes/Acme", main: null }]);
  });

  test("a pasta apagada por fora acaba com o projeto", () => {
    expect(followProjects([acme], { moves: new Map(), gone: ["Clientes/Acme/Acme.md"] }, now([], ["Clientes"]))).toEqual([]);
  });

  test("com o app fechado (sem moves): a pasta pelo inode dela, e a nota principal pelo inode dela", () => {
    const withDir: ProjectEntry = { ...acme, folderIno: 70 };
    const dirs = (m: Record<string, number>) => (f: string) => m[f];
    // A pasta renomeada: o mesmo inode de pasta.
    expect(followProjects([withDir], none, now(["Arquivo/Acme/Acme.md"], ["Arquivo", "Arquivo/Acme"]), new Map([["Arquivo/Acme/Acme.md", 7]]), dirs({ "Arquivo/Acme": 70 }))).toEqual([
      { folder: "Arquivo/Acme", main: "Arquivo/Acme/Acme.md", mainIno: 7, folderIno: 70 },
    ]);
    // A nota principal renomeada dentro da pasta, que ficou onde estava.
    expect(
      followProjects([withDir], none, now(["Clientes/Acme/Visão.md"], ["Clientes", "Clientes/Acme"]), new Map([["Clientes/Acme/Visão.md", 7]]), dirs({ "Clientes/Acme": 70 })),
    ).toEqual([{ folder: "Clientes/Acme", main: "Clientes/Acme/Visão.md", mainIno: 7, folderIno: 70 }]);
    // A nota principal arrastada para uma pasta que já existia, e a do projeto apagada: o inode da pasta é outro.
    expect(followProjects([withDir], none, now(["Inbox/Acme.md"], ["Inbox"]), new Map([["Inbox/Acme.md", 7]]), dirs({ Inbox: 99 }))).toEqual([]);
    // O mesmo inode numa nota de outro nome e fora da pasta não é a nota principal (o cofre veio de outro disco).
    expect(followProjects([withDir], none, now(["Outra/Coisa.md"], ["Outra"]), new Map([["Outra/Coisa.md", 7]]), dirs({ Outra: 70 }))).toEqual([]);
  });

  test("notas arrastadas para uma pasta que já existia, e a do projeto apagada: o projeto acaba (revisão #10099)", () => {
    const proj: ProjectEntry = { folder: "Proj", main: "Proj/Proj.md" };
    const r = { moves: new Map([["Proj/ideia.md", "Inbox/ideia.md"]]), gone: ["Proj/Proj.md"] };
    const after = now(["Inbox/ideia.md", "Inbox/velha.md"], ["Inbox"]);
    // Sem o inode da pasta (um projeto de antes dele): a Inbox tem uma nota que não veio do projeto.
    expect(followProjects([proj], r, after)).toEqual([]);
    // Com o inode: o da Inbox é outro.
    expect(followProjects([{ ...proj, folderIno: 5 }], r, after, new Map(), (f) => (f === "Inbox" ? 6 : undefined))).toEqual([]);
    // Sem o inode, todas as notas indo para a mesma pasta nova, só com elas: é um rename, e o projeto segue.
    const renamed = { moves: new Map([["Proj/ideia.md", "Novo/ideia.md"], ["Proj/Proj.md", "Novo/Proj.md"]]), gone: [] };
    expect(followProjects([proj], renamed, now(["Novo/ideia.md", "Novo/Proj.md"], ["Novo"]))).toEqual([{ folder: "Novo", main: "Novo/Proj.md" }]);
    // Metade para um lado, metade para outro: não é a pasta que mudou.
    const split = { moves: new Map([["Proj/ideia.md", "A/ideia.md"], ["Proj/Proj.md", "B/Proj.md"]]), gone: [] };
    expect(followProjects([proj], split, now(["A/ideia.md", "B/Proj.md"], ["A", "B"]))).toEqual([]);
  });

  test("a pasta renomeada por fora para dentro de outro projeto, ou da pasta das reuniões, leva o projeto embora", () => {
    const b: ProjectEntry = { folder: "B", main: "B/B.md", folderIno: 2 };
    const a: ProjectEntry = { folder: "A", main: "A/A.md", folderIno: 1 };
    const intoA = { moves: new Map([["B/B.md", "A/B/B.md"]]), gone: [] };
    const dirs = (f: string) => ({ A: 1, "A/B": 2, "Reuniões/B": 2 })[f];
    expect(followProjects([a, b], intoA, now(["A/A.md", "A/B/B.md"], ["A", "A/B"]), new Map(), dirs, "Reuniões")).toEqual([{ ...a }]);
    const intoMeetings = { moves: new Map([["B/B.md", "Reuniões/B/B.md"]]), gone: [] };
    expect(followProjects([b], intoMeetings, now(["Reuniões/B/B.md"], ["Reuniões", "Reuniões/B"]), new Map(), dirs, "Reuniões")).toEqual([]);
  });

  test("nada mudou: igual, e o inode de agora é guardado", () => {
    const plain: ProjectEntry = { folder: "Kiwi", main: "Kiwi/Kiwi.md" };
    expect(followProjects([plain], none, now(["Kiwi/Kiwi.md"], ["Kiwi"]), new Map([["Kiwi/Kiwi.md", 42]]))).toEqual([{ ...plain, mainIno: 42 }]);
  });
});

describe("checkMark: o que pode virar projeto", () => {
  const list: ProjectEntry[] = [{ folder: "Clientes/Acme", main: null }];
  const folders = new Set(["Clientes", "Clientes/Acme", "Clientes/Acme/Docs", "Kiwi", "Reuniões", "Reuniões/2026"]);
  const code = (f: () => void) => {
    try {
      f();
      return "ok";
    } catch (e) {
      return (e as ProjectError).code;
    }
  };

  test("um projeto não fica dentro de outro, nem por cima de outro", () => {
    expect(code(() => checkMark("Clientes/Acme/Docs", list, folders, "Reuniões"))).toBe("E_NESTED");
    expect(code(() => checkMark("Clientes", list, folders, "Reuniões"))).toBe("E_NESTED");
    expect(code(() => checkMark("Kiwi", list, folders, "Reuniões"))).toBe("ok");
  });

  test("a pasta das reuniões e as de dentro dela não; sem pasta de reuniões, pode", () => {
    expect(code(() => checkMark("Reuniões", list, folders, "Reuniões"))).toBe("E_MEETINGS_FOLDER");
    expect(code(() => checkMark("Reuniões/2026", list, folders, "Reuniões"))).toBe("E_MEETINGS_FOLDER");
    expect(code(() => checkMark("Reuniões", list, folders, null))).toBe("ok");
  });

  test("a raiz e a pasta que não existe não", () => {
    expect(code(() => checkMark("", list, folders, null))).toBe("E_BAD_ARGS");
    expect(code(() => checkMark("Nada", list, folders, null))).toBe("E_NOT_FOUND");
  });
});

// ---------------------------------------------------------------- as capacidades, sobre um cofre de verdade

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close?.();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function writeAll(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
}

function newRoot(files: Record<string, string> = {}): string {
  const root = path.join(tempDir("kn-projects-"), "V");
  mkdirSync(root, { recursive: true });
  writeAll(root, files);
  return root;
}

function open(
  root: string,
  extra: Partial<Pick<CapabilityDeps, "meetingsFolder" | "projectsHome" | "chooseProjectFolder" | "reveal" | "projectsFinder">> = {},
) {
  const v = new Vault({ root, debounceMs: 20, trash: async () => {} });
  vaults.push(v);
  const caps = uiCapabilities({
    dictionary: { load: async () => [], save: async (t) => t },
    snippets: { load: async () => [], save: async (s) => s },
    history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
    dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
    settings: { load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }), save: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }) },
    clipboardWrite: () => {},
    notes: v,
    ...extra,
  });
  const call = async (cap: string, args: unknown = {}) => {
    const r = await directInvoke(caps, cap, args);
    return r as { ok: true; value: any } | { ok: false; code: string; message: string };
  };
  const value = async (cap: string, args: unknown = {}) => {
    const r = await call(cap, args);
    if (!r.ok) throw new Error(`${cap}: ${r.code} ${r.message}`);
    return r.value;
  };
  return { v, call, value };
}

/** O conteúdo de cada nota do cofre (sem as pastas ocultas): a marcação não pode mudar nenhuma. */
function notesOf(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else out[path.relative(root, abs)] = `${readFileSync(abs, "utf8")}|${statSync(abs).mtimeMs}`;
    }
  };
  walk(root);
  return out;
}

const fileOf = (root: string) => JSON.parse(readFileSync(path.join(root, ".kiwi/projects.json"), "utf8"));

describe("marcar, listar, trocar a nota principal e desmarcar", () => {
  test("marcar cria a nota com o nome da pasta, só com o título, e nenhuma outra nota muda", async () => {
    const root = newRoot({ "Clientes/Acme/Plano.md": "# Plano\n", "Ideias.md": "gatos" });
    const { value } = open(root);
    await value("notes.list");
    const before = notesOf(root);

    const r = await value("projects.mark", { folder: "Clientes/Acme" });
    expect(r).toMatchObject({ created: true, project: { name: "Acme", folder: "Clientes/Acme", main: "Clientes/Acme/Acme.md", notes: 2 } });
    expect(readFileSync(path.join(root, "Clientes/Acme/Acme.md"), "utf8")).toBe("# Acme\n");
    const after = notesOf(root);
    delete after["Clientes/Acme/Acme.md"];
    expect(after).toEqual(before);

    // A marcação fica no arquivo oculto do cofre, que não vira nota.
    expect(fileOf(root)).toEqual({
      version: 1,
      projects: [
        {
          folder: "Clientes/Acme",
          main: "Clientes/Acme/Acme.md",
          mainIno: statSync(path.join(root, "Clientes/Acme/Acme.md")).ino,
          folderIno: statSync(path.join(root, "Clientes/Acme")).ino,
        },
      ],
    });
    expect((await value("notes.list")).notes.map((n: { path: string }) => n.path)).not.toContainEqual(expect.stringContaining(".kiwi"));

    // Marcar de novo não muda nada.
    expect(await value("projects.mark", { folder: "Clientes/Acme" })).toMatchObject({ created: false, project: { folder: "Clientes/Acme" } });
    expect(fileOf(root).projects).toHaveLength(1);
  });

  test("com a nota com o nome da pasta, marcar não cria nem muda nada nela", async () => {
    const root = newRoot({ "Kiwi/Kiwi.md": "# Kiwi\n\ntexto da pessoa\n" });
    const { value } = open(root);
    await value("notes.list");
    const before = notesOf(root);
    expect(await value("projects.mark", { folder: "Kiwi" })).toMatchObject({ created: false, project: { main: "Kiwi/Kiwi.md" } });
    expect(notesOf(root)).toEqual(before);
  });

  test("listar, trocar a nota principal e desmarcar, sem mexer nas notas", async () => {
    const root = newRoot({ "Kiwi/Kiwi.md": "# Kiwi\n", "Kiwi/Visão.md": "# Visão\n", "Fora.md": "" });
    const { call, value } = open(root);
    await value("projects.mark", { folder: "Kiwi" });
    const before = notesOf(root);
    expect((await value("projects.list")).projects).toEqual([
      expect.objectContaining({ name: "Kiwi", folder: "Kiwi", main: "Kiwi/Kiwi.md", notes: 2, updated: expect.any(String) }),
    ]);
    expect(await value("projects.setMain", { folder: "Kiwi", note: "Kiwi/Visão.md" })).toMatchObject({ project: { main: "Kiwi/Visão.md" } });
    expect(fileOf(root).projects[0]).toMatchObject({ main: "Kiwi/Visão.md", mainIno: statSync(path.join(root, "Kiwi/Visão.md")).ino });
    expect(await call("projects.setMain", { folder: "Kiwi", note: "Fora.md" })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("projects.setMain", { folder: "Kiwi", note: "Kiwi/Nada.md" })).toMatchObject({ ok: false, code: "E_NOT_FOUND" });
    expect(await call("projects.setMain", { folder: "Fora", note: "Fora.md" })).toMatchObject({ ok: false, code: "E_NOT_FOUND" });
    expect(await value("projects.unmark", { folder: "Kiwi" })).toBe(true);
    expect((await value("projects.list")).projects).toEqual([]);
    expect(await call("projects.unmark", { folder: "Kiwi" })).toMatchObject({ ok: false, code: "E_NOT_FOUND" });
    expect(notesOf(root)).toEqual(before);
  });

  test("as regras: um dentro do outro, a pasta das reuniões, a raiz, a que não existe e a oculta", async () => {
    const root = newRoot({ "A/B/n.md": "", "Reuniões/2026/r.md": "", "C/n.md": "" });
    const { call, value } = open(root);
    await value("projects.mark", { folder: "A" });
    expect(await call("projects.mark", { folder: "A/B" })).toMatchObject({ ok: false, code: "E_NESTED" });
    expect(await call("projects.mark", { folder: "Reuniões" })).toMatchObject({ ok: false, code: "E_MEETINGS_FOLDER" });
    expect(await call("projects.mark", { folder: "Reuniões/2026" })).toMatchObject({ ok: false, code: "E_MEETINGS_FOLDER" });
    expect(await call("projects.mark", { folder: "" })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("projects.mark", { folder: "Nada" })).toMatchObject({ ok: false, code: "E_NOT_FOUND" });
    expect(await call("projects.mark", { folder: ".kiwi" })).toMatchObject({ ok: false });
    expect(await call("projects.mark", { folder: "../fora" })).toMatchObject({ ok: false });
    expect(await call("projects.mark", { folder: "C", extra: 1 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(fileOf(root).projects.map((p: { folder: string }) => p.folder)).toEqual(["A"]);
    // Numa pasta de notas escolhida pela pessoa (sem pasta de reuniões), "Reuniões" é uma pasta como as outras.
    const other = open(newRoot({ "Reuniões/n.md": "" }), { meetingsFolder: null });
    expect(await other.value("projects.mark", { folder: "Reuniões" })).toMatchObject({ project: { folder: "Reuniões" } });
  });
});

describe("o projeto acompanha a pasta pelo app", () => {
  test("renomear e mover a pasta e renomear a nota principal mantêm o projeto", async () => {
    const root = newRoot({ "Kiwi/Kiwi.md": "# Kiwi\n", "Kiwi/a.md": "" });
    const { value } = open(root);
    await value("projects.mark", { folder: "Kiwi" });
    await value("folders.rename", { path: "Kiwi", newPath: "Kiwi Notes" });
    expect((await value("projects.list")).projects[0]).toMatchObject({ folder: "Kiwi Notes", main: "Kiwi Notes/Kiwi.md" });
    await value("folders.create", { path: "Apps" });
    await value("folders.move", { path: "Kiwi Notes", parent: "Apps" });
    expect((await value("projects.list")).projects[0]).toMatchObject({ folder: "Apps/Kiwi Notes", main: "Apps/Kiwi Notes/Kiwi.md" });
    await value("notes.rename", { path: "Apps/Kiwi Notes/Kiwi.md", newPath: "Apps/Kiwi Notes/Visão.md" });
    expect((await value("projects.list")).projects[0]).toMatchObject({ folder: "Apps/Kiwi Notes", main: "Apps/Kiwi Notes/Visão.md" });
  });

  test("mover uma pasta que poria um projeto dentro de outro, ou na pasta das reuniões, é recusado, e nada muda (revisão #10099)", async () => {
    const root = newRoot({ "A/A.md": "", "B/B.md": "", "Solta/C/C.md": "", "Reuniões/r.md": "" });
    const { call, value } = open(root);
    await value("projects.mark", { folder: "A" });
    await value("projects.mark", { folder: "B" });
    await value("projects.mark", { folder: "Solta/C" });
    const before = notesOf(root);
    expect(await call("folders.move", { path: "B", parent: "A" })).toMatchObject({ ok: false, code: "E_NESTED" });
    expect(await call("folders.rename", { path: "B", newPath: "A/Sub/B" })).toMatchObject({ ok: false, code: "E_NESTED" });
    // Uma pasta que não é projeto, mas tem um dentro, também não entra num projeto.
    expect(await call("folders.move", { path: "Solta", parent: "A" })).toMatchObject({ ok: false, code: "E_NESTED" });
    // A pasta das reuniões também não.
    expect(await call("folders.move", { path: "B", parent: "Reuniões" })).toMatchObject({ ok: false, code: "E_MEETINGS_FOLDER" });
    expect(notesOf(root)).toEqual(before);
    expect((await value("projects.list")).projects.map((p: { folder: string }) => p.folder)).toEqual(["A", "B", "Solta/C"]);
    // Mover para um lugar livre continua valendo.
    await value("folders.create", { path: "Trabalho" });
    await value("folders.move", { path: "B", parent: "Trabalho" });
    expect((await value("projects.list")).projects.map((p: { folder: string }) => p.folder)).toEqual(["A", "Trabalho/B", "Solta/C"]);
  });

  test("apagar a nota principal deixa o projeto sem ela; apagar a pasta acaba com ele", async () => {
    const root = newRoot({ "Kiwi/Kiwi.md": "# Kiwi\n", "Kiwi/a.md": "" });
    const { value } = open(root);
    await value("projects.mark", { folder: "Kiwi" });
    await value("notes.delete", { path: "Kiwi/Kiwi.md" });
    expect((await value("projects.list")).projects).toEqual([expect.objectContaining({ folder: "Kiwi", main: null })]);
    await value("folders.delete", { path: "Kiwi" });
    expect((await value("projects.list")).projects).toEqual([]);
  });
});

describe("a marcação fica no cofre", () => {
  test("continua depois de fechar e abrir, e vai junto quando o cofre muda de lugar", async () => {
    const root = newRoot({ "Kiwi/Kiwi.md": "# Kiwi\n", "Kiwi/a.md": "- [ ] fazer\n" });
    const first = open(root);
    await first.value("projects.mark", { folder: "Kiwi" });
    first.v.close?.();

    // Fechar e abrir: um vault e capacidades novos, no mesmo cofre.
    const again = open(root);
    expect((await again.value("projects.list")).projects).toEqual([expect.objectContaining({ folder: "Kiwi", main: "Kiwi/Kiwi.md" })]);

    // O cofre copiado para outro lugar (outro disco: os inodes mudam) leva os projetos.
    const moved = path.join(path.dirname(root), "Em outro lugar");
    cpSync(root, moved, { recursive: true });
    const there = open(moved);
    expect((await there.value("projects.list")).projects).toEqual([expect.objectContaining({ folder: "Kiwi", main: "Kiwi/Kiwi.md", notes: 2 })]);
    expect((await there.value("projects.status", { folder: "Kiwi" })).openTasks).toBe(1);
  });

  test("um projects.json estragado não derruba um rename de nota, e a lista diz o erro", async () => {
    const root = newRoot({ "Kiwi/Kiwi.md": "", "A.md": "" });
    writeAll(root, { ".kiwi/projects.json": "{ não é json" });
    const { call, value } = open(root);
    await value("notes.list");
    expect(await call("notes.rename", { path: "A.md", newPath: "B.md" })).toMatchObject({ ok: true });
    expect(existsSync(path.join(root, "B.md"))).toBe(true);
    expect(await call("projects.list")).toMatchObject({ ok: false, code: "E_PROJECTS_FILE" });
    // O arquivo estragado fica como estava: nada sobrescreve o que a pessoa pode consertar.
    expect(readFileSync(path.join(root, ".kiwi/projects.json"), "utf8")).toBe("{ não é json");
  });
});

describe("projects.status: só contado", () => {
  test("o sumário da nota principal, as 10 mudadas por último e as caixas abertas de cada nota, com o total", async () => {
    const files: Record<string, string> = {
      "Kiwi/Kiwi.md": "# Kiwi\n\n## Prazo\n\n- [ ] fechar o spec\n\n## Equipe\n\n### harry\n",
      "Kiwi/Sub/Plano.md": "- [ ] a\n- [ ] b\n- [x] c\n\n```\n- [ ] código\n```\n",
      "Fora/Outro.md": "- [ ] fora do projeto\n",
    };
    for (let i = 0; i < 12; i++) files[`Kiwi/n${String(i).padStart(2, "0")}.md`] = i === 3 ? "- [ ] uma\n" : "";
    const root = newRoot(files);
    // As datas: a nota n00 é a mais velha, e a n11 a mais nova; a principal e o plano ficam no meio.
    const base = Date.parse("2026-11-01T00:00:00Z") / 1000;
    for (let i = 0; i < 12; i++) utimesSync(path.join(root, `Kiwi/n${String(i).padStart(2, "0")}.md`), base + i * 60, base + i * 60);
    utimesSync(path.join(root, "Kiwi/Kiwi.md"), base - 600, base - 600);
    utimesSync(path.join(root, "Kiwi/Sub/Plano.md"), base + 5 * 60 + 30, base + 5 * 60 + 30);
    const { value } = open(root);
    await value("projects.mark", { folder: "Kiwi" });

    const s = await value("projects.status", { folder: "Kiwi" });
    expect(s.project).toMatchObject({ name: "Kiwi", folder: "Kiwi", main: "Kiwi/Kiwi.md", notes: 14 });
    expect(s.outline).toEqual([
      { level: 1, title: "Kiwi" },
      { level: 2, title: "Prazo" },
      { level: 2, title: "Equipe" },
      { level: 3, title: "harry" },
    ]);
    expect(s.outlineTotal).toBe(4);
    expect(s.recent.map((n: { path: string }) => n.path)).toEqual([
      "Kiwi/n11.md",
      "Kiwi/n10.md",
      "Kiwi/n09.md",
      "Kiwi/n08.md",
      "Kiwi/n07.md",
      "Kiwi/n06.md",
      "Kiwi/Sub/Plano.md",
      "Kiwi/n05.md",
      "Kiwi/n04.md",
      "Kiwi/n03.md",
    ]);
    expect(s.recent[0].mtime).toBe(new Date((base + 11 * 60) * 1000).toISOString());
    expect(s.tasks).toEqual([
      { path: "Kiwi/Sub/Plano.md", open: 2 },
      { path: "Kiwi/Kiwi.md", open: 1 },
      { path: "Kiwi/n03.md", open: 1 },
    ]);
    expect(s.taskNotes).toBe(3);
    expect(s.openTasks).toBe(4);
  });

  test("o sumário para nos 300 títulos e diz quantos há", async () => {
    const big = Array.from({ length: 320 }, (_, i) => `## Seção ${i}\n`).join("\n");
    const root = newRoot({ "Kiwi/Kiwi.md": big });
    const { value } = open(root);
    await value("projects.mark", { folder: "Kiwi" });
    const s = await value("projects.status", { folder: "Kiwi" });
    expect(s.outline).toHaveLength(STATUS_OUTLINE_MAX);
    expect(s.outlineTotal).toBe(320);
  });
});

// ---------------------------------------------------------------- por fora, com o watcher de verdade

describe("o projeto acompanha o que muda por fora (Finder, Obsidian)", () => {
  /** Espera o watcher valer (o FSEvents leva um instante para começar), como o `pinned.test.ts`. */
  const watcherReady = async (root: string, v: Vault) => {
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
    await Bun.sleep(60);
  };
  const until = async (ok: () => Promise<boolean>) => {
    for (let i = 0; i < 150 && !(await ok()); i++) await Bun.sleep(20);
  };
  async function watched(files: Record<string, string>) {
    const root = newRoot(files);
    const o = open(root);
    await o.value("projects.mark", { folder: "Kiwi" });
    o.v.watch();
    await watcherReady(root, o.v);
    const list = async () => (await o.value("projects.list")).projects as { folder: string; main: string | null }[];
    return { root, list };
  }

  test("a pasta renomeada por fora leva o projeto, pela nota principal", async () => {
    const { root, list } = await watched({ "Kiwi/Kiwi.md": "# Kiwi\n", "Kiwi/a.md": "a" });
    renameSync(path.join(root, "Kiwi"), path.join(root, "Kiwi Notes"));
    await until(async () => (await list())[0]?.folder === "Kiwi Notes");
    expect(await list()).toEqual([expect.objectContaining({ folder: "Kiwi Notes", main: "Kiwi Notes/Kiwi.md" })]);
  });

  test("a nota principal renomeada por fora vai junto; apagada por fora, o projeto fica sem ela", async () => {
    const { root, list } = await watched({ "Kiwi/Kiwi.md": "# Kiwi\n", "Kiwi/a.md": "a" });
    renameSync(path.join(root, "Kiwi/Kiwi.md"), path.join(root, "Kiwi/Visão.md"));
    await until(async () => (await list())[0]?.main === "Kiwi/Visão.md");
    expect((await list())[0]).toMatchObject({ folder: "Kiwi", main: "Kiwi/Visão.md" });
    rmSync(path.join(root, "Kiwi/Visão.md"));
    await until(async () => (await list())[0]?.main === null);
    expect((await list())[0]).toMatchObject({ folder: "Kiwi", main: null });
  });

  test("a nota arrastada por fora para uma pasta que já existia, e a do projeto apagada: o projeto acaba", async () => {
    const { root, list } = await watched({ "Kiwi/Kiwi.md": "# Kiwi\n", "Kiwi/ideia.md": "ideia", "Inbox/velha.md": "velha" });
    renameSync(path.join(root, "Kiwi/ideia.md"), path.join(root, "Inbox/ideia.md"));
    rmSync(path.join(root, "Kiwi"), { recursive: true });
    await until(async () => (await list()).length === 0);
    expect(await list()).toEqual([]);
  });

  test("a pasta apagada por fora acaba com o projeto", async () => {
    const { root, list } = await watched({ "Kiwi/Kiwi.md": "# Kiwi\n" });
    rmSync(path.join(root, "Kiwi"), { recursive: true });
    await until(async () => (await list()).length === 0);
    expect(await list()).toEqual([]);
  });

  test("com o app fechado: a pasta renomeada e a nota principal renomeada são achadas pelo inode ao abrir", async () => {
    const root = newRoot({ "Kiwi/Kiwi.md": "# Kiwi\n", "Outro/Outro.md": "" });
    const first = open(root);
    await first.value("projects.mark", { folder: "Kiwi" });
    await first.value("projects.mark", { folder: "Outro" });
    first.v.close?.();
    renameSync(path.join(root, "Kiwi"), path.join(root, "Kiwi Notes"));
    renameSync(path.join(root, "Outro/Outro.md"), path.join(root, "Outro/Visão.md"));
    const again = open(root);
    expect((await again.value("projects.list")).projects).toEqual([
      expect.objectContaining({ folder: "Kiwi Notes", main: "Kiwi Notes/Kiwi.md" }),
      expect.objectContaining({ folder: "Outro", main: "Outro/Visão.md" }),
    ]);
  });
});

// ---------------------------------------------------------------- a busca e os projetos de fora (spec #12950)

/** Uma casa de mentira num tmp, com a pasta de notas dentro de Documents: nunca a casa de verdade. */
function fakeHome(files: Record<string, string>) {
  const home = tempDir("kn-home-");
  writeAll(home, files);
  const root = path.join(home, "Documents/Notas");
  mkdirSync(root, { recursive: true });
  return { home, root };
}

async function searched(value: (cap: string, args?: unknown) => Promise<any>) {
  let view = await value("projects.find", { start: true });
  for (let i = 0; view.state === "searching" && i < 500; i++) {
    await new Promise((r) => setTimeout(r, 10));
    view = await value("projects.find");
  }
  return view;
}

/** Os nomes e as datas de tudo debaixo de uma pasta: marcar não pode mudar nada lá. */
function treeOf(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      out.push(`${path.relative(dir, abs)}|${statSync(abs).mtimeMs}`);
      if (e.isDirectory()) walk(abs);
    }
  };
  walk(dir);
  return out.sort();
}

describe("a busca das pastas de projeto e os projetos de fora (spec #12950)", () => {
  test("a busca acha na pasta de notas e na casa, com o motivo; sem casa, só na pasta de notas", async () => {
    const { home, root } = fakeHome({
      "Documents/Notas/Clientes/Acme/Acme.md": "# Acme\n",
      "Documents/Notas/Reuniões/proj-reunião/a.md": "x",
      "Developer/kiwi/.git/HEAD": "ref",
      "Documents/work-projects/Alfa/a.pdf": "",
      "Documents/work-projects/Beta/b.pdf": "",
    });
    const { value } = open(root, { meetingsFolder: "Reuniões", projectsHome: () => home });
    const view = await searched(value);
    expect(view.state).toBe("done");
    const got = Object.fromEntries(view.found.map((c: any) => [c.where, c.folder ?? c.outside]));
    expect(got).toEqual({
      "Notas/Clientes/Acme": "Clientes/Acme",
      "~/Developer/kiwi": path.join(home, "Developer/kiwi"),
      "~/Documents/work-projects/Alfa": path.join(home, "Documents/work-projects/Alfa"),
      "~/Documents/work-projects/Beta": path.join(home, "Documents/work-projects/Beta"),
    });
    expect(view.found.find((c: any) => c.name === "kiwi").reason).toEqual({ kind: "marker", marker: ".git" });

    const only = open(root, { meetingsFolder: "Reuniões", projectsHome: () => null });
    expect((await searched(only.value)).found.map((c: any) => c.where)).toEqual(["Notas/Clientes/Acme"]);
  });

  test("o Parar para a busca, e a de novo recomeça", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 400; i++) files[`Developer/p${i}/q/proj-${i}/x`] = "";
    const { home, root } = fakeHome(files);
    const { value } = open(root, { projectsHome: () => home });
    expect((await value("projects.find", { start: true })).state).toBe("searching");
    const stopped = await value("projects.find", { stop: true });
    expect(stopped.state).toBe("stopped");
    await new Promise((r) => setTimeout(r, 50));
    expect((await value("projects.find")).state).toBe("stopped");
    expect((await searched(value)).found.length).toBe(400);
  });

  test("dois cliques seguidos no Procurar não deixam uma busca solta: o Parar para todas (revisão do #520)", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 300; i++) for (let j = 0; j < 10; j++) files[`Developer/p${i}/q${j}/r/x`] = "";
    const { home, root } = fakeHome(files);
    let walking = 0;
    const counted: typeof findProjects = async (roots, o) => {
      walking++;
      try {
        await findProjects(roots, o);
      } finally {
        walking--;
      }
    };
    const { value } = open(root, { projectsHome: () => home, projectsFinder: counted });
    await Promise.all([value("projects.find", { start: true }), value("projects.find", { start: true })]);
    expect((await value("projects.find", { stop: true })).state).toBe("stopped");
    // Parada, a busca sai na próxima pasta: em 100 ms nenhuma anda mais (a solta levaria a casa inteira).
    for (let i = 0; walking > 0 && i < 20; i++) await new Promise((r) => setTimeout(r, 5));
    expect(walking).toBe(0);
  });

  test("uma pasta da pasta de notas que começa com '..' é de dentro: vai às regras da pasta de notas, e não vira projeto de fora", async () => {
    const { root } = fakeHome({ "Documents/Notas/..algo/a.md": "x" });
    const { value, call } = open(root);
    await value("notes.list");
    expect(await call("projects.mark", { outside: path.join(root, "..algo") })).toMatchObject({ ok: false, code: "E_OUTSIDE_VAULT" });
    expect((await value("projects.list")).projects).toEqual([]);
  });

  test("marcar uma pasta de fora cria o projeto na pasta de notas, com o caminho e o link, sem mexer na de fora", async () => {
    const { home, root } = fakeHome({ "Developer/kiwi/.git/HEAD": "ref", "Developer/kiwi/src/a.ts": "x", "Documents/Notas/kiwi/Outra.md": "já existe" });
    const shown: string[] = [];
    const { value, call } = open(root, { projectsHome: () => home, reveal: (abs) => shown.push(abs) });
    await value("notes.list");
    const outside = path.join(home, "Developer/kiwi");
    const before = treeOf(outside);

    const r = await value("projects.mark", { outside });
    // A pasta "kiwi" já existia na pasta de notas: o projeto vai para "kiwi 2".
    expect(r).toMatchObject({ created: true, project: { name: "kiwi 2", folder: "kiwi 2", main: "kiwi 2/kiwi 2.md", outside } });
    const note = readFileSync(path.join(root, "kiwi 2/kiwi 2.md"), "utf8");
    expect(note).toContain(`\`${outside}\``);
    expect(note).toContain(`[Abrir no Finder](file://${outside}/)`);
    expect(treeOf(outside)).toEqual(before);
    expect(fileOf(root).projects).toEqual([expect.objectContaining({ folder: "kiwi 2", outside })]);

    // De novo: nada muda. A lista diz o caminho de fora.
    expect(await value("projects.mark", { outside: `${outside}/` })).toMatchObject({ created: false, project: { folder: "kiwi 2" } });
    expect((await value("projects.list")).projects).toEqual([expect.objectContaining({ folder: "kiwi 2", outside })]);

    // O link da nota abre a pasta no Finder; outro caminho do Mac, não.
    expect(await value("projects.reveal", { path: `${outside}/` })).toBe(true);
    expect(shown).toEqual([outside]);
    expect(await call("projects.reveal", { path: home })).toMatchObject({ ok: false, code: "E_NOT_FOUND" });

    // Uma pasta de dentro da pasta de notas vira projeto como sempre; a que tem a pasta de notas dentro, não.
    expect(await value("projects.mark", { outside: path.join(root, "kiwi") })).toMatchObject({ project: { folder: "kiwi", main: "kiwi/kiwi.md" } });
    expect(await call("projects.mark", { outside: path.join(home, "Documents") })).toMatchObject({ ok: false, code: "E_NESTED" });
    expect(await call("projects.mark", { outside: path.join(home, "Nada") })).toMatchObject({ ok: false, code: "E_NOT_FOUND" });
    expect(await call("projects.mark", { outside: "Developer/kiwi" })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("projects.mark", { outside, folder: "kiwi" })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });

    // Desmarcar tira o projeto e não apaga nada.
    await value("projects.unmark", { folder: "kiwi 2" });
    expect(existsSync(path.join(root, "kiwi 2/kiwi 2.md"))).toBe(true);
    expect(treeOf(outside)).toEqual(before);
  });

  test("o nome da pasta nova não repete uma que existe, nem só na maiúscula", () => {
    expect(freeFolderName("kiwi", ["Notas", "Kiwi", "kiwi 2"])).toBe("kiwi 3");
    expect(freeFolderName("a/b:c", [])).toBe("a-b-c");
    expect(freeFolderName("...", [])).toBe("Projeto");
  });

  test("Escolher outra pasta: o seletor só no clique, e o cancelar devolve null", async () => {
    const { root } = fakeHome({});
    let picked: string | null = "/x";
    const { value } = open(root, { chooseProjectFolder: async () => picked });
    expect(await value("projects.choose")).toEqual({ path: "/x" });
    picked = null;
    expect(await value("projects.choose")).toEqual({ path: null });
    expect(await open(root).value("projects.choose")).toEqual({ path: null });
  });
});
