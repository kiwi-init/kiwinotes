// O `agy` falso (spec #25046, T25059): responde o `--version` e o `--help` e fala ACP no `acp`, como o Antigravity CLI,
// para os testes e a CLI dos agentes nunca rodarem o de verdade (ADR 0011). Ele não chama modelo nenhum e não vai à rede.
//
//   bun src/agent/fake/agy.ts --version   "1.4.0"
//   bun src/agent/fake/agy.ts --help      a ajuda, com o comando `acp`
//   bun src/agent/fake/agy.ts acp …       o agente falso (`agent.ts`) no jeito do `agy` (KIWI_FAKE_AGENT_FLAVOR=agy)
//
// O ambiente:
//   KIWI_FAKE_AGY_VERSION   a versão que ele diz (o padrão é 1.4.0)
//   KIWI_FAKE_AGY_NO_ACP    "1": um `agy` velho, sem o comando `acp` no `--help`
//   KIWI_FAKE_AGENT_LOG     além das linhas do agente falso, uma `{ method: "argv" }` com os argumentos, a pasta e o
//                           que o Kiwi escreveu na pasta de trabalho (`.agents/`): os testes conferem o isolamento por ela
//
// Ele nunca lê a pasta `~/.gemini`: não tem login de verdade para conferir.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

if (args[0] === "--version") {
  console.log(process.env.KIWI_FAKE_AGY_VERSION ?? "1.4.0");
  process.exit(0);
}

if (args[0] === "--help") {
  const acp = process.env.KIWI_FAKE_AGY_NO_ACP === "1" ? "" : "  acp        Start the Agent Client Protocol server over stdio\n";
  // No stderr, como o agy 1.5.13 de verdade (T25486).
  console.error(`Usage: agy [options] [command]\n\nCommands:\n${acp}  login      Sign in\n\nOptions:\n  --version  Print the version\n`);
  process.exit(0);
}

if (args[0] === "acp") {
  const log = process.env.KIWI_FAKE_AGENT_LOG;
  if (log) {
    const file = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);
    const agents = path.join(process.cwd(), ".agents");
    const workspace = { agent: file(path.join(agents, "agents", "kiwi.md")), settings: file(path.join(agents, "settings.json")) };
    // Só os nomes das variáveis do Gemini e do Google: uma chave de API no ambiente de quem roda o teste nunca vai ao log.
    const geminiVars = Object.keys(process.env).filter((k) => /^(GEMINI_|GOOGLE_)/.test(k)).sort();
    const env = { NO_BROWSER: process.env.NO_BROWSER ?? null, pathFirst: (process.env.PATH ?? "").split(":")[0] ?? "" };
    appendFileSync(log, JSON.stringify({ method: "argv", params: { argv: args, cwd: process.cwd(), env, geminiVars, workspace } }) + "\n");
  }
  process.env.KIWI_FAKE_AGENT_FLAVOR = "agy";
  await import("./agent.ts");
} else {
  console.error(`agy falso: não sei fazer "${args.join(" ")}"`);
  process.exit(2);
}
