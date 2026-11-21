// O `gemini` falso (spec #24666): responde o `--version` e fala ACP no `--acp`, como o Gemini CLI 0.70.0, para os
// testes e a CLI dos agentes nunca rodarem o de verdade (ADR 0011). Ele não chama modelo nenhum e não vai à rede.
//
//   bun src/agent/fake/gemini.ts --version   "0.70.0"
//   bun src/agent/fake/gemini.ts --acp …     o agente falso (`agent.ts`) no jeito do Gemini (KIWI_FAKE_AGENT_FLAVOR)
//
// O ambiente:
//   KIWI_FAKE_GEMINI_VERSION    a versão que ele diz (o padrão é 0.70.0)
//   KIWI_FAKE_GEMINI_DELAY_MS   o `--version` demora isso, como a 1ª abertura depois de uma atualização
//   KIWI_FAKE_GEMINI_LOGGED_IN  "0": a sessão não abre, com o -32000 do Gemini sem login
//   KIWI_FAKE_AGENT_LOG         além das linhas do agente falso, uma `{ method: "argv" }` com os argumentos, a pasta e
//                               as variáveis do Gemini com que foi aberto: os testes conferem o isolamento por ela
//
// Ele nunca lê a pasta `~/.gemini`: não tem login de verdade para conferir.

import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);

if (args[0] === "--version") {
  const delay = Number(process.env.KIWI_FAKE_GEMINI_DELAY_MS ?? 0);
  if (delay > 0) await Bun.sleep(delay);
  // O de verdade imprime só o número (o `.version()` do yargs com o do package.json).
  console.log(process.env.KIWI_FAKE_GEMINI_VERSION ?? "0.70.0");
  process.exit(0);
}

if (args.includes("--acp")) {
  const log = process.env.KIWI_FAKE_AGENT_LOG;
  if (log) {
    // Só os nomes das variáveis do Gemini e do Google (uma chave de API no ambiente de quem roda o teste nunca vai ao
    // log), e os valores das duas que o Kiwi põe.
    const geminiVars = Object.keys(process.env).filter((k) => /^(GEMINI_|GOOGLE_)/.test(k)).sort();
    const env = {
      GEMINI_CLI_NO_RELAUNCH: process.env.GEMINI_CLI_NO_RELAUNCH ?? null,
      NO_BROWSER: process.env.NO_BROWSER ?? null,
      pathFirst: (process.env.PATH ?? "").split(":")[0] ?? "",
    };
    appendFileSync(log, JSON.stringify({ method: "argv", params: { argv: args, cwd: process.cwd(), env, geminiVars } }) + "\n");
  }
  process.env.KIWI_FAKE_AGENT_FLAVOR = "gemini";
  await import("./agent.ts");
} else {
  console.error(`gemini falso: não sei fazer "${args.join(" ")}"`);
  process.exit(2);
}
