// Os anexos das notas (T2594, spec #2457 ponto 3): imagens e PDFs colados ou arrastados para a nota, como no Obsidian.
// O arquivo vai para a pasta de anexos do vault (`Anexos/` por padrão) e a nota ganha um `![[foto.png]]`. O editor
// pede o arquivo de volta por `attachments.read`, que devolve um `data:` URL: a UI nunca vê caminho absoluto nem
// `file://`, e a CSP das views fica como está.
//
// A mesma fronteira das notas (paths.ts): nada sai do vault, nem por `..`, nem por link simbólico, nem por pasta
// oculta. Só os tipos da lista e até `MAX_ATTACHMENT_BYTES`.

import { randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { fold } from "../store/text.ts";
import { inside, VaultError } from "./paths.ts";
import type { Vault } from "./vault.ts";

/** O maior anexo: 25 MB (uma foto do iPhone em HEIC tem uns 3 MB; um PDF escaneado, uns 10). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** A pasta de anexos quando a pessoa não escolheu outra. */
export const DEFAULT_ATTACHMENTS_FOLDER = "Anexos";

/** Os tipos aceitos, com o MIME do `data:` URL. SVG entra só como imagem (`<img>`), onde script não roda. */
export const ATTACHMENT_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

const MAX_PATH = 1024;
const MAX_SEGMENT = 200;

export const extOf = (name: string): string => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();

/** Um caminho de anexo: relativo ao vault, sem `..` nem pasta oculta, terminando num tipo aceito. */
export function attachmentPath(input: unknown): string {
  if (typeof input !== "string") throw new VaultError("E_BAD_ARGS", "path must be a string");
  const p = input.normalize("NFC");
  if (p.length > MAX_PATH) throw new VaultError("E_BAD_ARGS", "path is too long");
  if (p.includes("\\") || p.includes("\0")) throw new VaultError("E_OUTSIDE_VAULT", "path has a backslash or NUL");
  if (p.startsWith("/") || p.startsWith("~")) throw new VaultError("E_OUTSIDE_VAULT", "path must be relative to the vault");
  const parts = p.split("/");
  for (const s of parts) {
    if (s === "" || s === "." || s === "..") throw new VaultError("E_OUTSIDE_VAULT", 'path has an empty, "." or ".." segment');
    if (s.startsWith(".")) throw new VaultError("E_OUTSIDE_VAULT", "path goes into a hidden folder or file");
    if (s.length > MAX_SEGMENT) throw new VaultError("E_BAD_ARGS", `path has a name longer than ${MAX_SEGMENT}`);
  }
  if (!ATTACHMENT_TYPES[extOf(p)]) throw new VaultError("E_BAD_ARGS", `not an attachment type: ${p}`);
  return parts.join("/");
}

/** A pasta de anexos das Configurações: relativa, sem pasta oculta. "" é a raiz do vault. */
export function attachmentsFolder(input: unknown): string {
  if (typeof input !== "string") throw new VaultError("E_BAD_ARGS", "attachments folder must be a string");
  const p = input.normalize("NFC").replace(/^\/+|\/+$/g, "");
  if (p.length > 256) throw new VaultError("E_BAD_ARGS", "attachments folder is too long");
  if (p.includes("\\") || p.includes("\0")) throw new VaultError("E_OUTSIDE_VAULT", "attachments folder has a backslash or NUL");
  if (p === "") return "";
  for (const s of p.split("/")) {
    if (s === "" || s === "." || s === ".." || s.startsWith(".")) throw new VaultError("E_OUTSIDE_VAULT", "attachments folder must stay in the vault");
  }
  return p;
}

/** O nome que a pessoa deu (ou o do arquivo colado) vira um nome de arquivo seguro, com a extensão em minúsculas. */
export function attachmentName(input: unknown): string {
  if (typeof input !== "string") throw new VaultError("E_BAD_ARGS", "name must be a string");
  const ext = extOf(input);
  if (!ATTACHMENT_TYPES[ext]) throw new VaultError("E_BAD_ARGS", `not an attachment type: ${input.slice(0, 80)}`);
  const base = input
    .normalize("NFC")
    .slice(0, -(ext.length + 1))
    .split(/[\\/]/)
    .at(-1)!
    .replace(/[:*?"<>|#^[\]\0]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, MAX_SEGMENT - 16);
  return `${base || "Anexo"}.${ext}`;
}

/** O nome com " 1", " 2"… antes da extensão. */
const numbered = (name: string, n: number) => (n === 0 ? name : name.replace(/(\.[a-z0-9]+)$/i, ` ${n}$1`));

const key = (s: string) => fold(s.normalize("NFC"));

/** Os anexos do vault (relativos, POSIX), sem pastas ocultas nem links simbólicos. */
export async function listAttachments(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string) => {
    let entries;
    try {
      entries = await readdir(rel ? path.join(root, rel) : root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.isSymbolicLink()) continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && ATTACHMENT_TYPES[extOf(e.name)]) out.push(p.normalize("NFC"));
    }
  };
  await walk("");
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * Para onde um `![[alvo]]` de anexo aponta, com a regra do Obsidian: sem barra, o nome do arquivo (com a extensão) em
 * qualquer pasta, sem diferença de maiúscula nem acento, e o caminho mais curto ganha; com barra, o caminho a partir da
 * raiz ou o fim de um caminho.
 */
export function resolveAttachment(target: string, files: readonly string[]): string | null {
  const t = target.trim().replace(/^\/+/, "").split(/[|#]/)[0]!.trim();
  if (!t) return null;
  const want = key(t);
  const hits = t.includes("/")
    ? files.filter((f) => key(f) === want || key(f).endsWith(`/${want}`))
    : files.filter((f) => key(f.split("/").at(-1)!) === want);
  return [...hits].sort((a, b) => a.length - b.length || a.localeCompare(b))[0] ?? null;
}

/** O texto do embed: só o nome quando ele já acha o arquivo, senão o caminho (como o Obsidian escreve). */
export function embedFor(p: string, files: readonly string[]): string {
  const name = p.split("/").at(-1)!;
  return `![[${resolveAttachment(name, files) === p ? name : p}]]`;
}

const LINK = /(!?)\[\[([^[\]|#\n]+)(#[^[\]|\n]*)?(\|[^[\]\n]*)?\]\]/g;

/** Troca nos links o que apontava para `from` pelo alvo de `to`. */
export function rewriteAttachmentLinks(
  content: string,
  from: string,
  to: string,
  before: readonly string[],
  after: readonly string[],
): { content: string; count: number } {
  const name = to.split("/").at(-1)!;
  const target = resolveAttachment(name, after) === to ? name : to;
  let count = 0;
  const out = content.replace(LINK, (raw, bang: string, t: string, heading: string | undefined, alias: string | undefined) => {
    if (resolveAttachment(t, before) !== from) return raw;
    count++;
    return `${bang}[[${target}${heading ?? ""}${alias ?? ""}]]`;
  });
  return { content: out, count };
}

export interface SavedAttachment {
  /** Relativo ao vault. */
  path: string;
  /** O que entra na nota: `![[foto.png]]`. */
  embed: string;
  size: number;
}

export interface AttachmentData {
  path: string;
  mime: string;
  size: number;
  /** `data:<mime>;base64,…` para o `<img>` do editor. */
  dataUrl: string;
}

/** Quantos bytes um base64 decodifica, sem decodificar. */
const base64Bytes = (s: string) => Math.floor((s.length * 3) / 4) - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0);

export class Attachments {
  constructor(
    private readonly vault: Pick<Vault, "root" | "notesContaining" | "get" | "save">,
    /** A pasta de anexos de agora (das Configurações). */
    private readonly folder: () => Promise<string> | string = () => DEFAULT_ATTACHMENTS_FOLDER,
  ) {}

  /** Grava o anexo com um nome que ainda não existe na pasta de anexos e devolve o embed para a nota. */
  async save(name: unknown, data: unknown): Promise<SavedAttachment> {
    const file = attachmentName(name);
    if (typeof data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new VaultError("E_BAD_ARGS", "data must be base64");
    if (base64Bytes(data) > MAX_ATTACHMENT_BYTES) throw new VaultError("E_BAD_ARGS", `attachment is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`);
    const bytes = Buffer.from(data, "base64");
    if (!bytes.length) throw new VaultError("E_BAD_ARGS", "attachment is empty");
    const folder = attachmentsFolder(await this.folder());
    const dirAbs = inside(this.vault.root, folder);
    await mkdir(dirAbs, { recursive: true });
    const dirStat = await lstat(dirAbs);
    if (!dirStat.isDirectory()) throw new VaultError("E_EXISTS", `${folder} is not a folder`);
    for (let n = 0; n < 1000; n++) {
      const rel = folder ? `${folder}/${numbered(file, n)}` : numbered(file, n);
      const abs = inside(this.vault.root, rel);
      try {
        // `wx`: nunca escreve por cima de um arquivo que já existe (nem de um que apareceu agora).
        await writeFile(abs, bytes, { flag: "wx", mode: 0o644 });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw e;
      }
      const files = await listAttachments(this.vault.root);
      return { path: rel, embed: embedFor(rel, files), size: bytes.length };
    }
    throw new VaultError("E_EXISTS", `too many attachments named ${file}`);
  }

  /** O anexo de um `![[…]]` (ou um caminho), como `data:` URL. */
  async read(link: unknown): Promise<AttachmentData> {
    if (typeof link !== "string" || !link.trim() || link.length > MAX_PATH) throw new VaultError("E_BAD_ARGS", "link must be a string");
    const target = link.trim().replace(/^!?\[\[|\]\]$/g, "");
    const files = await listAttachments(this.vault.root);
    const found = resolveAttachment(target, files);
    if (!found) throw new VaultError("E_NOT_FOUND", `no attachment ${target}`);
    const p = attachmentPath(found);
    const abs = inside(this.vault.root, p);
    const st = await stat(abs);
    if (st.size > MAX_ATTACHMENT_BYTES) throw new VaultError("E_BAD_ARGS", `attachment is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`);
    const mime = ATTACHMENT_TYPES[extOf(p)]!;
    const bytes = await readFile(abs);
    return { path: p, mime, size: bytes.length, dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
  }

  /**
   * Renomeia ou move o anexo e troca os `![[…]]` e `[[…]]` das notas que apontavam para ele. Cada nota é gravada
   * com a versão que foi lida: se ela mudar no meio, lê de novo (até 3 vezes), como no `notes.rename`.
   */
  async rename(input: unknown, target: unknown): Promise<{ path: string; updatedLinks: number }> {
    const from = attachmentPath(input);
    const to = attachmentPath(target);
    if (extOf(from) !== extOf(to)) throw new VaultError("E_BAD_ARGS", "an attachment keeps its type");
    const fromAbs = inside(this.vault.root, from);
    const toAbs = inside(this.vault.root, to);
    const before = await listAttachments(this.vault.root);
    if (!before.includes(from)) throw new VaultError("E_NOT_FOUND", `no attachment ${from}`);
    if (from.toLowerCase() !== to.toLowerCase() && before.some((f) => f.toLowerCase() === to.toLowerCase())) {
      throw new VaultError("E_EXISTS", `${to} already exists`);
    }
    await mkdir(path.dirname(toAbs), { recursive: true });
    // Um disco sem diferença de maiúscula: "foto.png" → "Foto.png" passa por um nome do meio.
    if (from.toLowerCase() === to.toLowerCase() && from !== to) {
      const mid = `${fromAbs}.${randomBytes(4).toString("hex")}.tmp`;
      await rename(fromAbs, mid);
      await rename(mid, toAbs);
    } else {
      await rename(fromAbs, toAbs);
    }
    const after = before.map((f) => (f === from ? to : f));
    const fromName = from.split("/").at(-1)!;
    let updatedLinks = 0;
    for (const meta of this.vault.notesContaining(fromName.replace(/\.[a-z0-9]+$/i, ""))) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const note = await this.vault.get(meta.path).catch(() => null);
        if (!note) break;
        const { content, count } = rewriteAttachmentLinks(note.content, from, to, before, after);
        if (!count) break;
        const r = await this.vault.save(note.path, content, note.version);
        if (r.saved) {
          updatedLinks += count;
          break;
        }
      }
    }
    return { path: to, updatedLinks };
  }
}
