import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { cleanLaunchServices, type Disco, type LsRegister, registeredPaths, staleRegistrations } from "./launch-services.ts";
import { tempDir } from "../../test/tmp.ts";

const ID = "app.kiwinotes.desktop";
const APP = "/Applications/Kiwi Notes.app";

/** Um registro no formato do `lsregister -dump Bundle` (macOS 26), só com as linhas que importam e algumas em volta. */
const registro = (p: string, id: string, n: number) =>
  [
    "--------------------------------------------------------------------------------",
    `bundle id:                  Kiwi Notes (0x${(0x1e00 + n).toString(16)})`,
    "container:                  / (0x4)",
    "mount state:                mounted",
    `path:                       ${p} (0x${(0x1e5c + n).toString(16)})`,
    `directory:                  ${path.dirname(p)}`,
    "name:                       Kiwi Notes",
    "teamID:                     57249C654W",
    `identifier:                 ${id}`,
    "version:                    0.1 ({length = 32, bytes = 0x00000000 00000000 01000000 00000000 ... })",
    `codeInfoID:                 ${id}`,
    `                                CFBundleIdentifier = "${id}";`,
  ].join("\n");

/** Um LaunchServices falso: o dump sai dos registros que ele tem, e o -u e o -f mudam esses registros. */
class LsFalso implements LsRegister {
  chamadas: string[] = [];
  constructor(public registros: { path: string; id: string }[]) {}
  async dump() {
    this.chamadas.push("-dump Bundle");
    return `${this.registros.map((r, i) => registro(r.path, r.id, i)).join("\n")}\n`;
  }
  async unregister(p: string) {
    this.chamadas.push(`-u ${p}`);
    this.registros = this.registros.filter((r) => r.path !== p);
    return true;
  }
  async register(p: string) {
    this.chamadas.push(`-f ${p}`);
    if (!this.registros.some((r) => r.path === p)) this.registros.push({ path: p, id: ID });
    return true;
  }
  kiwi() {
    return this.registros.filter((r) => r.id === ID).map((r) => r.path);
  }
}

/** Um disco falso: `existe` diz o que existe; olhar onde o TCC protege é erro (revisão do #117). */
const disco = (existe: (p: string) => boolean = () => true, montados: string[] = []): Disco => ({
  exists: (p) => {
    if (/^\/Users\/[^/]+\/(Documents|Desktop|Downloads|Library\/Mobile Documents)\//.test(p)) throw new Error(`olhou numa pasta protegida: ${p}`);
    return existe(p);
  },
  volumes: () => montados,
});

const dirs: string[] = [];
const marca = () => {
  const d = tempDir("ls-");
  dirs.push(d);
  return path.join(d, "launch-services.json");
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("ler o dump (T3292)", () => {
  test("os caminhos do bundle id, com espaço no nome e sem o (0x…)", () => {
    const dump = [registro(APP, ID, 0), registro("/Applications/Safari.app", "com.apple.Safari", 1), registro("/Volumes/Kiwi Notes 2/Kiwi Notes.app", ID, 2)].join("\n");
    expect(registeredPaths(dump, ID)).toEqual([APP, "/Volumes/Kiwi Notes 2/Kiwi Notes.app"]);
    expect(registeredPaths(dump, "app.outro")).toEqual([]);
  });

  test("um id que só começa igual não conta", () => {
    expect(registeredPaths(registro("/x/Kiwi.app", `${ID}.helper`, 0), ID)).toEqual([]);
  });

  test("os que saem: os que sumiram em /Applications e nos temporários, nunca o que está rodando", () => {
    const troca = "/Applications/Kiwi Notes.app.update-3f9a1c/Kiwi Notes.app";
    const tmp = "/private/tmp/x/build/Kiwi Notes.app";
    expect(staleRegistrations([APP, troca, tmp], APP, disco(() => false))).toEqual([troca, tmp]);
    expect(staleRegistrations([APP, troca], APP, disco(() => true))).toEqual([]);
  });

  test("/Volumes: sai o dmg que não está mais montado, sem olhar dentro do que está", () => {
    const ejetado = "/Volumes/Kiwi Notes 0.1.0-rc3/Kiwi Notes.app";
    const montado = "/Volumes/Kiwi Notes/Kiwi Notes.app";
    const d = disco(() => {
      throw new Error("não devia olhar dentro de um volume");
    }, ["Macintosh HD", "Kiwi Notes"]);
    expect(staleRegistrations([APP, ejetado, montado], APP, { ...d, exists: (p) => p === APP })).toEqual([ejetado]);
  });

  test("Documentos, Mesa, Downloads e iCloud ficam, e ninguém olha lá (o pedido de acesso do macOS, revisão do #117)", () => {
    const protegidos = [
      "/Users/harry/Documents/personal-projects/code-projects/kiwinotes-wt/T3065/app/build/dev-macos-arm64/Kiwi Notes-dev.app",
      "/Users/harry/Desktop/Kiwi Notes.app",
      "/Users/harry/Downloads/Kiwi Notes.app",
      "/Users/harry/Library/Mobile Documents/com~apple~CloudDocs/Kiwi Notes.app",
      "/Network/Servers/x/Kiwi Notes.app",
    ];
    // O `exists` do disco falso lança erro se for chamado com um desses: o teste passa só se ninguém olhar.
    expect(staleRegistrations([APP, ...protegidos], APP, disco(() => false))).toEqual([]);
  });
});

describe("a limpeza na abertura (T3292)", () => {
  test("depois de um update simulado, só sobra o registro de /Applications/Kiwi Notes.app", async () => {
    // O que o Mac do harry tinha (#3283): as pastas de troca do update manager, o dmg montado e um build velho.
    const ls = new LsFalso([
      { path: APP, id: ID },
      { path: "/Applications/Kiwi Notes.app.update-3f9a1c/Kiwi Notes.app", id: ID },
      { path: "/Applications/Kiwi Notes.app.update-77b2e0/Kiwi Notes.app", id: ID },
      { path: "/Volumes/Kiwi Notes/Kiwi Notes.app", id: ID },
      { path: "/private/tmp/scratch/build/Kiwi Notes.app", id: ID },
      { path: "/Applications/Safari.app", id: "com.apple.Safari" },
    ]);
    const r = await cleanLaunchServices({ bundleId: ID, version: "0.1.0-rc7", bundle: APP, markerPath: marca(), ls, disco: disco((p) => p === APP || p.endsWith("Safari.app")) });
    expect(r.state).toBe("done");
    expect(ls.kiwi()).toEqual([APP]);
    // O app que está rodando é registrado de novo, e o dos outros não é tocado.
    expect(ls.chamadas.at(-1)).toBe(`-f ${APP}`);
    expect(ls.registros.some((x) => x.path === "/Applications/Safari.app")).toBe(true);
    if (r.state === "done") expect(r.removed.length).toBe(4);
  });

  test("um caminho que ainda existe (outro build, um dmg montado) fica", async () => {
    const ls = new LsFalso([
      { path: APP, id: ID },
      { path: "/Volumes/Kiwi Notes/Kiwi Notes.app", id: ID },
    ]);
    const r = await cleanLaunchServices({ bundleId: ID, version: "1", bundle: APP, markerPath: marca(), ls, disco: disco(() => true, ["Kiwi Notes"]) });
    expect(ls.kiwi()).toEqual([APP, "/Volumes/Kiwi Notes/Kiwi Notes.app"]);
    expect(r).toMatchObject({ state: "done", removed: [], kept: [APP, "/Volumes/Kiwi Notes/Kiwi Notes.app"] });
  });

  test("uma vez por versão: a segunda abertura da mesma versão não roda o dump", async () => {
    const m = marca();
    const ls = new LsFalso([{ path: APP, id: ID }]);
    await cleanLaunchServices({ bundleId: ID, version: "0.1.0-rc7", bundle: APP, markerPath: m, ls, disco: disco() });
    expect(JSON.parse(readFileSync(m, "utf8")).version).toBe("0.1.0-rc7");
    ls.chamadas = [];
    expect(await cleanLaunchServices({ bundleId: ID, version: "0.1.0-rc7", bundle: APP, markerPath: m, ls })).toMatchObject({ state: "skipped" });
    expect(ls.chamadas).toEqual([]);
    // A versão seguinte limpa de novo.
    await cleanLaunchServices({ bundleId: ID, version: "0.1.0-rc8", bundle: APP, markerPath: m, ls, disco: disco() });
    expect(ls.chamadas[0]).toBe("-dump Bundle");
  });

  test("dump que falha não grava a marca: a próxima abertura tenta de novo", async () => {
    const m = marca();
    const ls = new LsFalso([]);
    ls.dump = async () => {
      throw new Error("timeout");
    };
    expect(await cleanLaunchServices({ bundleId: ID, version: "1", bundle: APP, markerPath: m, ls })).toEqual({ state: "skipped", reason: "lsregister -dump failed: timeout" });
    expect(() => readFileSync(m)).toThrow();
  });

  test("fora de um .app empacotado (o bun do dev) não faz nada", async () => {
    const ls = new LsFalso([{ path: "/sumiu/Kiwi Notes.app", id: ID }]);
    expect(await cleanLaunchServices({ bundleId: ID, version: "1", bundle: null, markerPath: marca(), ls })).toMatchObject({ state: "skipped" });
    expect(ls.chamadas).toEqual([]);
  });

  test("um -u que falha fica em failed, e a limpeza segue", async () => {
    const ls = new LsFalso([
      { path: APP, id: ID },
      { path: "/Applications/Kiwi Notes.app.update-a/Kiwi Notes.app", id: ID },
      { path: "/Applications/Kiwi Notes.app.update-b/Kiwi Notes.app", id: ID },
    ]);
    const u = ls.unregister.bind(ls);
    ls.unregister = async (p) => (p.includes(".update-a/") ? false : u(p));
    const r = await cleanLaunchServices({ bundleId: ID, version: "1", bundle: APP, markerPath: marca(), ls, disco: disco((p) => p === APP) });
    expect(r).toMatchObject({ state: "done", removed: ["/Applications/Kiwi Notes.app.update-b/Kiwi Notes.app"], failed: ["/Applications/Kiwi Notes.app.update-a/Kiwi Notes.app"] });
  });
});
