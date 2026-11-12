// `bun run cli agent …` (spec #4576): o host do agente pela CLI, sem tela e sem rede. Roda aqui mesmo, sem o headless
// de pé: o agente ainda não faz parte do app.
//
//   bun run cli agent status [--data DIR] [--claude PATH]      o Claude Code está instalado? logado? qual versão?
//   bun run cli agent ask "texto" [--data DIR] [--new]         um pedido; os eventos saem um por linha, e a resposta no fim
//   bun run cli agent download [--data DIR] [--registry URL]   baixa o adaptador do Claude Code (spec #8368), a lista fixa
//   bun run cli agent remove [--data DIR]                      apaga o adaptador baixado
//   bun run cli agent proof [--data DIR] [--real]              abre uma sessão pelo adaptador, sem pedido, e mostra o
//                                                              programa aberto, o isolamento e o que a sessão recebeu
//
// **O `proof --real` abre o Claude Code de verdade, logado: só o harry roda, quando o lead pede** (ADR 0011, #8368).
// Sem `--real`, a prova usa um `claude` falso, que anota como foi chamado em `<data>/fake-claude/calls.jsonl`. As duas
// baixam o adaptador antes, se faltar: é a única ida à rede, só os pacotes da lista fixa.
//
// **Para os agentes do time, tudo usa os falsos** (ADR 0011): o `claude` falso (`src/agent/fake/claude.ts`) e o agente
// falso que fala ACP (`src/agent/fake/agent.ts`). O `--claude PATH` aponta outro programa no lugar do `claude` falso,
// por exemplo um caminho que não existe, para ver o "não instalado". Abrir o Claude Code de verdade é do spec #8368,
// e só o harry faz. A sessão do agente fica em `<data>/agent/`; `--new` começa uma sessão nova.
//
// Saída: JSON. Exit 0 ok, 1 o agente respondeu erro (o `code` diz qual), 2 uso errado.

import path from "node:path";

import { downloadAdapter, installedAdapter, removeAdapter } from "../src/agent/adapter/download.ts";
import { adapterRoot } from "../src/agent/adapter/open.ts";
import { ADAPTER_VERSION, CLAUDE_CODE_FOR_ADAPTER } from "../src/agent/adapter/pinned.ts";
import { runAdapterProof } from "../src/agent/adapter/proof.ts";
import { checkClaudeVersion } from "../src/agent/adapter/version.ts";
import { claudeStatus, findClaude, type ProgramArgv } from "../src/agent/claude.ts";
import { AgentError } from "../src/agent/errors.ts";
import { FAKE_AGENT_COMMAND, FAKE_CLAUDE, writeFakeClaudeExecutable } from "../src/agent/fake/index.ts";
import { AgentHost } from "../src/agent/host.ts";
import { assertNotRealData, RealDataError } from "../src/headless/guard.ts";

const USAGE = `usage: bun run cli agent <status|ask|download|remove|proof> [--data DIR]
  status [--claude PATH]       o Claude Code (o falso, para os agentes): instalado, versão, login e o adaptador
  ask "texto" [--new]          um pedido ao agente falso; --new começa uma sessão nova
  download [--registry URL]    baixa o adaptador do Claude Code (a lista fixa, conferida)
  remove                       apaga o adaptador baixado
  proof [--real]               abre uma sessão pelo adaptador, sem pedido; --real usa o Claude Code de verdade (só o harry)`;

const NAME = "Claude Code";

const print = (x: unknown) => console.log(JSON.stringify(x, null, 2));

function option(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** O `claude` que a CLI usa: o falso, ou o `--claude PATH`. */
function claudeProgram(argv: string[]): { program: ProgramArgv; fake: boolean } {
  const given = option(argv, "--claude");
  return given ? { program: [path.resolve(given)], fake: false } : { program: FAKE_CLAUDE, fake: true };
}

function fail(e: unknown): number {
  if (e instanceof AgentError) {
    print({ ok: false, code: e.code, message: e.message });
    return 1;
  }
  if (e instanceof RealDataError) {
    print({ ok: false, code: e.code, message: e.message });
    return 1;
  }
  print({ ok: false, code: "E_AGENT_FAILED", message: String((e as Error)?.message ?? e) });
  return 1;
}

export async function runAgent(argv: string[], data: string): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === "status") {
    const { program, fake } = claudeProgram(rest);
    const s = await claudeStatus(program);
    const adapter = installedAdapter({ root: adapterRoot(data) });
    const version = checkClaudeVersion(s.version);
    print({
      ok: true,
      value: {
        agent: NAME,
        fake,
        ...s,
        versionOk: version.ok,
        ...(version.ok ? {} : { versionError: version.code }),
        adapter: { installed: !!adapter, version: ADAPTER_VERSION, claudeCode: CLAUDE_CODE_FOR_ADAPTER },
      },
    });
    return 0;
  }
  if (sub === "download") {
    try {
      assertNotRealData(data);
      const r = await downloadAdapter({
        root: adapterRoot(data),
        registry: option(rest, "--registry"),
        onPackage: (p) => console.log(JSON.stringify({ event: { type: "package", ...p } })),
      });
      print({ ok: true, value: { version: ADAPTER_VERSION, ...r } });
      return 0;
    } catch (e) {
      return fail(e);
    }
  }
  if (sub === "remove") {
    try {
      assertNotRealData(data);
      removeAdapter({ root: adapterRoot(data) });
      print({ ok: true, value: { removed: true } });
      return 0;
    } catch (e) {
      return fail(e);
    }
  }
  if (sub === "proof") {
    try {
      assertNotRealData(data);
      const real = rest.includes("--real");
      await downloadAdapter({ root: adapterRoot(data), registry: option(rest, "--registry") });
      let claudePath: string | null;
      let env: Record<string, string | undefined> = process.env;
      if (real) {
        claudePath = findClaude();
      } else {
        const dir = path.join(data, "fake-claude");
        claudePath = writeFakeClaudeExecutable(dir);
        env = { ...process.env, KIWI_FAKE_CLAUDE_LOG: path.join(dir, "calls.jsonl") };
      }
      if (!claudePath) throw new AgentError("E_AGENT_NOT_INSTALLED", NAME);
      const report = await runAdapterProof({ data, claudePath, env });
      print({ ok: report.ok, value: { real, ...report } });
      return report.ok ? 0 : 1;
    } catch (e) {
      return fail(e);
    }
  }
  if (sub === "ask") {
    const text = rest[0];
    if (!text || text.startsWith("--")) {
      console.error(USAGE);
      return 2;
    }
    try {
      assertNotRealData(data);
      const { program } = claudeProgram(rest);
      const s = await claudeStatus(program);
      if (!s.installed) throw new AgentError("E_AGENT_NOT_INSTALLED", NAME);
      if (!s.loggedIn) throw new AgentError("E_AGENT_NOT_LOGGED_IN", NAME);
      const host = new AgentHost({ name: NAME, command: FAKE_AGENT_COMMAND, dir: path.join(data, "agent") });
      if (rest.includes("--new")) host.forgetSession();
      const session = await host.start();
      const onSigint = () => void host.cancel();
      process.on("SIGINT", onSigint);
      try {
        const answer = await host.ask(text, (e) => console.log(JSON.stringify({ event: e })));
        print({ ok: true, value: { ...answer, sessionId: session.sessionId, resumed: session.resumed, agent: session.agent, fake: true } });
        return 0;
      } finally {
        process.off("SIGINT", onSigint);
        await host.stop();
      }
    } catch (e) {
      return fail(e);
    }
  }
  console.error(USAGE);
  return 2;
}
