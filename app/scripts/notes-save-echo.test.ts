// T6374: a gravação da própria janela volta pelo `notes.changed` antes da resposta do `notes.save` (o vault de mentira
// avisa dentro do save, como o watcher pode avisar antes da resposta pelo socket). O `applyMerged` deixava o pending
// em null, e o save lia esse null como digitação: a nota ficava suja, e sair dela (trocar de nota, renomear) regravava
// três vezes e desistia. Roda o build de verdade no WebKit headless, contra um engine que é o `MockVault`.

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { webkit } from "playwright-core";

import { MockVault } from "../ui/notes/mock.ts";
import { runUi } from "./cli-ui.ts";
import { ensureBuild, type UiContext } from "./ui-page.ts";

const hasWebkit = (() => {
  try {
    return existsSync(webkit.executablePath());
  } catch {
    return false;
  }
})();

type Msg = Record<string, unknown>;
type Args = { path?: string; content?: string; baseVersion?: string; query?: string; limit?: number; link?: string };

function vaultCtx(data: string) {
  const vault = new MockVault();
  const saves: string[] = [];
  const listeners = new Set<(m: Msg) => void>();
  vault.onChanged((paths) => listeners.forEach((l) => l({ event: "notes.changed", payload: { paths } })));
  const caps: Record<string, (a: Args) => Promise<unknown> | unknown> = {
    "settings.get": () => ({}),
    "notes.folder": () => {
      const internal = { id: "internal", key: "internal", path: data, name: "Notas" };
      return { current: internal, internal, recent: [], progress: { phase: "idle", path: data, seen: 0, notes: 0 } };
    },
    "notes.list": () => vault.list(),
    "notes.get": (a) => vault.get(a.path ?? ""),
    // O aviso sai dentro do save; a resposta espera, para o aviso chegar à página antes dela.
    "notes.save": async (a) => {
      saves.push(a.path ?? "");
      const r = await vault.save(a.path ?? "", a.content ?? "", a.baseVersion ?? "");
      await Bun.sleep(300);
      return r;
    },
    "notes.backlinks": (a) => vault.backlinks(a.path ?? ""),
    "notes.search": (a) => vault.search(a.query ?? "", a.limit),
    "notes.resolve": (a) => vault.resolve(a.link ?? ""),
  };
  const ctx: UiContext = {
    data,
    send: async (msg) => {
      if (msg.cmd === "status") return { ok: true, value: { helper: "off" } };
      const fn = caps[String(msg.cap)];
      if (!fn) return { ok: false, code: "E_NO_CAPABILITY", message: String(msg.cap) };
      try {
        return { ok: true, value: await fn((msg.args ?? {}) as Args) };
      } catch (e) {
        return { ok: false, code: "E_ENGINE", message: String(e) };
      }
    },
    subscribe: async (_topics, onMsg) => {
      listeners.add(onMsg);
      return () => listeners.delete(onMsg);
    },
  };
  return { ctx, saves };
}

let dir = "";
let logs: string[] = [];
let spy: ReturnType<typeof spyOn> | undefined;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kn-save-echo-"));
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
  spy?.mockRestore();
  spy = undefined;
});

type Report = { steps: { ok: boolean; error?: string }[] };

describe.skipIf(!hasWebkit)("o save da própria janela volta pelo notes.changed antes da resposta", () => {
  // O `vite build` da janela fica fora do teto do teste (issue #396). Com o cache dele vazio, como no CI, o build leva
  // de 10 a 35 s e varia com a carga da máquina; quente, leva milissegundos. Com ele dentro do teto do teste, um
  // runner lento passava dos 60 s sem a troca de nota ter travado. Aqui ele tem um prazo próprio, e o tempo vai
  // para o log.
  beforeAll(() => {
    const t0 = performance.now();
    ensureBuild("notes");
    console.error(`notes-save-echo: build da janela notes em ${Math.round(performance.now() - t0)} ms`);
  }, 180_000);

  test("a nota fica limpa: trocar de nota não regrava nem trava", async () => {
    const { ctx, saves } = vaultCtx(dir);
    const script = join(dir, "save-echo.json");
    writeFileSync(
      script,
      JSON.stringify({
        window: "notes",
        steps: [
          { waitFor: ".cm-content" },
          { click: ".cm-content" },
          { press: "Meta+ArrowDown" },
          { type: " FIM" },
          { wait: 1500 },
          { press: "Meta+k" },
          { waitFor: ".kn-palette" },
          { type: "Caixa de entrada" },
          { wait: 300 },
          { press: "Enter" },
          { waitFor: "text=Ideias soltas", timeout: 5000 },
        ],
      }),
    );
    logs = [];
    spy = spyOn(console, "log").mockImplementation((m: unknown) => void logs.push(String(m)));
    const code = await runUi(["--note", "Pessoas/Ana.md", "--script", script, "--out", join(dir, "out")], ctx);
    const report = JSON.parse(logs.at(-1) ?? "{}") as Report;
    expect(report.steps.filter((s) => !s.ok)).toEqual([]);
    expect(code === 0 || code === 1).toBe(true);
    expect(saves).toEqual(["Pessoas/Ana.md"]);
    // Sem o build, o teste leva uns 4 s, e 12 s no pior caso medido com a máquina ocupada (o WebKit e as esperas do
    // script); o teto de 60 s fica só para ele.
  }, 60_000);
});
