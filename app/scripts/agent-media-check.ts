// A prova de que falar com o Kiwi-cat abaixa a mídia e devolve (spec #17697, T18410), pelo helper de verdade em
// `--headless` com KIWI_DEBUG=1: o mic é o silencioso (nenhum dispositivo abre) e o volume é o falso, que começa em
// 0,60 e só escreve no log. Nada toca no som do Mac. Para cada fim da fala (soltar, cancelar, o mic que cai), o log
// do helper tem que dizer que o volume desceu ao começar e voltou a 0,60 no fim.
//
//   bun scripts/agent-media-check.ts            (precisa do `swift build` em native/)
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Sidecar } from "../src/bun/sidecar.ts";

const app = path.resolve(import.meta.dirname, "..");
const helper = process.env.KIWI_HELPER ?? path.join(app, "..", "native", ".build", "debug", "kiwi-helper");
if (!existsSync(helper)) throw new Error(`sem o helper em ${helper}: rode \`swift build\` em native/`);

const dir = mkdtempSync(path.join(os.tmpdir(), "kiwi-media-"));
const sidecar = new Sidecar({
  helper,
  socketPath: path.join(dir, "s.sock"),
  env: { KIWI_HEADLESS: "1", KIWI_DEBUG: "1" },
  log: () => {},
});
const lines: string[] = [];
const events: string[] = [];
sidecar.on("*", (e) => {
  const ev = e as { type: string; message?: string };
  events.push(ev.type);
  if (ev.type === "log" && ev.message?.startsWith("media")) lines.push(ev.message);
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(what: string, ok: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`não chegou: ${what}`);
    await wait(50);
  }
}
const lowered = (l: string) => /^media: volume 0\.60 → 0\.(?!60)\d\d/.test(l);
const restored = (l: string) => /→ 0\.60/.test(l);

let failed = false;
try {
  sidecar.start();
  await sidecar.whenReady();
  for (const [end, how] of [["stop", "soltar"], ["cancel", "cancelar"], ["drop", "o mic cai"]] as const) {
    lines.length = 0;
    events.length = 0;
    await sidecar.request({ type: "debug.agentRecording", action: "start" });
    await until("o volume descer", () => lines.some(lowered), 3_000).catch(() => {});
    await wait(400); // um pouco de "fala" (silêncio)
    const down = lines.some(lowered);
    await sidecar.request({ type: "debug.agentRecording", action: end });
    const ended = end === "cancel" ? "agent.record.cancelled" : "agent.record.stopped";
    await until(ended, () => events.includes(ended), 15_000);
    await until("o volume voltar", () => lines.some(restored), 3_000).catch(() => {});
    const up = lines.some(restored);
    const ok = down && up && lines.length >= 2;
    failed ||= !ok;
    console.log(`${ok ? "ok" : "FALHOU"} ${how}: ${lines.join(" | ") || "(nada no log da mídia)"}`);
  }
} finally {
  await sidecar.stop();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
