// A busca das pastas de projeto do onboarding (spec #12950, T13200). Hoje o passo 6 só lista o primeiro nível da pasta
// de notas; esta busca anda por baixo de cada lugar dado (até `maxDepth` níveis) e acha as pastas que são projeto:
// - pelo nome: project, projects, projeto, projetos ou proj, sem diferenciar maiúscula nem acento;
// - ou pela cara: um `.git`, um `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, um `*.xcodeproj`, ou a nota
//   de projeto do Kiwi (a nota com o nome da pasta, `Pasta/Pasta.md`).
// Uma pasta "projects" que só agrupa outras não entra: as filhas dela entram, com o motivo "dentro de …". Uma pasta que
// já é projeto não é aberta de novo (um projeto não fica dentro de outro).
//
// Só lê nomes e a existência de arquivos (`readdir`) e a data da pasta (`stat`): nada do conteúdo. Roda no processo do
// Bun, mas em passos curtos: cada pasta é um `await`, e a cada tanto ela cede a vez, então as respostas da tela não
// esperam a busca (a meta do #12918). Pula as ocultas, `node_modules`, `Library`, caches, saídas de build e os apps.

import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { fold } from "../store/text.ts";

/** Por que a pasta é um projeto: o que a tela mostra ao lado dela. */
export type ProjectReason =
  | { kind: "name" }
  | { kind: "marker"; marker: string }
  | { kind: "note" }
  | { kind: "inside"; group: string };

export interface FoundProject {
  /** O lugar onde a busca começou (o rótulo que o chamador deu: "Notas", "Documents"…). */
  root: string;
  /** O caminho da pasta, a partir do lugar (`a/b/c`). */
  path: string;
  /** O caminho absoluto. */
  abs: string;
  name: string;
  reason: ProjectReason;
  /** Quando a pasta mudou por último (ms), para a lista ir do mais recente ao mais antigo. */
  mtimeMs: number;
}

export interface FinderRoot {
  label: string;
  abs: string;
}

export interface FinderOptions {
  /** Quantos níveis abaixo de cada lugar (o lugar é o nível 0). */
  maxDepth?: number;
  /** Para a busca no meio (o botão "Parar"). */
  signal?: AbortSignal;
  /** As pastas achadas, aos poucos. */
  onFound(batch: FoundProject[]): void;
  /** Ceder a vez a cada tantas pastas lidas. */
  yieldEvery?: number;
  /** Ler uma pasta (nos testes, de mentira). */
  readDir?(abs: string): Promise<Dirent[]>;
  /** As pastas que a busca não abre, em caminho absoluto (os outros lugares, que já têm a vez deles). */
  exclude?: ReadonlySet<string>;
  /** Um lugar que existe mas não abriu (o macOS negou, ou sem permissão de leitura): a tela diz que ficou de fora. */
  onDenied?(root: FinderRoot): void;
}

/** Os lugares comuns, na ordem em que a busca passa: primeiro onde costuma haver projeto. */
export const COMMON_PLACES: readonly FinderRoot[] = [
  { label: "Documents", abs: "Documents" },
  { label: "Desktop", abs: "Desktop" },
  { label: "Developer", abs: "Developer" },
  { label: "Projects", abs: "Projects" },
  { label: "code", abs: "code" },
  { label: "repos", abs: "repos" },
  { label: "iCloud Drive", abs: "Library/Mobile Documents/com~apple~CloudDocs" },
];

/** O resto da pasta pessoal que a busca não abre: as de mídia e o Downloads (também pedem a permissão do macOS). */
const HOME_SKIP = ["Downloads", "Movies", "Music", "Pictures", "Public"];

/**
 * Os lugares da busca (spec #12950): a pasta de notas, os lugares comuns e, por último, a pasta pessoal. Cada lugar
 * fica de fora dos outros (`exclude`), para nenhuma pasta aparecer duas vezes.
 */
export function searchPlaces(home: string | null, notesRoot: string): { roots: FinderRoot[]; exclude: Set<string> } {
  const roots: FinderRoot[] = [{ label: "Notas", abs: notesRoot }];
  if (home) {
    for (const p of COMMON_PLACES) roots.push({ label: p.label, abs: path.join(home, p.abs) });
    roots.push({ label: "Pasta pessoal", abs: home });
  }
  const exclude = new Set(roots.map((r) => r.abs));
  if (home) for (const n of HOME_SKIP) exclude.add(path.join(home, n));
  return { roots, exclude };
}

/** Os nomes que dizem "projeto" (spec #12950). `proj` só como palavra inteira: "projeção" não é. */
const NAME = /(^|[^a-z])(projects?|projetos?|proj)([^a-z]|$)/;

export const isProjectName = (name: string) => NAME.test(fold(name));

/** Os arquivos (ou pastas) que dão cara de projeto, na ordem em que o motivo aparece. */
const MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod"] as const;

/** As pastas que a busca não abre. */
const SKIP = new Set(["node_modules", "Library", "Applications", "Caches", "cache", "__pycache__", "build", "dist", "target", "DerivedData", "Pods", "venv", "vendor", "Trash"]);

const skipped = (name: string) => name.startsWith(".") || SKIP.has(name) || /\.(app|photoslibrary|bundle|framework)$/i.test(name);

/** O que conta como projeto numa pasta, pelos nomes de dentro. */
export function reasonOf(name: string, entries: readonly Pick<Dirent, "name" | "isDirectory">[]): ProjectReason | null {
  const names = new Set(entries.map((e) => e.name));
  for (const m of MARKERS) if (names.has(m)) return { kind: "marker", marker: m };
  const xcode = entries.find((e) => e.name.endsWith(".xcodeproj"));
  if (xcode) return { kind: "marker", marker: ".xcodeproj" };
  if (names.has(`${name}.md`)) return { kind: "note" };
  if (isProjectName(name)) return { kind: "name" };
  return null;
}

/** Uma pasta que só agrupa outras: o nome diz projeto, não tem sinal próprio e tem ao menos duas pastas dentro. */
const isGroup = (reason: ProjectReason, dirs: number) => reason.kind === "name" && dirs >= 2;

/** Anda pelos lugares e manda as pastas de projeto aos poucos. Termina ao fim, ou quando o `signal` para. */
export async function findProjects(roots: readonly FinderRoot[], o: FinderOptions): Promise<void> {
  const maxDepth = o.maxDepth ?? 4;
  const yieldEvery = o.yieldEvery ?? 32;
  const read = o.readDir ?? ((abs: string) => readdir(abs, { withFileTypes: true }));
  let reads = 0;
  const pause = async () => {
    if (++reads % yieldEvery === 0) await new Promise((r) => setImmediate(r));
  };
  const mtime = async (abs: string) => (await stat(abs).catch(() => null))?.mtimeMs ?? 0;
  const exclude = o.exclude ?? new Set<string>();

  for (const root of roots) {
    if (o.signal?.aborted) return;
    // O lugar que não abriu: o que não existe não conta; o que o macOS ou a permissão negou, a tela mostra.
    let first: Dirent[];
    try {
      await pause();
      first = await read(root.abs);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") o.onDenied?.(root);
      continue;
    }
    // Em largura: as pastas de cima aparecem primeiro.
    let level: { rel: string; abs: string; group?: string }[] = [{ rel: "", abs: root.abs }];
    for (let depth = 0; depth <= maxDepth && level.length; depth++) {
      const next: typeof level = [];
      const batch: FoundProject[] = [];
      for (const dir of level) {
        if (o.signal?.aborted) return;
        let entries: Dirent[] | null = first;
        if (dir.rel) {
          await pause();
          entries = await read(dir.abs).catch(() => null);
        }
        if (!entries) continue;
        // Em ordem de nome: o `readdir` não promete ordem, e a lista sai igual a cada busca.
        const dirs = entries.filter((e) => e.isDirectory() && !skipped(e.name)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        const name = dir.rel ? path.basename(dir.rel) : "";
        // A raiz não é projeto; o que ela tem dentro, sim.
        const own = dir.rel ? reasonOf(name, entries) : null;
        const reason: ProjectReason | null = dir.group && !own ? { kind: "inside", group: dir.group } : own;
        if (reason && !isGroup(reason, dirs.length)) {
          batch.push({ root: root.label, path: dir.rel, abs: dir.abs, name, reason, mtimeMs: await mtime(dir.abs) });
          continue; // um projeto não fica dentro de outro
        }
        const group = reason ? name : undefined;
        for (const d of dirs) {
          const abs = path.join(dir.abs, d.name);
          if (exclude.has(abs) && abs !== root.abs) continue;
          next.push({ rel: dir.rel ? `${dir.rel}/${d.name}` : d.name, abs, ...(group ? { group } : {}) });
        }
      }
      if (batch.length && !o.signal?.aborted) o.onFound(batch);
      level = next;
    }
  }
}
