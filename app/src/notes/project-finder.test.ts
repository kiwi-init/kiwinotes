import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { tempDir } from "../../test/tmp.ts";
import { type FoundProject, findProjects, isProjectName, searchPlaces } from "./project-finder.ts";

/** Uma árvore de pastas: as que terminam em `/` são pastas; as outras, arquivos vazios. */
function tree(root: string, paths: string[]) {
  for (const p of paths) {
    const abs = path.join(root, p);
    if (p.endsWith("/")) mkdirSync(abs, { recursive: true });
    else {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, "");
    }
  }
}

async function find(root: string, o: { maxDepth?: number; signal?: AbortSignal } = {}) {
  const found: FoundProject[] = [];
  await findProjects([{ label: "Casa", abs: root }], { ...o, onFound: (b) => found.push(...b) });
  return found;
}

const why = (f: FoundProject) => (f.reason.kind === "marker" ? f.reason.marker : f.reason.kind === "inside" ? `dentro de ${f.reason.group}` : f.reason.kind);

describe("a busca das pastas de projeto (spec #12950)", () => {
  test("o nome: project, projeto, proj, sem maiúscula nem acento; projeção não", () => {
    for (const n of ["Projects", "work-projetcs-no", "Projeto Final", "PROJETOS antigos", "meu_proj", "client-project", "Projetos"]) expect(isProjectName(n)).toBe(!n.includes("projetcs"));
    for (const n of ["Projeção", "projetor", "Notas", "improj"]) expect(isProjectName(n)).toBe(false);
  });

  test("acha pelo nome e pela cara, com o motivo; pula o que não abre; a pasta que agrupa mostra as filhas", async () => {
    const home = tempDir("kiwi-finder-");
    tree(home, [
      "Developer/kiwi/.git/",
      "Developer/kiwi/sub/project-x/", // dentro de um projeto: não entra
      "Developer/site/package.json",
      "code/motor/Cargo.toml",
      "code/api/pyproject.toml",
      "code/srv/go.mod",
      "code/App/App.xcodeproj/",
      "Desktop/Projeto Final/notas.txt",
      "Documents/work-projects/Alfa/a.pdf",
      "Documents/work-projects/Beta/b.pdf",
      "Documents/Notas/Plano/Plano.md",
      "Documents/Projeção/x.txt",
      "Documents/a/b/c/projeto-fundo/", // nível 5: além do limite
      "Documents/a/b/projeto-quatro/", // nível 4
      "node_modules/my-project/package.json",
      ".escondida/project/",
      "Library/Projects/",
      "Lixo.app/project/",
    ]);
    const found = await find(home);
    const got = Object.fromEntries(found.map((f) => [f.path, why(f)]));
    expect(got).toEqual({
      "Developer/kiwi": ".git",
      "Developer/site": "package.json",
      "code/motor": "Cargo.toml",
      "code/api": "pyproject.toml",
      "code/srv": "go.mod",
      "code/App": ".xcodeproj",
      "Desktop/Projeto Final": "name",
      "Documents/work-projects/Alfa": "dentro de work-projects",
      "Documents/work-projects/Beta": "dentro de work-projects",
      "Documents/Notas/Plano": "note",
      "Documents/a/b/projeto-quatro": "name",
    });
    expect(found.every((f) => f.root === "Casa" && f.mtimeMs > 0)).toBe(true);
  });

  test("as de cima chegam primeiro, aos poucos, e o Parar para no meio", async () => {
    const home = tempDir("kiwi-finder-");
    tree(home, ["a/proj-1/", "a/b/proj-2/", "a/b/c/proj-3/"]);
    const batches: string[][] = [];
    await findProjects([{ label: "Casa", abs: home }], { onFound: (b) => batches.push(b.map((f) => f.path)) });
    expect(batches).toEqual([["a/proj-1"], ["a/b/proj-2"], ["a/b/c/proj-3"]]);

    const stop = new AbortController();
    const seen: string[] = [];
    await findProjects([{ label: "Casa", abs: home }], { signal: stop.signal, onFound: (b) => (seen.push(...b.map((f) => f.path)), stop.abort()) });
    expect(seen).toEqual(["a/proj-1"]);
  });

  test("uma árvore grande não para o Bun: a busca cede a vez (a meta do #12918)", async () => {
    const home = tempDir("kiwi-finder-");
    const paths: string[] = [];
    for (let i = 0; i < 300; i++) for (let j = 0; j < 10; j++) paths.push(`p${i}/q${j}/r/`);
    tree(home, paths);
    let last = performance.now();
    let worst = 0;
    const timer = setInterval(() => {
      const t = performance.now();
      worst = Math.max(worst, t - last - 5);
      last = t;
    }, 5);
    await find(home);
    clearInterval(timer);
    expect(worst).toBeLessThan(100);
  });

  test("os lugares: a pasta de notas, os comuns e a casa; nenhuma pasta duas vezes, e o lugar negado fica de fora", async () => {
    const home = tempDir("kiwi-finder-");
    tree(home, [
      "Documents/Notas/Plano/Plano.md", // a pasta de notas, dentro de Documents
      "Documents/work-projects/Alfa/",
      "Documents/work-projects/Beta/",
      "Developer/kiwi/.git/",
      "outra/meu-projeto/",
      "Downloads/proj-baixado/",
      "Library/Mobile Documents/com~apple~CloudDocs/Projeto Nuvem/",
      "Desktop/proj-mesa/",
    ]);
    const notes = path.join(home, "Documents/Notas");
    const { roots, exclude } = searchPlaces(home, notes);
    expect(roots.map((r) => r.label)).toEqual(["Notas", "Documents", "Desktop", "Developer", "Projects", "code", "repos", "iCloud Drive", "Pasta pessoal"]);
    // O Desktop negado (o macOS, ou sem leitura): a busca segue e diz que ele ficou de fora.
    chmodSync(path.join(home, "Desktop"), 0o000);
    const found: FoundProject[] = [];
    const denied: string[] = [];
    try {
      await findProjects(roots, { exclude, onFound: (b) => found.push(...b), onDenied: (r) => denied.push(r.label) });
    } finally {
      chmodSync(path.join(home, "Desktop"), 0o755);
    }
    expect(found.map((f) => `${f.root}:${f.path}`)).toEqual([
      "Notas:Plano",
      "Documents:work-projects/Alfa",
      "Documents:work-projects/Beta",
      "Developer:kiwi",
      "iCloud Drive:Projeto Nuvem",
      "Pasta pessoal:outra/meu-projeto",
    ]);
    expect(denied).toEqual(["Desktop"]);
    expect(searchPlaces(null, notes).roots.map((r) => r.label)).toEqual(["Notas"]);
  });
});
