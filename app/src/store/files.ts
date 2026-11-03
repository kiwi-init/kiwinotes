// Arquivos do app: legíveis (JSON e JSONL), só do usuário (0700/0600), gravados de forma atômica.

import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** `~/Library/Application Support/KiwiNotes/`, a mesma pasta do socket do sidecar. */
export function dataDir(home = os.homedir()): string {
  return path.join(home, "Library", "Application Support", "KiwiNotes");
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

/** Grava num arquivo temporário e renomeia: um crash no meio nunca deixa o arquivo pela metade. */
export async function writeAtomic(file: string, content: string): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, file);
}

export const writeJson = (file: string, value: unknown) => writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
