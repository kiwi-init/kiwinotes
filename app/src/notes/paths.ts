// Os caminhos do vault (T1316). Toda nota e pasta é relativa à raiz, em POSIX, e nada sai dela: `..`, caminho
// absoluto, link simbólico e pastas com ponto (`.obsidian`, `.trash`) são recusados. É a fronteira de segurança das
// capacidades `notes.*`: uma UI do AppEngine não pode ler nem escrever fora do vault.

import { lstatSync } from "node:fs";
import path from "node:path";

/** Um erro com código, que o AppEngine passa à UI como está. */
export class VaultError extends Error {
  constructor(
    readonly code: "E_BAD_ARGS" | "E_NOT_FOUND" | "E_EXISTS" | "E_OUTSIDE_VAULT",
    message: string,
  ) {
    super(message);
  }
}

const MAX_PATH = 1024;
const MAX_SEGMENT = 200;

function segments(input: unknown, what: string): string[] {
  if (typeof input !== "string") throw new VaultError("E_BAD_ARGS", `${what} must be a string`);
  const p = input.normalize("NFC");
  if (p.length > MAX_PATH) throw new VaultError("E_BAD_ARGS", `${what} is too long`);
  if (p.includes("\\") || p.includes("\0")) throw new VaultError("E_OUTSIDE_VAULT", `${what} has a backslash or NUL`);
  if (p.startsWith("/") || p.startsWith("~")) throw new VaultError("E_OUTSIDE_VAULT", `${what} must be relative to the vault`);
  const parts = p === "" ? [] : p.split("/");
  for (const s of parts) {
    if (s === "" || s === "." || s === "..") throw new VaultError("E_OUTSIDE_VAULT", `${what} has an empty, "." or ".." segment`);
    if (s.startsWith(".")) throw new VaultError("E_OUTSIDE_VAULT", `${what} goes into a hidden folder or file`);
    if (s.length > MAX_SEGMENT) throw new VaultError("E_BAD_ARGS", `${what} has a name longer than ${MAX_SEGMENT}`);
  }
  return parts;
}

/** Um caminho de nota: relativo, terminando em `.md`. */
export function notePath(input: unknown): string {
  const parts = segments(input, "path");
  if (!parts.length || !/\.md$/i.test(parts.at(-1)!) || parts.at(-1)!.length <= 3) {
    throw new VaultError("E_BAD_ARGS", "path must name a .md note");
  }
  return parts.join("/");
}

/** Um arquivo do vault que não é nota (T3370): relativo, com nome, e sem ser `.md`. */
export function filePath(input: unknown): string {
  const parts = segments(input, "path");
  if (!parts.length) throw new VaultError("E_BAD_ARGS", "path must name a file");
  if (/\.md$/i.test(parts.at(-1)!)) throw new VaultError("E_BAD_ARGS", "path names a note: open it in Kiwi");
  return parts.join("/");
}

/** Um caminho de pasta: relativo, ou "" para a raiz. */
export function folderPath(input: unknown): string {
  return segments(input ?? "", "folder").join("/");
}

/**
 * O caminho absoluto de `rel` no vault, conferindo que nenhum pedaço que já existe é link simbólico (um link podia
 * apontar para fora). O que ainda não existe (uma nota nova) é aceito.
 */
export function inside(root: string, rel: string): string {
  let at = root;
  for (const part of rel === "" ? [] : rel.split("/")) {
    at = path.join(at, part);
    let stat;
    try {
      stat = lstatSync(at);
    } catch {
      break; // daqui para baixo ainda não existe
    }
    if (stat.isSymbolicLink()) throw new VaultError("E_OUTSIDE_VAULT", `${rel} goes through a symbolic link`);
  }
  return path.join(root, rel);
}

/** Um título vira nome de arquivo: sem os caracteres que o Obsidian e o macOS não aceitam num nome. */
export function fileNameFor(title: unknown): string {
  if (typeof title !== "string") throw new VaultError("E_BAD_ARGS", "title must be a string");
  const name = title
    .normalize("NFC")
    .replace(/[\\/:*?"<>|#^[\]\0]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, MAX_SEGMENT - 8);
  if (!name) throw new VaultError("E_BAD_ARGS", "title is empty");
  return name;
}
