// Real CLI/IPC with an inert Bun fixture. Never starts the Swift helper or opens UI.
import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { request } from "../../scripts/cli.ts";
import { tempDir } from "../../test/tmp.ts";
const app = path.resolve(import.meta.dirname, "../..");
const helper = path.join(app, "test/helpers/supervisor-helper.ts");
/**
 * O headless de um teste, com o CLI de verdade. O `run` tem o próprio prazo, menor que o do teste (T22227): se o teste
 * estourasse o do `bun test`, o `finally` não rodava, e o headless e o helper falso ficavam vivos, caindo e subindo de
 * novo, e pesando nos testes seguintes.
 */
async function rig(
  mode: "crash" | "hang",
  deadlineMs: number,
  run: (
    cli: (...args: string[]) => Promise<any>,
    data: string,
  ) => Promise<void>,
) {
  const data = tempDir("kn-supervisor-");
  const cli = async (...args: string[]) => {
    const proc = Bun.spawn(
      [
        process.execPath,
        path.join(app, "scripts/cli.ts"),
        ...args,
        "--data",
        data,
      ],
      {
        cwd: app,
        env: {
          ...process.env,
          KIWI_HELPER: helper,
          KIWI_FAKE_SUPERVISOR: mode,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0) throw new Error(`${args.join(" ")}: ${out} ${err}`);
    return JSON.parse(out);
  };
  try {
    await cli("start");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`rig: o teste passou de ${deadlineMs} ms`)), deadlineMs);
    });
    try {
      await Promise.race([run(cli, data), late]);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    try {
      await cli("stop");
    } catch (e) {
      if (!String(e).includes("E_NOT_RUNNING")) throw e;
    }
    rmSync(data, { recursive: true, force: true });
  }
}
/**
 * Espera o status do headless pelo socket de controle, neste processo (T22227). Cada `cli status` sobe um Bun inteiro
 * (~1 s, 3 s a frio); a cada 60 ms, com outros testes rodando, a espera passava dos 25 s só nesses processos. O CLI de
 * verdade segue no `start`, no `stop`, no `invoke` e na última conferência do status.
 */
async function waitStatus(
  data: string,
  check: (value: any) => boolean,
  timeout = 40000,
) {
  const until = Date.now() + timeout;
  let value: any;
  do {
    value = ((await request(data, { cmd: "status" }, 2000)) as { value?: unknown } | null)?.value;
    if (value && check(value)) return value;
    await Bun.sleep(100);
  } while (Date.now() < until);
  throw new Error(`status deadline: ${JSON.stringify(value)}`);
}
/** O `headless.out` quando ele já tem a linha esperada; no prazo, devolve o que tiver, e o `expect` mostra o que faltou. */
async function waitLog(data: string, line: RegExp, timeout = 5000) {
  const file = path.join(data, "headless.out");
  const until = Date.now() + timeout;
  let log = readFileSync(file, "utf8");
  while (!line.test(log) && Date.now() < until) {
    await Bun.sleep(30);
    log = readFileSync(file, "utf8");
  }
  return log;
}
test("CLI: five ready/crash cycles stop and show the real tray warning; exits reach diagnostics", async () => {
  // O mínimo é o backoff de verdade (0,5 + 1 + 2 + 4 s) e cinco helpers que sobem; numa máquina cheia, cada processo
  // do Bun (o helper e cada chamada do CLI) leva de 1 a 3 s. O prazo cobre isso, e o `stop` cabe depois dele.
  await rig("crash", 45000, async (cli, data) => {
    const status = await waitStatus(data, (s) => s.helper === "failed");
    expect(status.menuLabel).toBe("O ditado está com problema");
    expect(status.session.supervision).toMatchObject({
      state: "failed",
      crashes: 5,
    });
    const log = readFileSync(path.join(data, "headless.out"), "utf8");
    expect(log.match(/supervisor spawn pid=/g)?.length).toBe(5);
    expect(log.match(/supervisor exit .*exitCode=7 signal=none/g)?.length).toBe(
      5,
    );
    expect(log).toContain("supervisor failed");
    expect(readFileSync(path.join(data, "logs/kiwi.log"), "utf8")).toContain(
      "exitCode=7 signal=none",
    );
    const saved = await cli("invoke", "diagnostics.save", "{}");
    const diagnostic = readFileSync(saved.value.path, "utf8");
    expect(diagnostic).toContain("supervisor: failed");
    expect(diagnostic).toContain("quedas desde que o app abriu: 5");
    await Bun.sleep(150);
    expect((await cli("status")).value.helper).toBe("failed");
  });
}, 60000);
test("CLI: stop kills an actual fake process that ignores SIGTERM and socket close", async () => {
  await rig("hang", 22000, async (cli, data) => {
    await waitStatus(data, (s) => s.helper === "ready");
    const before = readFileSync(path.join(data, "headless.out"), "utf8");
    const pid = Number(before.match(/supervisor spawn pid=(\d+)/)?.[1]);
    expect(pid).toBeGreaterThan(0);
    await cli("stop");
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      try {
        process.kill(pid, 0);
      } catch {
        break;
      }
      await Bun.sleep(30);
    }
    expect(() => process.kill(pid, 0)).toThrow();
    // A linha `supervisor exit` sai no `proc.exited` do headless, um instante depois de o pid sumir; num runner lento,
    // ler o log uma vez só chegava antes dela (issue #403). Espera a linha, com prazo.
    const log = await waitLog(data, /supervisor exit .*signal=SIGKILL/);
    expect(log).toContain("signal=SIGKILL reason=stop");
    expect(log).toMatch(/supervisor exit .*signal=SIGKILL/);
  });
}, 35000);
