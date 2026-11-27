// O headless usa sempre o agente falso (T32699, issue #461): sem env nenhuma, ele não procura nem roda o `claude` e o
// `agy` instalados, e o download não vai ao npm. O `claude` e o `agy` daqui são scripts de mentira num PATH tmp, que
// só marcam que rodaram; ficam na frente do PATH, então nem a prova com `KIWI_REAL_AGENT=1` chega a um programa de verdade.

import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_SETTINGS, type AppSettings } from "../store/settings.ts";
import { tempDir } from "../../test/tmp.ts";
import { appAgentService, NO_REGISTRY } from "./app-service.ts";

const dirs: string[] = [];
const oldPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = oldPath;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Uma pasta com o `claude` e o `agy` de mentira na frente do PATH, e o arquivo onde eles marcam que rodaram. */
function fakePath(): { d: string; marker: string } {
  const d = tempDir("kiwinotes-headless-agente-");
  dirs.push(d);
  const bin = path.join(d, "bin");
  mkdirSync(bin);
  const marker = path.join(d, "rodou.txt");
  for (const name of ["claude", "agy"]) {
    writeFileSync(path.join(bin, name), `#!/bin/sh\necho ${name} >> "${marker}"\necho "9.9.9 (Claude Code)"\n`);
    chmodSync(path.join(bin, name), 0o755);
  }
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  return { d, marker };
}

function service(d: string, env: Record<string, string>, agent: Partial<AppSettings["agent"]> = {}) {
  let settings: AppSettings = { ...DEFAULT_SETTINGS, agent: { ...DEFAULT_SETTINGS.agent, ...agent } };
  return appAgentService({
    data: path.join(d, "data"),
    settings: {
      load: async () => settings,
      update: async (f) => (settings = { ...settings, ...(f(settings) ?? {}) } as AppSettings),
    },
    env: { PATH: process.env.PATH, ...env },
  });
}

test("o headless sem env nenhuma não roda o claude nem o agy instalados: as conferências usam os falsos", async () => {
  const { d, marker } = fakePath();
  const st = await service(d, { KIWI_HEADLESS: "1" }).status(true);
  expect(existsSync(marker)).toBe(false);
  // Os falsos respondem: o Claude Code 2.1.322 e o agy 1.4.0, não o 9.9.9 do PATH.
  expect(st.claude?.version).toBe("2.1.322");
  expect(st.gemini?.version).toBe("1.4.0");
});

test("o KIWI_FAKE_AGENT=1 dos roteiros antigos dá o mesmo", async () => {
  const { d, marker } = fakePath();
  await service(d, { KIWI_HEADLESS: "1", KIWI_FAKE_AGENT: "1" }).status(true);
  expect(existsSync(marker)).toBe(false);
});

test("a prova: com KIWI_REAL_AGENT=1, o headless procura os do PATH (aqui, os de mentira)", async () => {
  const { d, marker } = fakePath();
  const st = await service(d, { KIWI_HEADLESS: "1", KIWI_REAL_AGENT: "1" }).status(true);
  expect(readFileSync(marker, "utf8")).toContain("claude");
  expect(st.claude?.version).toBe("9.9.9");
});

test("o download do headless sem KIWI_ADAPTER_REGISTRY não vai ao npm: cai na porta local fechada", async () => {
  const { d } = fakePath();
  expect(new URL(NO_REGISTRY).hostname).toBe("127.0.0.1");
  const s = service(d, { KIWI_HEADLESS: "1" }, { enabled: true, consented: true, kind: "claude" });
  await s.startDownload();
  let st = await s.status();
  for (let i = 0; i < 100 && st.adapter.phase === "downloading"; i++) {
    await Bun.sleep(20);
    st = await s.status();
  }
  expect(st.adapter.phase).toBe("error");
  expect(st.adapter.error?.code).toBe("E_ADAPTER_OFFLINE");
});
