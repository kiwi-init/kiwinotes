// Arquivos do app: legíveis (JSON e JSONL), só do usuário (0700/0600), gravados de forma atômica.

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** `~/Library/Application Support/KiwiNotes/`, a mesma pasta do socket do sidecar. */
export function dataDir(home = os.homedir()): string {
  return path.join(home, "Library", "Application Support", "KiwiNotes");
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

/**
 * Lê um JSON do app. Sem o arquivo, `undefined`. Um arquivo que não é JSON (editado à mão, cortado por um disco cheio,
 * restaurado pela metade de um backup) também volta `undefined`, e quem lê segue com o padrão (T7816): antes ele lançava,
 * e quem lia em segundo plano (a busca pelo sentido, as pastas das notas) derrubava o processo ao abrir as Notas. O
 * arquivo da pessoa não some: ele fica ao lado, como `<arquivo>.broken-<data>`, antes de a próxima gravação o trocar.
 */
export async function readJson<T>(file: string): Promise<T | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    const kept = `${file}.broken-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    // Outro leitor pode ter guardado o mesmo arquivo um instante antes: sem ele, só segue com o padrão.
    await rename(file, kept).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    console.warn(`[store] ${path.basename(file)} is not JSON; kept as ${path.basename(kept)}, using the defaults`);
    return undefined;
  }
}

/**
 * Grava num arquivo temporário e renomeia: um crash no meio nunca deixa o arquivo pela metade. O temporário tem um
 * pedaço aleatório: duas gravações no mesmo milissegundo escreviam no mesmo .tmp e deixavam lixo no fim (T2503).
 */
export async function writeAtomic(file: string, content: string): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, content, { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, file);
  } catch (e) {
    // O disco cheio no meio (T7942): o temporário sai, o arquivo fica como estava, e o erro segue.
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

export const writeJson = (file: string, value: unknown) => writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
