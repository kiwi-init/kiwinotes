// Os projetos (spec #9874): uma pasta do cofre que a pessoa marcou, mais uma nota principal dentro dela. A marcação
// fica num arquivo oculto dentro do próprio cofre (`.kiwi/projects.json`), então mover, copiar ou sincronizar o cofre
// leva os projetos junto, e nenhuma nota muda. O vault ignora tudo que começa com ponto, então o arquivo nunca vira
// nota.
//
// O projeto acompanha a pasta como as fixadas (T2559, T2468): pelo app, o mesmo mapa de caminhos do `followMove`; por
// fora, as mudanças que o watcher reconhece pelo inode. Com o app fechado, quem acha o projeto de novo é a nota
// principal, pelo inode guardado (`mainIno`).
//
// Nada aqui interpreta: o `projectStatus` só junta e conta o que está nas notas.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import { markdownStructure } from "../shared/markdown-structure.ts";
import type { ExternalMoves, NoteMeta } from "./vault.ts";
import { writeDurable } from "./vault.ts";

/** Onde a marcação fica, a partir da raiz do cofre. */
export const PROJECTS_DIR = ".kiwi";
export const PROJECTS_FILE = "projects.json";
/** O máximo de projetos num cofre. */
export const PROJECTS_MAX = 200;
/** No `projectStatus`: as notas mudadas por último, o teto do sumário e o de notas com tarefas abertas. */
export const STATUS_RECENT = 10;
export const STATUS_OUTLINE_MAX = 300;
export const STATUS_TASK_NOTES_MAX = 200;

/** Um projeto como fica no arquivo. `main` null: a nota principal foi apagada e a pessoa ainda não escolheu outra. */
export interface ProjectEntry {
  folder: string;
  main: string | null;
  /** O inode da nota principal: acha o projeto de novo quando a pasta mudou com o app fechado. */
  mainIno?: number;
  /**
   * O inode da própria pasta (revisão da T10012): um rename de pasta o mantém, e é só com ele que o projeto segue a
   * pasta mudada por fora. Uma pasta que já existia (as notas arrastadas para outra, e a do projeto apagada) tem outro.
   */
  folderIno?: number;
}

/** Um projeto como as capacidades devolvem. */
export interface ProjectInfo {
  /** O nome da pasta. */
  name: string;
  folder: string;
  main: string | null;
  /** A hora da última mudança numa nota da pasta (a do arquivo), ou null numa pasta sem notas. */
  updated: string | null;
  /** Quantas notas há na pasta, contando as subpastas. */
  notes: number;
}

export interface ProjectStatus {
  project: ProjectInfo;
  /** O sumário da nota principal: os títulos, até `STATUS_OUTLINE_MAX`. */
  outline: { level: number; title: string }[];
  /** Quantos títulos a nota principal tem ao todo. */
  outlineTotal: number;
  /** As notas mudadas por último, da mais nova para a mais velha. */
  recent: { path: string; title: string; mtime: string }[];
  /** As notas com caixas de tarefa abertas, até `STATUS_TASK_NOTES_MAX`, da que tem mais para a que tem menos. */
  tasks: { path: string; open: number }[];
  /** Quantas notas da pasta têm caixas abertas, e quantas caixas abertas há ao todo. */
  taskNotes: number;
  openTasks: number;
}

export class ProjectError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const under = (folder: string, p: string) => p === folder || p.startsWith(`${folder}/`);
const baseName = (folder: string) => folder.slice(folder.lastIndexOf("/") + 1);
const noteBase = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** A nota principal que um projeto novo ganha: a nota com o nome da pasta, dentro dela. */
export function mainNoteFor(folder: string): string {
  return `${folder}/${baseName(folder)}.md`;
}

/** Quantas caixas de tarefa abertas (`- [ ]`) a nota tem, pela estrutura: uma dentro de código ou comentário não conta. */
export function openTasks(content: string): number {
  const { tree, prose } = markdownStructure(content);
  let open = 0;
  tree.iterate({
    enter(node) {
      if (node.name !== "TaskMarker" || !prose(node.from)) return;
      if (/^\[ \]$/.test(content.slice(node.from, node.to))) open++;
    },
  });
  return open;
}

/** Os projetos depois de uma mudança feita pelo app: `map` diz para onde foi cada caminho (null: saiu). */
export function mapProjects(list: readonly ProjectEntry[], map: (p: string) => string | null): ProjectEntry[] {
  const out: ProjectEntry[] = [];
  for (const e of list) {
    const folder = map(e.folder);
    if (folder === null || out.some((o) => o.folder === folder)) continue;
    let main = e.main === null ? null : map(e.main);
    // A nota principal que saiu da pasta (movida para outra) deixa o projeto sem ela, como a apagada.
    if (main !== null && !under(folder, main)) main = null;
    out.push(entry(folder, main, main === null ? undefined : e.mainIno, e.folderIno));
  }
  return out;
}

/** Uma entrada, sem os campos vazios (o arquivo fica igual quando nada mudou). */
function entry(folder: string, main: string | null, mainIno: number | undefined, folderIno: number | undefined): ProjectEntry {
  return {
    folder,
    main,
    ...(main !== null && mainIno !== undefined ? { mainIno } : {}),
    ...(folderIno !== undefined ? { folderIno } : {}),
  };
}

/**
 * Confere se a lista respeita as regras: nenhum projeto dentro de outro, nem na pasta das reuniões. Devolve o 1º
 * problema, ou null.
 */
export function layoutProblem(list: readonly ProjectEntry[], meetingsFolder: string | null): ProjectError | null {
  for (const e of list) {
    if (meetingsFolder && under(meetingsFolder, e.folder))
      return new ProjectError("E_MEETINGS_FOLDER", `o projeto ${e.folder} ficaria na pasta das reuniões (${meetingsFolder})`);
    const outer = list.find((o) => o !== e && under(o.folder, e.folder));
    if (outer) return new ProjectError("E_NESTED", `o projeto ${e.folder} ficaria dentro do projeto ${outer.folder}`);
  }
  return null;
}

/**
 * Os projetos depois de uma mudança feita por fora (Finder, Obsidian):
 * - a pasta que sumiu vai para a pasta nova que tem o **mesmo inode** dela (um rename de pasta o mantém); para achar a
 *   candidata, a nota principal que mudou de lugar (ou, sem ela, as outras notas), pelo mesmo resto de caminho. Notas
 *   arrastadas para uma pasta que já existia não levam o projeto: o inode é outro, e a pasta do projeto foi apagada;
 * - sem o inode da pasta (um projeto anterior a ele), só segue se todas as notas que saíram foram para a mesma pasta
 *   nova, e ela só tem essas notas;
 * - a pasta de destino passa pelas regras (`layoutProblem`): dentro de outro projeto, ou na pasta das reuniões, o
 *   projeto sai;
 * - a nota principal que sumiu de vez deixa o projeto sem ela; a pasta que sumiu de vez leva o projeto embora.
 *
 * `inodes` é o inode de cada nota de agora, e `dirIno` o de uma pasta: com eles, o projeto acha a pasta mesmo sem o
 * `moves` (o app estava fechado quando a pasta mudou).
 */
export function followProjects(
  list: readonly ProjectEntry[],
  r: ExternalMoves,
  now: { notes: ReadonlySet<string>; folders: ReadonlySet<string> },
  inodes: ReadonlyMap<string, number> = new Map(),
  dirIno: (folder: string) => number | undefined = () => undefined,
  meetingsFolder: string | null = null,
): ProjectEntry[] {
  const byIno = new Map<number, string>();
  for (const [p, ino] of inodes) byIno.set(ino, p);
  const out: ProjectEntry[] = [];
  for (const e of list) {
    let folder: string | null = e.folder;
    let main = e.main;
    // A nota principal: a que o watcher viu mudar de lugar, a que ainda está lá ou a do mesmo inode.
    let movedMain = main !== null ? (r.moves.get(main) ?? null) : null;
    if (main !== null && movedMain === null && !now.notes.has(main) && e.mainIno !== undefined) {
      const found = byIno.get(e.mainIno);
      // Pelo inode, só a mesma nota: dentro da pasta (renomeada com o app fechado) ou com o mesmo nome (a pasta mudou).
      if (found && (under(e.folder, found) || noteBase(found) === noteBase(main))) movedMain = found;
    }
    if (!now.folders.has(e.folder)) {
      folder = null;
      const follow = (from: string, to: string) => {
        const rest = from.slice(e.folder.length);
        return to.endsWith(rest) && to.length > rest.length ? to.slice(0, to.length - rest.length) : null;
      };
      const candidates = new Set<string>();
      if (main !== null && movedMain !== null) {
        const c = follow(main, movedMain);
        if (c !== null) candidates.add(c);
      }
      const leaving = [...r.moves].filter(([from]) => from.startsWith(`${e.folder}/`));
      for (const [from, to] of leaving) {
        const c = follow(from, to);
        if (c !== null) candidates.add(c);
      }
      for (const c of candidates) {
        if (!now.folders.has(c)) continue;
        if (e.folderIno !== undefined) {
          if (dirIno(c) === e.folderIno) folder = c;
        } else {
          // Sem o inode: todas as notas que saíram foram para `c`, e `c` só tem as que vieram de lá.
          const all = leaving.length > 0 && leaving.every(([from, to]) => follow(from, to) === c);
          const came = new Set(leaving.map(([, to]) => to));
          if (all && [...now.notes].every((n) => !under(c, n) || came.has(n))) folder = c;
        }
        if (folder !== null) break;
      }
    }
    if (folder === null || out.some((o) => o.folder === folder)) continue;
    if (main !== null) main = movedMain ?? (now.notes.has(main) ? main : null);
    if (main !== null && !under(folder, main)) main = null;
    const next = entry(folder, main, main === null ? undefined : inodes.get(main), dirIno(folder) ?? e.folderIno);
    // A pasta de destino passa pelas regras: dentro de outro projeto, ou na pasta das reuniões, o projeto sai.
    const others = [...out, ...list.filter((x) => x !== e && x.folder !== e.folder && now.folders.has(x.folder))];
    if (folder !== e.folder && layoutProblem([...others, next], meetingsFolder)) continue;
    out.push(next);
  }
  return out;
}

/** O projeto com o nome, a data da última mudança e quantas notas tem, a partir da lista de notas do cofre. */
export function projectInfo(e: ProjectEntry, notes: readonly NoteMeta[]): ProjectInfo {
  let updated: string | null = null;
  let count = 0;
  for (const n of notes) {
    if (!under(e.folder, n.path)) continue;
    count++;
    if (updated === null || n.mtime > updated) updated = n.mtime;
  }
  return { name: baseName(e.folder), folder: e.folder, main: e.main, updated, notes: count };
}

/**
 * O estado de um projeto, sem interpretar nada: o sumário da nota principal, as notas mudadas por último e as caixas
 * de tarefa abertas de cada nota da pasta. As datas são a hora do arquivo (uma cópia ou um sync mexe nelas).
 */
export async function projectStatus(
  e: ProjectEntry,
  notes: readonly NoteMeta[],
  read: (path: string) => Promise<string>,
): Promise<ProjectStatus> {
  const inside = notes.filter((n) => under(e.folder, n.path));
  const recent = [...inside]
    .sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : a.path.localeCompare(b.path)))
    .slice(0, STATUS_RECENT)
    .map((n) => ({ path: n.path, title: n.title, mtime: n.mtime }));
  let outline: { level: number; title: string }[] = [];
  let outlineTotal = 0;
  const counted: { path: string; open: number }[] = [];
  for (const n of inside) {
    const content = await read(n.path).catch(() => null);
    if (content === null) continue;
    if (n.path === e.main) {
      const headings = markdownStructure(content).headings;
      outlineTotal = headings.length;
      outline = headings.slice(0, STATUS_OUTLINE_MAX).map((h) => ({ level: h.level, title: h.title }));
    }
    const open = openTasks(content);
    if (open > 0) counted.push({ path: n.path, open });
  }
  counted.sort((a, b) => b.open - a.open || a.path.localeCompare(b.path));
  return {
    project: projectInfo(e, notes),
    outline,
    outlineTotal,
    recent,
    tasks: counted.slice(0, STATUS_TASK_NOTES_MAX),
    taskNotes: counted.length,
    openTasks: counted.reduce((s, t) => s + t.open, 0),
  };
}

function parse(text: string): ProjectEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProjectError("E_PROJECTS_FILE", `${PROJECTS_DIR}/${PROJECTS_FILE} não é um JSON válido`);
  }
  const list = (data as { projects?: unknown })?.projects;
  if (!Array.isArray(list)) throw new ProjectError("E_PROJECTS_FILE", `${PROJECTS_DIR}/${PROJECTS_FILE} não tem a lista de projetos`);
  const out: ProjectEntry[] = [];
  for (const raw of list) {
    const p = raw as Partial<ProjectEntry>;
    if (!p || typeof p.folder !== "string" || !p.folder || out.some((o) => o.folder === p.folder)) continue;
    const main = typeof p.main === "string" && under(p.folder, p.main) ? p.main : null;
    out.push(entry(p.folder, main, typeof p.mainIno === "number" ? p.mainIno : undefined, typeof p.folderIno === "number" ? p.folderIno : undefined));
  }
  return out.slice(0, PROJECTS_MAX);
}

const same = (a: readonly ProjectEntry[], b: readonly ProjectEntry[]) =>
  a.length === b.length &&
  a.every((x, i) => x.folder === b[i]!.folder && x.main === b[i]!.main && x.mainIno === b[i]!.mainIno && x.folderIno === b[i]!.folderIno);

/**
 * O arquivo dos projetos de um cofre. As mudanças passam numa fila: a leitura e a gravação de uma não deixam outra
 * entrar no meio. Grava num temporário e troca pelo `rename`, como o registro do Lixo, e só quando algo mudou.
 */
export class ProjectsFile {
  private cache: ProjectEntry[] | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly root: string,
    /** Depois de cada gravação: a lista mudou (spec #9847, o evento `projects.changed`). */
    private readonly onChange: () => void = () => {},
  ) {}

  get file(): string {
    return path.join(this.root, PROJECTS_DIR, PROJECTS_FILE);
  }

  /** Os projetos, do disco na 1ª vez; um arquivo que não existe é uma lista vazia. */
  async load(): Promise<ProjectEntry[]> {
    if (this.cache) return this.cache;
    const text = await readFile(this.file, "utf8").catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    this.cache = text === null ? [] : parse(text);
    return this.cache;
  }

  /** Muda a lista a partir da de agora; devolve a lista nova. Sem mudança, não grava. */
  update(change: (list: ProjectEntry[]) => ProjectEntry[] | Promise<ProjectEntry[]>): Promise<ProjectEntry[]> {
    const run = this.queue.then(async () => {
      const current = await this.load();
      const next = await change(current.map((e) => ({ ...e })));
      if (next.length > PROJECTS_MAX) throw new ProjectError("E_TOO_MANY", `um cofre tem até ${PROJECTS_MAX} projetos`);
      if (same(next, current)) return current;
      await this.write(next);
      this.cache = next;
      this.onChange();
      return next;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  private async write(list: ProjectEntry[]): Promise<void> {
    const dir = path.join(this.root, PROJECTS_DIR);
    await mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.projects-${randomBytes(4).toString("hex")}.tmp`);
    try {
      await writeDurable(tmp, `${JSON.stringify({ version: 1, projects: list }, null, 2)}\n`);
      await rename(tmp, this.file);
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
  }
}

/**
 * Confere se `folder` pode virar projeto: precisa existir, não pode ser a raiz, nem a pasta das reuniões (ou uma de
 * dentro dela), nem ficar dentro de outro projeto ou ter um projeto dentro dela.
 */
export function checkMark(
  folder: string,
  list: readonly ProjectEntry[],
  folders: ReadonlySet<string>,
  meetingsFolder: string | null,
): void {
  if (!folder) throw new ProjectError("E_BAD_ARGS", "a raiz das notas não pode ser um projeto; escolha uma pasta");
  if (!folders.has(folder)) throw new ProjectError("E_NOT_FOUND", `a pasta ${folder} não existe`);
  if (meetingsFolder && under(meetingsFolder, folder))
    throw new ProjectError("E_MEETINGS_FOLDER", `a pasta das reuniões (${meetingsFolder}) não pode ser um projeto`);
  const outer = list.find((e) => e.folder !== folder && under(e.folder, folder));
  if (outer) throw new ProjectError("E_NESTED", `${folder} fica dentro do projeto ${outer.folder}`);
  const inner = list.find((e) => e.folder !== folder && under(folder, e.folder));
  if (inner) throw new ProjectError("E_NESTED", `${folder} tem o projeto ${inner.folder} dentro dela`);
}
