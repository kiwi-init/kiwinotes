// A prova da mídia durante a fala do gato (T26830, opção B, #28538), pelo helper de verdade em `--headless` com
// KIWI_DEBUG=1: a saída de voz é a silenciosa e o volume é o falso, que começa em 0,60, tem uma escala em dB de
// alto-falante (−60 dB a 0 dB) e só escreve no log. Nada toca no som do Mac, e nenhum mic abre.
// - A fala: `speech.duck` desce 6 dB (0,60 → 0,50), a voz leva ×2, a boca segue o 0,60 e `speech.unduck` devolve.
// - Um ditado do gato no meio da fala: a mídia da fala volta antes, e o ditado desce a partir do 0,60.
// - Com o mic gravando, a fala não desce nada.
//
//   bun scripts/speech-media-check.ts            (precisa do `swift build` em native/)
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Sidecar } from "../src/bun/sidecar.ts";
import { pcmBase64 } from "../src/bun/speech-output.ts";

const app = path.resolve(import.meta.dirname, "..");
const helper = process.env.KIWI_HELPER ?? path.join(app, "..", "native", ".build", "debug", "kiwi-helper");
if (!existsSync(helper)) throw new Error(`sem o helper em ${helper}: rode \`swift build\` em native/`);

const dir = mkdtempSync(path.join(os.tmpdir(), "kiwi-speech-media-"));
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
  if (ev.type === "log" && ev.message?.includes("media")) lines.push(ev.message);
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(what: string, ok: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`não chegou: ${what}`);
    await wait(50);
  }
}
/** As escritas do volume falso, `[de, para]`. */
const writes = () =>
  lines.flatMap((l) => {
    const m = l.match(/volume ([\d.]+) → ([\d.]+)/);
    return m ? [[Number(m[1]), Number(m[2])] as const] : [];
  });
const silencio = pcmBase64(new Int16Array(2400));

let failed = false;
function report(ok: boolean, what: string) {
  failed ||= !ok;
  console.log(`${ok ? "ok" : "FALHOU"} ${what}: ${lines.join(" | ") || "(nada no log da mídia)"}`);
}

try {
  sidecar.start();
  await sidecar.whenReady();

  // 1. A fala sozinha.
  lines.length = 0;
  const duck = (await sidecar.request({ type: "speech.duck" })) as { data: { gain: number } };
  const play = (await sidecar.request({ type: "speech.play", seq: 1, pcm: silencio })) as { data: { volume: number } };
  await sidecar.request({ type: "speech.unduck" });
  await until("o volume voltar", () => writes().length >= 2, 3_000).catch(() => {});
  {
    const w = writes();
    const ok =
      w.length === 2 &&
      w[0]![0] === 0.6 && w[0]![1] === 0.5 &&
      w[1]![0] === 0.5 && w[1]![1] === 0.6 &&
      Math.abs(duck.data.gain - 2) < 0.01 &&
      Math.abs(play.data.volume - 0.6) < 0.001;
    report(ok, `a fala (ganho ${duck.data.gain.toFixed(3)}, boca ${play.data.volume.toFixed(2)})`);
  }

  // 2. O ditado do gato começa no meio da fala.
  lines.length = 0;
  events.length = 0;
  await sidecar.request({ type: "speech.duck" });
  await sidecar.request({ type: "debug.agentRecording", action: "start" });
  await until("o ditado descer", () => writes().length >= 3, 3_000).catch(() => {});
  await sidecar.request({ type: "speech.unduck" }); // a fala acaba durante o ditado: nada muda
  await wait(200);
  const duranteDitado = writes().length;
  await sidecar.request({ type: "debug.agentRecording", action: "stop" });
  await until("agent.record.stopped", () => events.includes("agent.record.stopped"), 15_000);
  await until("o volume voltar", () => writes().at(-1)?.[1] === 0.6 && writes().length >= 4, 3_000).catch(() => {});
  {
    const w = writes();
    // 0,60 → 0,50 (a fala), 0,50 → 0,60 (a fala volta antes do mic), 0,60 → 0,15 (o ditado), 0,15 → 0,60.
    const ok =
      duranteDitado === 3 &&
      w.length === 4 &&
      w[1]![1] === 0.6 &&
      w[2]![0] === 0.6 && w[2]![1] === 0.15 &&
      w[3]![1] === 0.6;
    report(ok, "o ditado no meio da fala");
  }

  // 3. A fala com o mic gravando.
  lines.length = 0;
  events.length = 0;
  await sidecar.request({ type: "debug.agentRecording", action: "start" });
  await until("o ditado descer", () => writes().length >= 1, 3_000).catch(() => {});
  const gravando = (await sidecar.request({ type: "speech.duck" })) as { data: { gain: number } };
  await sidecar.request({ type: "speech.unduck" });
  await wait(200);
  const soDitado = writes().length;
  await sidecar.request({ type: "debug.agentRecording", action: "stop" });
  await until("agent.record.stopped", () => events.includes("agent.record.stopped"), 15_000);
  await until("o volume voltar", () => writes().length >= 2, 3_000).catch(() => {});
  report(soDitado === 1 && gravando.data.gain === 1 && writes().length === 2, "a fala com o mic gravando");
} finally {
  await sidecar.stop();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
