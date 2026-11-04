// Os registros velhos do Kiwi no LaunchServices (T3292, #3283): o Spotlight e o Raycast não achavam o app.
//
// Cada atualização deixava um registro do bundle id em `/Applications/Kiwi Notes.app.update-<hash>/Kiwi Notes.app`,
// a pasta de troca do update manager nativo do Electrobun, que some depois da troca. Os dmg montados e os builds
// antigos deixavam outros. O Mac do harry tinha 11, todos com o mesmo id. O Spotlight e o Raycast escolhem um registro
// por bundle id e às vezes pegavam um caminho que não existe mais.
//
// A pasta de troca nasce no update manager nativo (um binário do fork, que recebe só o plano com o `app_bundle_path`),
// então não dá para mudar onde ela fica. O conserto é do nosso lado: na primeira abertura de cada versão, que é
// justamente a abertura depois de um update, tira do LaunchServices todo caminho do próprio bundle id que não existe
// mais, e registra de novo o app que está rodando. Quem já tem o lixo se conserta na próxima versão que abrir.
//
// O `lsregister -dump Bundle` leva uns 2,5 s de CPU (11 MB de texto), então roda uma vez por versão, com `nice`, um
// pouco depois da abertura. Só lê e desregistra: nada na tela, nenhum diálogo.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

/** O que a limpeza precisa do `lsregister`: os testes passam um falso. */
export interface LsRegister {
  /** O `lsregister -dump Bundle`. */
  dump(): Promise<string>;
  /** `lsregister -u <path>`: true se deu certo. */
  unregister(p: string): Promise<boolean>;
  /** `lsregister -f <path>`: true se deu certo. */
  register(p: string): Promise<boolean>;
}

/**
 * Os caminhos registrados para `bundleId`, lidos do `lsregister -dump`. Cada registro vem entre linhas de traços, com
 * `path:  /Applications/Kiwi Notes.app (0x1e5c)` e `identifier:  app.kiwinotes.desktop`.
 */
export function registeredPaths(dump: string, bundleId: string): string[] {
  const out: string[] = [];
  for (const record of dump.split(/^-{20,}\s*$/m)) {
    const id = /^identifier:[ \t]+(\S+)[ \t]*$/m.exec(record)?.[1];
    if (id !== bundleId) continue;
    const p = /^path:[ \t]+(.+?)(?:[ \t]+\(0x[0-9a-fA-F]+\))?[ \t]*$/m.exec(record)?.[1];
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Onde dá para olhar o disco sem o TCC pedir nada: a pasta de troca do update (em /Applications) e os temporários. */
const SEM_TCC = ["/Applications/", "/private/tmp/", "/tmp/", "/private/var/folders/", "/var/folders/"];

export interface Disco {
  /** Só é chamado para caminhos de `SEM_TCC`. */
  exists: (p: string) => boolean;
  /** Os nomes montados em /Volumes (listar /Volumes não pede permissão). */
  volumes: () => string[];
}

const discoReal: Disco = {
  exists: existsSync,
  volumes: () => {
    try {
      return readdirSync("/Volumes");
    } catch {
      return [];
    }
  },
};

/**
 * Os que saem: os caminhos que sumiram, decididos **pelo lugar, sem olhar onde o TCC protege** (revisão do #117).
 * Todo build usa o mesmo bundle id, e os dos agentes ficam em `~/Documents/…`. O Spotlight registra esses `.app` no
 * LaunchServices, e um `stat` do app instalado num caminho de Documentos, Mesa, Downloads, iCloud ou num volume pode
 * abrir o pedido de acesso do macOS na tela da pessoa. Por isso:
 * - em `/Applications` e nos temporários, o `stat` decide (é ali que ficam as pastas de troca, a causa principal);
 * - em `/Volumes/<nome>/…`, sai só se `<nome>` não está mais montado (o dmg que já foi ejetado), sem olhar dentro;
 * - o resto fica como está. O `-f` do app que está rodando já o põe na frente dos outros.
 * O app que está rodando nunca sai.
 */
export function staleRegistrations(paths: readonly string[], running: string, disco: Disco = discoReal): string[] {
  const atual = path.resolve(running);
  let montados: Set<string> | null = null;
  return paths.filter((p) => {
    const abs = path.resolve(p);
    if (abs === atual) return false;
    if (SEM_TCC.some((raiz) => abs.startsWith(raiz))) return !disco.exists(abs);
    const vol = /^\/Volumes\/([^/]+)\//.exec(abs)?.[1];
    if (vol) return !(montados ??= new Set(disco.volumes())).has(vol);
    return false;
  });
}

export type CleanResult =
  | { state: "skipped"; reason: string }
  | { state: "done"; removed: string[]; failed: string[]; kept: string[] };

interface Marca {
  version: string;
  cleanedAt: string;
  removed: string[];
}

/**
 * A limpeza da abertura. Roda uma vez por versão: a marca (`markerPath`) guarda a versão já limpa. Se o dump falhar,
 * a marca não é gravada, e a próxima abertura tenta de novo.
 */
export async function cleanLaunchServices(o: {
  bundleId: string;
  version: string;
  /** O .app que está rodando (`runningBundle`); null fora de um .app empacotado. */
  bundle: string | null;
  markerPath: string;
  ls: LsRegister;
  disco?: Disco;
  now?: Date;
}): Promise<CleanResult> {
  if (!o.bundle) return { state: "skipped", reason: "not a packaged .app" };
  if (!o.bundleId || !o.version) return { state: "skipped", reason: "no bundle id or version" };
  const marca = lerMarca(o.markerPath);
  if (marca?.version === o.version) return { state: "skipped", reason: `already cleaned for ${o.version}` };

  let dump: string;
  try {
    dump = await o.ls.dump();
  } catch (e) {
    return { state: "skipped", reason: `lsregister -dump failed: ${(e as Error).message}` };
  }
  const paths = registeredPaths(dump, o.bundleId);
  const stale = staleRegistrations(paths, o.bundle, o.disco);
  const removed: string[] = [];
  const failed: string[] = [];
  for (const p of stale) ((await o.ls.unregister(p)) ? removed : failed).push(p);
  // Um -u que falhou não segura a marca, de propósito: ele volta a ser tentado na próxima versão, e não a cada
  // abertura (o dump custa ~2,5 s). Ele fica no `failed` e no log.
  // O app que está rodando, registrado de novo: ele passa a ser o registro de que o Spotlight e o Raycast lembram.
  await o.ls.register(o.bundle);

  mkdirSync(path.dirname(o.markerPath), { recursive: true });
  const nova: Marca = { version: o.version, cleanedAt: (o.now ?? new Date()).toISOString(), removed };
  writeFileSync(o.markerPath, `${JSON.stringify(nova, null, 2)}\n`);
  return { state: "done", removed, failed, kept: paths.filter((p) => !stale.includes(p)) };
}

function lerMarca(p: string): Marca | null {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Marca;
  } catch {
    return null;
  }
}

/** O `lsregister` de verdade, com `nice` (o dump pesa) e um tempo máximo para cada chamada. */
export function realLsRegister(bin = LSREGISTER, timeoutMs = 60_000): LsRegister {
  const run = async (args: string[]): Promise<{ ok: boolean; out: string }> => {
    const p = Bun.spawn(["/usr/bin/nice", "-n", "10", bin, ...args], { stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => p.kill(), timeoutMs);
    try {
      const out = await new Response(p.stdout).text();
      return { ok: (await p.exited) === 0, out };
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    async dump() {
      const r = await run(["-dump", "Bundle"]);
      if (!r.ok || !r.out) throw new Error("no output");
      return r.out;
    },
    unregister: async (p) => (await run(["-u", p])).ok,
    register: async (p) => (await run(["-f", p])).ok,
  };
}
