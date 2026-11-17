// O peso do gato novo (T14773, spec #14755; desde o T14977, spec #14813, o gato do app em cada cadência): o mesmo script,
// nas mesmas condições. Da raiz do app, com o `kiwi lock bench`: `bun scripts/kiwicat-v2/peso.ts [pasta] [segundos]`.
//
// - Todos no WebKit headless do Playwright (o mesmo do `cli screenshot`), sem o app, o helper ou o microfone, numa
//   página servida em 127.0.0.1 com a CSP das janelas (VIEWS_CSP).
// - O mesmo tamanho: 240 × 240 px em DPR 2, como na tela Retina.
// - `pacote`: o ByteKiwiCat do pacote, sem mudança (60 quadros/s em todo estado). O gato do app (`ui/kiwicat/cat.ts`,
//   página `hoje.ts`): `overlay` com as opções do catoverlay/main.ts e `hub` com as do KiwiCat.tsx (os dois 30 ativos), `escondido` (`visibility(true)`) e `reduzido` (o reduzir movimento). Parado, os dois a 18.
// - Sem voz. `KIWI_RUNS=hub-repouso,…` roda só alguns; `KIWI_REPEAT` (padrão 3) é o número de rodadas.
// - Os mesmos segundos: 10 s de aquecimento e `segundos` (padrão 30) de amostra, uma página por vez.
// - fps: quadros desenhados por segundo (callback que chamou um draw do WebGL2). ms por quadro: o tempo de JS do
//   callback, mediana e p95. CPU: a soma dos processos do WebKit, em % de um núcleo, no intervalo da amostra.
//   O headless pinta em software: a CPU aqui é o pior caso, e vale para comparar os dois, não como número do app.
import { webkit } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "./servir";

const out = resolve(process.argv[2] ?? "/tmp/kiwicat-v2-peso");
const sampleSeconds = Number(process.argv[3] ?? 30);
const warmupSeconds = Number(process.env.KIWI_WARMUP ?? 10);
const size = 240;
// O pacote (`novo`) como veio; o gato do app (`app`) em cada estado de cadência (T14977): o repouso, o ativo no
// overlay e no hub (30), escondido e com o reduzir movimento.
type Run = { cat: "app" | "novo"; label: string; state: string; host?: "hub" | "overlay"; escondido?: boolean; parado?: boolean };
const runs: Run[] = [
  { cat: "novo", label: "pacote", state: "repouso" },
  { cat: "novo", label: "pacote", state: "pensando" },
  { cat: "app", label: "hub", state: "repouso", host: "hub" },
  { cat: "app", label: "overlay", state: "repouso", host: "overlay" },
  { cat: "app", label: "overlay", state: "ouvindo", host: "overlay" },
  { cat: "app", label: "overlay", state: "thinking", host: "overlay" },
  { cat: "app", label: "hub", state: "thinking", host: "hub" },
  { cat: "app", label: "escondido", state: "thinking", host: "overlay", escondido: true },
  { cat: "app", label: "reduzido", state: "thinking", host: "overlay", parado: true },
].filter((r) => !process.env.KIWI_RUNS || process.env.KIWI_RUNS.split(",").includes(`${r.label}-${r.state}`));
mkdirSync(out, { recursive: true });

function processes() {
  const ps = Bun.spawnSync(["ps", "-Ao", "pid=,ppid=,time=,command="], { stdout: "pipe" });
  return new TextDecoder().decode(ps.stdout).trim().split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d:.]+)\s+(.*)$/.exec(line);
    if (!m) return [];
    const cpu = m[3]!.split(":").map(Number).reduce((a, v) => a * 60 + v, 0);
    return [{ pid: Number(m[1]), ppid: Number(m[2]), cpu, command: m[4]! }];
  });
}
const pct = (v: number[], q: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(s.length * q) - 1)] ?? 0; };
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

const servers = { app: await serve("hoje.ts"), novo: await serve("novo.tsx") };
const results: Array<Record<string, any>> = [];
const repeat = Math.max(1, Number(process.env.KIWI_REPEAT ?? 3));
try {
  for (let round_ = 1; round_ <= repeat; round_++) for (const run of runs) {
    const before = new Set(processes().map((p) => p.pid));
    const instance = await webkit.launchServer({ headless: true });
    const browser = await webkit.connect(instance.wsEndpoint());
    try {
      const context = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 2, reducedMotion: "no-preference" });
      const origin = servers[run.cat].url;
      await context.route("**/*", (r) => (new URL(r.request().url()).origin === origin ? r.continue() : r.abort()));
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      const extra = `${run.host ? `&host=${run.host}` : ""}${run.escondido ? "&escondido=1" : ""}${run.parado ? "&parado=1" : ""}`;
      await page.goto(`${origin}/?state=${run.state}&size=${size}${extra}`);
      await page.waitForFunction(() => (window as any).kiwiReady, null, { timeout: 30000 });
      await page.waitForTimeout(warmupSeconds * 1000);
      // Os processos do WebKit desta página: os novos do pacote do Playwright, depois do aquecimento. No macOS o
      // WebContent nasce do launchd (XPC), fora da árvore do browser: um WebKit de outro agente aberto no meio entra
      // na conta; por isso cada estado roda `KIWI_REPEAT` vezes (padrão 3) e vale a mediana (T14977).
      const owned = new Set(processes().filter((p) => !before.has(p.pid) && /ms-playwright\/webkit-/.test(p.command)).map((p) => p.pid));
      const cpuOf = () => new Map(processes().filter((p) => owned.has(p.pid)).map((p) => [p.pid, p.cpu]));
      await page.evaluate(() => (window as any).kiwiFrames.reset());
      const cpu0 = cpuOf(), t0 = performance.now();
      await page.waitForTimeout(sampleSeconds * 1000);
      const cpu1 = cpuOf(), seconds = (performance.now() - t0) / 1000;
      const flat: number[] = await page.evaluate(() => (window as any).kiwiFrames.read());
      const durations = flat.filter((_, i) => i % 2 === 1);
      const shot = resolve(out, `${run.label}-${run.state}.png`);
      await page.screenshot({ path: shot, omitBackground: false });
      const r = {
        round: round_, cat: run.cat, label: run.label, state: run.state, seconds: round(seconds, 1), processes: owned.size,
        fps: round(durations.length / seconds, 1),
        msPerFrameMedian: round(pct(durations, 0.5)), msPerFrameP95: round(pct(durations, 0.95)),
        cpuPercent: round(([...cpu1].reduce((a, [pid, c]) => a + Math.max(0, c - (cpu0.get(pid) ?? c)), 0) / seconds) * 100, 1), errors,
      };
      results.push(r);
      console.log(JSON.stringify(r));
    } finally {
      await browser.close();
      await instance.close();
    }
  }
} finally {
  servers.app.close();
  servers.novo.close();
}
// A mediana das rodadas de cada estado: a que vale (T14977).
const median = (v: number[]) => pct(v, 0.5);
const summary = runs.map((run) => {
  const rs = results.filter((r) => r.label === run.label && r.state === run.state);
  return {
    cat: run.cat, label: run.label, state: run.state, rounds: rs.length,
    fps: median(rs.map((r) => r.fps)), cpuPercent: median(rs.map((r) => r.cpuPercent)),
    cpuRange: [Math.min(...rs.map((r) => r.cpuPercent)), Math.max(...rs.map((r) => r.cpuPercent))],
    msPerFrameP95: median(rs.map((r) => r.msPerFrameP95)),
  };
});
for (const s of summary) console.log(`${s.label} ${s.state}: ${s.fps} fps, CPU ${s.cpuPercent}% (${s.cpuRange.join("–")})`);
const report = {
  task: "T14977", spec: 14813, browser: "Playwright WebKit headless", size: [size, size], dpr: 2,
  warmupSeconds, sampleSeconds, repeat, commit: new TextDecoder().decode(Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe" }).stdout).trim(),
  summary, results,
};
writeFileSync(resolve(out, "peso.json"), JSON.stringify(report, null, 2) + "\n");
console.log("peso.json em", out);
