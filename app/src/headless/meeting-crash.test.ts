// T7444 (varredura de robustez): o helper cai no meio de uma reunião e volta. A gravação acabou (o `meetings.live` diz
// que não grava), mas a nota da reunião ficava sem `end` e com `duration: 0`, e a lista de Reuniões mostrava "gravando"
// para sempre, mesmo depois de reabrir o app. CLI e IPC de verdade, com um helper falso em Bun: nada de mic nem de janela.
import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tempDir } from "../../test/tmp.ts";

const app = path.resolve(import.meta.dirname, "../..");
const helper = path.join(app, "test/helpers/meeting-crash-helper.ts");

test("o helper cai no meio da reunião: a nota ganha o fim, e a lista não diz mais gravando", async () => {
  const data = tempDir("kn-meeting-crash-");
  const vault = path.join(data, "vault");
  mkdirSync(vault);
  chmodSync(helper, 0o755);
  const cli = async (...args: string[]) => {
    const proc = Bun.spawn([process.execPath, path.join(app, "scripts/cli.ts"), ...args, "--data", data], {
      cwd: app,
      env: { ...process.env, KIWI_HELPER: helper, KIWI_FAKE_STATE: path.join(data, "fake.state"), KIWI_TEST_NOTES_FOLDER: vault },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    if ((await proc.exited) !== 0) throw new Error(`${args.join(" ")}: ${out} ${err}`);
    return JSON.parse(out);
  };
  const until = async <T>(probe: () => Promise<T | undefined>, ms = 15_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await probe();
      if (v !== undefined) return v;
      if (Date.now() > end) throw new Error("deadline");
      await Bun.sleep(100);
    }
  };
  try {
    await cli("start");
    // O helper novo subiu (a queda passou), e as duas falas de antes da queda estão gravadas na nota.
    await until(async () => ((await cli("status")).value.session?.supervision?.crashes >= 1 && (await cli("status")).value.helper === "ready") || undefined);
    const note = await until(async () => {
      const list = (await cli("invoke", "meetings.list", "{}")).value.meetings;
      if (list.length !== 1) return undefined;
      const got = (await cli("invoke", "notes.get", JSON.stringify({ path: list[0].path }))).value;
      return got.content.includes("Segunda fala antes da queda.") ? got : undefined;
    });
    expect((await cli("invoke", "meetings.live", "{}")).value).toEqual({ recording: false });

    const [meeting] = (await cli("invoke", "meetings.list", "{}")).value.meetings;
    expect(meeting.path).toBe(note.path);
    expect(meeting.live).toBe(false);
    expect(meeting.end).not.toBeNull();
    expect(meeting.duration).toBeGreaterThan(0);
  } finally {
    await cli("stop").catch(() => {});
    rmSync(data, { recursive: true, force: true });
  }
}, 40_000);
