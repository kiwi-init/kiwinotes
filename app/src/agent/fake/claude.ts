// O `claude` falso (spec #4576): responde o `--version` e o `auth status` como o Claude Code, para os testes e a CLI
// dos agentes nunca rodarem o de verdade (ADR 0011).
//
//   bun src/agent/fake/claude.ts --version     "2.1.322 (Claude Code)"
//   bun src/agent/fake/claude.ts auth status   o JSON do login; exit 0 logado, 1 não
//
// KIWI_FAKE_CLAUDE_DELAY_MS faz o `--version` e o `auth status` demorarem, como a 1ª abertura depois de uma atualização.
// KIWI_FAKE_CLAUDE_LOGGED_IN=0 faz ele dizer que não está logado. O JSON traz uma conta e um e-mail de mentira, para os
// testes provarem que o Kiwi não os lê.
//
// **O modo do adaptador** (spec #8368): quando o SDK do Claude Code abre o `claude` com `--input-format stream-json`,
// o falso anota como foi chamado (os argumentos, a pasta e o `CLAUDE_CODE_ENTRYPOINT`) numa linha JSON em
// `KIWI_FAKE_CLAUDE_LOG`, e responde às mensagens de controle do SDK o mínimo para a sessão abrir: o `initialize` com
// um modelo de mentira e nenhum comando, e as outras com sucesso vazio. Ele não chama modelo nenhum e não vai à rede.
// É a prova do builder de que o adaptador, aberto pelo Bun do app, chama o programa que o Kiwi indicou.

import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const loggedIn = process.env.KIWI_FAKE_CLAUDE_LOGGED_IN !== "0";

if (args.includes("--input-format")) {
  const log = process.env.KIWI_FAKE_CLAUDE_LOG;
  if (log) {
    appendFileSync(
      log,
      JSON.stringify({ argv: args, cwd: process.cwd(), entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT ?? null, script: import.meta.path }) + "\n",
    );
  }
  const send = (x: unknown) => process.stdout.write(JSON.stringify(x) + "\n");
  for await (const line of createInterface({ input: process.stdin })) {
    let msg: { type?: string; request_id?: string; request?: { subtype?: string } };
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.type !== "control_request" || !msg.request_id) continue;
    const response =
      msg.request?.subtype === "initialize"
        ? {
            commands: [],
            agents: [],
            output_style: "default",
            available_output_styles: ["default"],
            models: [{ value: "default", displayName: "Modelo de mentira", description: "o claude falso não chama modelo nenhum" }],
            account: {},
          }
        : {};
    send({ type: "control_response", response: { subtype: "success", request_id: msg.request_id, response } });
  }
  process.exit(0);
}

const delay = Number(process.env.KIWI_FAKE_CLAUDE_DELAY_MS ?? 0);
if (delay > 0 && (args[0] === "--version" || args[0] === "auth")) await Bun.sleep(delay);

if (args[0] === "--version") {
  console.log(`${process.env.KIWI_FAKE_CLAUDE_VERSION ?? "2.1.322"} (Claude Code)`);
  process.exit(0);
}

if (args[0] === "auth" && args[1] === "status") {
  console.log(
    JSON.stringify(
      loggedIn
        ? { loggedIn: true, authMethod: "claude.ai", email: "pessoa@exemplo.invalid", orgName: "Conta de mentira", subscriptionType: "max" }
        : { loggedIn: false, authMethod: "none" },
    ),
  );
  process.exit(loggedIn ? 0 : 1);
}

console.error(`claude falso: não sei fazer "${args.join(" ")}"`);
process.exit(2);
