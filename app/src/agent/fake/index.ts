// Como abrir os falsos: com o mesmo Bun que roda o Kiwi (no app, o de dentro do .app; na CLI e nos testes, o do
// sistema). Nada aqui roda o Claude Code de verdade.

import path from "node:path";

export const FAKE_AGENT_COMMAND: readonly string[] = [process.execPath, path.join(import.meta.dir, "agent.ts")];
export const FAKE_CLAUDE: readonly string[] = [process.execPath, path.join(import.meta.dir, "claude.ts")];
