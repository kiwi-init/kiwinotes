// Como abrir os falsos: com o mesmo Bun que roda o Kiwi (no app, o de dentro do .app; na CLI e nos testes, o do
// sistema). Nada aqui roda o Claude Code de verdade.

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const FAKE_AGENT_COMMAND: readonly string[] = [process.execPath, path.join(import.meta.dir, "agent.ts")];
export const FAKE_CLAUDE: readonly string[] = [process.execPath, path.join(import.meta.dir, "claude.ts")];

/**
 * Um `claude` falso que é um executável de verdade, numa pasta: o adaptador (spec #8368) só sabe abrir um programa
 * por caminho (`CLAUDE_CODE_EXECUTABLE`), e não um `bun arquivo.ts`. Devolve o caminho do `<dir>/claude`.
 */
export function writeFakeClaudeExecutable(dir: string, env: Record<string, string> = {}): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "claude");
  const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
  // As variáveis do falso (a versão, o login) ficam no próprio executável, para valerem quando o adaptador o abre.
  const exports = Object.entries(env)
    .map(([k, v]) => `export ${k}=${q(v)}\n`)
    .join("");
  // `exec -a "$0"`: o processo fica com o nome com que foi chamado, como o `claude` de verdade, e o `ps` da prova vê
  // o caminho que o adaptador abriu, e não o do Bun.
  writeFileSync(file, `#!/bin/bash\n${exports}exec -a "$0" ${q(FAKE_CLAUDE[0]!)} ${q(FAKE_CLAUDE[1]!)} "$@"\n`);
  chmodSync(file, 0o755);
  return file;
}
