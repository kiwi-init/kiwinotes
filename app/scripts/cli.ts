// A CLI de teste do Kiwi Notes (T1739, P0 do harry #1726): o app inteiro sem nada na tela de ninguém. Fala com o
// headless (src/headless/server.ts) pelo socket de controle; o protocolo está no #1745 e no app/README.md.
//
//   bun run cli start [--data DIR] [--no-helper]     sobe em segundo plano e espera ficar de pé
//   bun run cli status | stop
//   bun run cli invoke <capability> '<json>'         notes.*, history.*, dictionary.*, snippets.*
//   bun run cli dictate …                             (T1740)
//   bun run cli screenshot … | ui …                   (T1742)
//   bun run cli events [--follow] | logs [--follow]
//   bun run cli agent status | agent ask "…"          o host do agente, com os falsos (T8478, scripts/cli-agent.ts)
//   bun run cli guardrail scan <arquivo | ->          o que o detector de segredos seguraria (T9701, sem o headless)
//   bun run cli agent undo <pedido> [--change N]      desfaz o que o agente mudou (spec #9353), pelo headless de pé
//
// Saída: JSON. Exit codes: 0 ok, 1 a capacidade (ou o comando) respondeu erro, 2 uso errado, 3 não está rodando.
// Os dados ficam em --data, ou KIWI_HEADLESS_DATA, ou $TMPDIR/kiwinotes-headless: nunca os do app de verdade.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { assertNotRealData, RealDataError } from "../src/headless/guard.ts";
import { LineWriter } from "../src/headless/lineWriter.ts";
import { controlSocket } from "../src/headless/server.ts";
import { runAgent } from "./cli-agent.ts";
import { runDictate } from "./cli-dictate.ts";
import { runGuardrail } from "./cli-guardrail.ts";
import { runScreenshot, runUi, type UiContext } from "./cli-ui.ts";

export const EXIT = { ok: 0, failed: 1, usage: 2, notRunning: 3 } as const;

const USAGE = `usage: bun run cli <start|stop|status|invoke|dictate|screenshot|ui|events|logs|agent|guardrail|notice> [--data DIR]
  start [--no-helper]          sobe o headless em segundo plano
  invoke <cap> ['<json>']      uma capacidade do contrato, pelo caminho da UI
  events|logs [--follow]       o histórico recente; com --follow, continua até Ctrl-C
  agent status|ask "…"         o host do agente, com os falsos (sem o headless; T8478)
  notice '{"view":bool,"click":id}'  a janela de mentira e o clique, com KIWI_FAKE_NOTICES (spec #9839)
  guardrail scan <arquivo|->   o que o detector de segredos seguraria, com o trecho mascarado (sem o headless; T9701)
  agent undo <pedido> [--change N]  desfaz o que o agente mudou, pelo headless de pé (spec #9353)`;

type Reply = Record<string, unknown>;

function dataDir(argv: string[]): string {
  const i = argv.indexOf("--data");
  return path.resolve(i >= 0 && argv[i + 1] ? argv[i + 1]! : process.env.KIWI_HEADLESS_DATA || path.join(tmpdir(), "kiwinotes-headless"));
}

/** Uma conexão com o socket de controle: manda linhas e entrega cada resposta (ou evento) que chega. */
export async function connect(data: string, onLine: (line: Reply) => void): Promise<{ write(msg: Reply): void; close(): void } | null> {
  const sock = controlSocket(data);
  if (!existsSync(sock)) return null;
  let buf = "";
  let out: LineWriter | null = null;
  try {
    const s = await Bun.connect({
      unix: sock,
      socket: {
        // Uma linha grande (um anexo) não cabe de uma vez: o resto sai no drain (T2594).
        drain() {
          out?.flush();
        },
        data(_s, chunk) {
          buf += new TextDecoder().decode(chunk);
          for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (line.trim()) onLine(JSON.parse(line) as Reply);
          }
        },
      },
    });
    out = new LineWriter(s);
    const w = out;
    return { write: (msg) => w.line(JSON.stringify(msg)), close: () => s.end() };
  } catch {
    return null;
  }
}

/** Um pedido e a sua resposta (a linha com o mesmo id). */
export async function request(data: string, msg: Reply, timeoutMs = 120_000): Promise<Reply | null> {
  const id = Math.floor(Math.random() * 1e9);
  let resolve!: (r: Reply) => void;
  const answer = new Promise<Reply>((r) => (resolve = r));
  const conn = await connect(data, (line) => {
    if (line.id === id) resolve(line);
  });
  if (!conn) return null;
  conn.write({ ...msg, id });
  const timer = setTimeout(() => resolve({ id, ok: false, code: "E_TIMEOUT", message: `no answer in ${timeoutMs} ms` }), timeoutMs);
  const reply = await answer;
  clearTimeout(timer);
  conn.close();
  return reply;
}

const print = (x: unknown) => console.log(JSON.stringify(x, null, 2));
const notRunning = (data: string) => {
  print({ ok: false, code: "E_NOT_RUNNING", message: `no headless at ${data}: bun run cli start --data ${data}` });
  return EXIT.notRunning;
};

async function start(data: string, argv: string[]): Promise<number> {
  try {
    assertNotRealData(data);
  } catch (e) {
    if (!(e instanceof RealDataError)) throw e;
    print({ ok: false, code: e.code, message: e.message });
    return EXIT.failed;
  }
  if (await request(data, { cmd: "status" }, 2000)) {
    print({ ok: true, value: { alreadyRunning: true, data } });
    return EXIT.ok;
  }
  mkdirSync(data, { recursive: true, mode: 0o700 });
  const out = openSync(path.join(data, "headless.out"), "a");
  const args = [path.join(import.meta.dirname, "..", "src", "headless", "main.ts"), "--data", data];
  if (argv.includes("--no-helper")) args.push("--no-helper");
  const child = spawn(process.execPath, args, { detached: true, stdio: ["ignore", out, out], env: process.env });
  child.unref();
  for (const end = Date.now() + 30_000; Date.now() < end; ) {
    const r = await request(data, { cmd: "status" }, 2000);
    if (r?.ok) {
      print(r);
      return EXIT.ok;
    }
    await Bun.sleep(200);
  }
  print({ ok: false, code: "E_START", message: `the headless didn't come up; see ${path.join(data, "headless.out")}` });
  return EXIT.failed;
}

async function stream(data: string, topic: "events" | "logs", follow: boolean): Promise<number> {
  let done!: () => void;
  const finished = new Promise<void>((r) => (done = r));
  const conn = await connect(data, (line) => {
    if ("id" in line) {
      if (!follow) setTimeout(done, 50); // o histórico chega antes da resposta
      return;
    }
    console.log(JSON.stringify(line));
  });
  if (!conn) return notRunning(data);
  conn.write({ id: 1, cmd: "subscribe", topics: [topic], follow });
  if (follow) process.on("SIGINT", () => done());
  await finished;
  conn.close();
  return EXIT.ok;
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const data = dataDir(rest);
  switch (cmd) {
    case "start":
      return start(data, rest);
    case "status":
    case "stop": {
      const r = await request(data, { cmd });
      if (!r) return notRunning(data);
      print(r);
      return r.ok ? EXIT.ok : EXIT.failed;
    }
    case "invoke": {
      const cap = rest[0];
      if (!cap || cap.startsWith("--")) {
        console.error(USAGE);
        return EXIT.usage;
      }
      let args: unknown = {};
      if (rest[1] && !rest[1].startsWith("--")) {
        try {
          args = JSON.parse(rest[1]);
        } catch {
          console.error(`invoke: the args aren't JSON: ${rest[1]}`);
          return EXIT.usage;
        }
      }
      const r = await request(data, { cmd: "invoke", cap, args });
      if (!r) return notRunning(data);
      print(r);
      return r.ok ? EXIT.ok : EXIT.failed;
    }
    case "dictate":
      return runDictate(rest, async (msg) => {
        const r = await request(data, msg);
        if (!r) throw Object.assign(new Error(`no headless at ${data}`), { code: "E_NOT_RUNNING" });
        return r;
      });
    case "screenshot":
    case "ui": {
      const ctx: UiContext = {
        data,
        send: async (msg) => {
          const r = await request(data, msg);
          if (!r) throw Object.assign(new Error(`no headless at ${data}`), { code: "E_NOT_RUNNING" });
          return r;
        },
        subscribe: async (topics, onMsg) => {
          const conn = await connect(data, (line) => {
            if (!("id" in line)) onMsg(line);
          });
          if (!conn) throw Object.assign(new Error(`no headless at ${data}`), { code: "E_NOT_RUNNING" });
          conn.write({ id: 0, cmd: "subscribe", topics, follow: true, backlog: false });
          return () => conn.close();
        },
      };
      return cmd === "screenshot" ? runScreenshot(rest, ctx) : runUi(rest, ctx);
    }
    case "events":
    case "logs":
      return stream(data, cmd, rest.includes("--follow"));
    case "notice": {
      // O aviso falso (KIWI_FAKE_NOTICES, spec #9839): '{"view":true}' põe a janela de mentira na vista, '{"click":"<id>"}'
      // é o clique na notificação.
      let args: Record<string, unknown> = {};
      if (rest[0] && !rest[0].startsWith("--")) {
        try {
          args = JSON.parse(rest[0]) as Record<string, unknown>;
        } catch {
          console.error(`notice: the args aren't JSON: ${rest[0]}`);
          return EXIT.usage;
        }
      }
      const r = await request(data, { ...args, cmd: "notice" });
      if (!r) return notRunning(data);
      print(r);
      return r.ok ? EXIT.ok : EXIT.failed;
    }
    case "guardrail":
      return runGuardrail(rest);
    case "agent":
      // O `agent undo` muda notas: vai pelo headless de pé, como a janela (spec #9353). O resto roda aqui mesmo.
      return runAgent(rest, data, (msg) => request(data, msg));
    default:
      console.error(USAGE);
      return EXIT.usage;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
