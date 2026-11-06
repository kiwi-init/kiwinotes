// Real CLI/IPC with an inert Bun fixture. Never starts the Swift helper or opens UI.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const app = path.resolve(import.meta.dirname, "../..");
const helper = path.join(app, "test/helpers/supervisor-helper.ts");
async function rig(
  mode: "crash" | "hang",
  run: (
    cli: (...args: string[]) => Promise<any>,
    data: string,
  ) => Promise<void>,
) {
  const data = mkdtempSync(path.join(tmpdir(), "kn-supervisor-"));
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
    await run(cli, data);
  } finally {
    try {
      await cli("stop");
    } catch (e) {
      if (!String(e).includes("E_NOT_RUNNING")) throw e;
    }
    rmSync(data, { recursive: true, force: true });
  }
}
async function waitStatus(
  cli: (...args: string[]) => Promise<any>,
  check: (value: any) => boolean,
  timeout = 15000,
) {
  const until = Date.now() + timeout;
  let value: any;
  do {
    value = (await cli("status")).value;
    if (check(value)) return value;
    await Bun.sleep(60);
  } while (Date.now() < until);
  throw new Error(`status deadline: ${JSON.stringify(value)}`);
}
test("CLI: five ready/crash cycles stop and show the real tray warning; exits reach diagnostics", async () => {
  await rig("crash", async (cli, data) => {
    const status = await waitStatus(cli, (s) => s.helper === "failed");
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
}, 25000);
test("CLI: stop kills an actual fake process that ignores SIGTERM and socket close", async () => {
  await rig("hang", async (cli, data) => {
    await waitStatus(cli, (s) => s.helper === "ready");
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
    const log = readFileSync(path.join(data, "headless.out"), "utf8");
    expect(log).toContain("signal=SIGKILL reason=stop");
    expect(log).toMatch(/supervisor exit .*signal=SIGKILL/);
  });
}, 15000);
