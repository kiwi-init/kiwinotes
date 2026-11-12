// O `claude` falso (spec #4576): responde o `--version` e o `auth status` como o Claude Code, para os testes e a CLI
// dos agentes nunca rodarem o de verdade (ADR 0011).
//
//   bun src/agent/fake/claude.ts --version     "2.1.322 (Claude Code)"
//   bun src/agent/fake/claude.ts auth status   o JSON do login; exit 0 logado, 1 não
//
// KIWI_FAKE_CLAUDE_LOGGED_IN=0 faz ele dizer que não está logado. O JSON traz uma conta e um e-mail de mentira, para os
// testes provarem que o Kiwi não os lê.

const args = process.argv.slice(2);
const loggedIn = process.env.KIWI_FAKE_CLAUDE_LOGGED_IN !== "0";

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
