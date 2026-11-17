// O lixo do headless (T7681): o que um agente apaga num teste fica em `<data>/trash`, dentro da pasta de dados do
// headless, e nunca vai para o Lixo do macOS da pessoa do Mac. Vale para todo vault do headless: o interno e o de
// "Abrir outra pasta". O app de verdade segue com o `macTrash` (`/usr/bin/trash`).

import { randomBytes } from "node:crypto";
import { cp, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

export function headlessTrash(dir: string): (abs: string) => Promise<void> {
  return async (abs) => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // Um nome por item: duas "A.md" apagadas não se sobrepõem.
    const to = path.join(dir, `${Date.now()}-${randomBytes(4).toString("hex")}-${path.basename(abs)}`);
    try {
      await rename(abs, to);
    } catch (e) {
      // "Abrir outra pasta" num outro disco: copia e tira.
      if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
      await cp(abs, to, { recursive: true });
      await rm(abs, { recursive: true, force: true });
    }
  };
}
