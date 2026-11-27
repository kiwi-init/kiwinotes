// Quando a bateria do ditado não roda (#454, T33239): o motivo do headless fica no `headless.out` da pasta temporária,
// que o `stop()` apaga logo depois. Estas linhas saem na mensagem antes, para a falha se ler sem rodar de novo (numa
// worktree nova, sem o `swift build` em `native/`, é ali que está a dica).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** As últimas linhas de cada `headless.out` que existe nas pastas, prontas para ir depois do erro. "" sem nenhum. */
export function headlessOutTail(dirs: string[], lines = 15): string {
  const parts: string[] = [];
  for (const dir of dirs) {
    const file = path.join(dir, "headless.out");
    if (!existsSync(file)) continue;
    const tail = readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
    if (tail) parts.push(`\n--- ${file} (últimas linhas) ---\n${tail}`);
  }
  return parts.join("");
}

/** A mensagem de quando a bateria não rodou: o erro, o fim do `headless.out` e o que acontece com a pasta. */
export function notRunMessage(error: string, dirs: string[], keep: boolean): string {
  const where = dirs[0] ?? "";
  const tail = headlessOutTail(dirs);
  const folder = keep ? `\n(a pasta fica em ${where})` : tail ? `\n(a pasta ${where} foi apagada; --keep a guarda)` : "";
  return `a bateria não rodou: ${error}${tail}${folder}`;
}
