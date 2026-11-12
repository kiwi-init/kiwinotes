// M1 Pro demo-only benchmark. Run with `kiwi lock bench`; never record video.
import { webkit } from "playwright-core";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { serveFogDemo } from "./kiwicat-demo";
const fixed = process.argv.includes("--fixed"),
  deadline = process.argv.includes("--deadline");
const idleFPS = Number(process.argv[3] ?? 3),
  cpuOnly = process.argv.includes("--cpu-only"),
  requestedBackend = process.argv.includes("--webgl2") ? "webgl2" : "auto";
const variant = process.env.KIWI_FOG_VARIANT === "B1" ? "B1" : "B2";
const densityScale = Number(process.env.KIWI_FOG_SCALE ?? 0.25);
const out = resolve(process.argv[2] ?? "/tmp/kiwi-T8487-bench");
mkdirSync(out, { recursive: true });
function processes() {
  const ps = Bun.spawnSync(["ps", "-Ao", "pid=,ppid=,time=,command="], {
    stdout: "pipe",
  });
  return new TextDecoder()
    .decode(ps.stdout)
    .trim()
    .split("\n")
    .flatMap((line) => {
      const m = /^\s*(\d+)\s+(\d+)\s+([\d:.]+)\s+(.*)$/.exec(line);
      if (!m) return [];
      const fields = m[3]!.split(":").map(Number);
      let cpu = 0;
      for (const v of fields) cpu = cpu * 60 + v;
      return [{ pid: Number(m[1]), ppid: Number(m[2]), cpu, command: m[4]! }];
    });
}
const before = new Set(processes().map((p) => p.pid));
const server = await serveFogDemo(),
  instance = await webkit.launchServer({ headless: true }),
  root = instance.process().pid!;
const browser = await webkit.connect(instance.wsEndpoint());
const owned = new Set<number>([root]);
function snapshot() {
  const all = processes();
  let added = true;
  while (added) {
    added = false;
    for (const p of all)
      if (owned.has(p.ppid) && !owned.has(p.pid)) {
        owned.add(p.pid);
        added = true;
      }
  }
  // WebKit's XPC auxiliaries may be reparented. Only include new auxiliaries
  // from the Playwright WebKit bundle, never other applications' WebKit.
  for (const p of all)
    if (
      !before.has(p.pid) &&
      /ms-playwright\/webkit-/.test(p.command) &&
      p.ppid === 1
    )
      owned.add(p.pid);
  return all.filter((p) => owned.has(p.pid));
}
const percentile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? 0;
};
const report: Record<string, any> = {
  task: "T8487",
  scope: "standalone Playwright WebKit demo, NOT Electrobun WKWebView",
  browser: browser.version(),
  size: [640, 800],
  dpr: 1,
  cpuUnit: "percent of one CPU core",
  warmupSeconds: 10,
  sampleSeconds: 60,
  idleFPS,
  fixed,
  samplingMode: deadline
    ? "monotonic 60-second deadline"
    : "60 one-second intervals plus probe overhead",
  densityScale,
  variant,
  source_sha256: Object.fromEntries(
    ["index.ts", "shader.ts", "state.ts", "demo.ts", "assets/source.json"].map(
      (file) => [
        file,
        new Bun.CryptoHasher("sha256")
          .update(readFileSync(resolve(import.meta.dir, "../ui/kiwicat", file)))
          .digest("hex"),
      ],
    ),
  ),
  requestedBackend,
  noRecorder: true,
  samples: [],
  states: [],
};
try {
  const context = await browser.newContext({
    viewport: { width: 640, height: 800 },
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
  });
  await context.route("**/*", (r) =>
    new URL(r.request().url()).origin === server.url ? r.continue() : r.abort(),
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(
    server.url +
      "/?mode=measure&variant=" +
      variant +
      "&densityScale=" +
      densityScale +
      "&idleFPS=" +
      idleFPS +
      "&backend=" +
      requestedBackend +
      (fixed ? "&parado=1" : ""),
  );
  await page.waitForFunction(() => (window as any).kiwiFogReady, null, {
    timeout: 30000,
  });
  report.backend = await page.evaluate(
    () => (window as any).kiwiFog.stats.backend,
  );
  if (report.backend === "webgl2")
    report.adapter = await page.evaluate(() => {
      const gl = document.querySelector("canvas")!.getContext("webgl2")!;
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        renderer: debug
          ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
        vendor: debug
          ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)
          : gl.getParameter(gl.VENDOR),
      };
    });
  await page.waitForTimeout(10000);
  console.log("CPU warmup complete; sampling60s");
  const cpuByPID = new Map<number, number>();
  let previous = new Map(snapshot().map((p) => [p.pid, p.cpu])),
    last = performance.now();
  const sampleStarted = last;
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        deadline
          ? Math.max(0, sampleStarted + (i + 1) * 1000 - performance.now())
          : 1000,
      ),
    );
    const current = snapshot(),
      now = performance.now();
    const cpu = current.reduce((sum, p) => {
      const delta = Math.max(0, p.cpu - (previous.get(p.pid) ?? p.cpu));
      cpuByPID.set(p.pid, (cpuByPID.get(p.pid) ?? 0) + delta);
      return sum + delta;
    }, 0);
    report.samples.push((cpu / ((now - last) / 1000)) * 100);
    previous = new Map(current.map((p) => [p.pid, p.cpu]));
    last = now;
    if ((i + 1) % 10 === 0) console.log("CPU samples", i + 1);
  }
  report.elapsedSampleSeconds = (last - sampleStarted) / 1000;
  report.cpuWeightedMean =
    ([...cpuByPID.values()].reduce((a, b) => a + b, 0) /
      report.elapsedSampleSeconds) *
    100;
  report.processes = snapshot().map((p) => ({
    pid: p.pid,
    ppid: p.ppid,
    command: p.command,
    cpuSecondsSampled: cpuByPID.get(p.pid) ?? 0,
  }));
  report.cpuArithmeticMean =
    report.samples.reduce((a: number, b: number) => a + b, 0) /
    report.samples.length;
  report.cpuMean = deadline ? report.cpuWeightedMean : report.cpuArithmeticMean;
  report.cpuMeanMethod = deadline
    ? "totalCPU/elapsed"
    : "mean of normalized per-interval rates";
  report.cpuP95 = percentile(report.samples, 0.95);
  const idle = await page.evaluate(() => (window as any).kiwiFog.stats);
  report.states.push({
    state: "repouso",
    draws: idle.draws,
    slow: idle.slow,
    fps:
      1 /
      (idle.intervals.reduce((a: number, b: number) => a + b, 0) /
        idle.intervals.length),
    p95FrameMs: percentile(idle.intervals, 0.95) * 1000,
  });
  for (const state of cpuOnly
    ? []
    : [
        "dormindo",
        "acordou",
        "ouvindo",
        "thinking",
        "agindo",
        "pronto",
        "erro",
      ]) {
    await page.evaluate(
      (s) =>
        (window as any).kiwiFog.update({
          estado: s,
          voz: s === "ouvindo" ? 0.7 : null,
        }),
      state,
    );
    await page.waitForTimeout(1000);
    const start = await page.evaluate(
      () => (window as any).kiwiFog.stats.intervals.length,
    );
    const diagnosticStart = performance.now(),
      diagnosticBefore = new Map(snapshot().map((p) => [p.pid, p.cpu]));
    await page.waitForTimeout(3000);
    const diagnosticAfter = snapshot(),
      diagnosticSeconds = (performance.now() - diagnosticStart) / 1000,
      diagnosticCPU =
        (diagnosticAfter.reduce(
          (sum, p) =>
            sum + Math.max(0, p.cpu - (diagnosticBefore.get(p.pid) ?? p.cpu)),
          0,
        ) /
          diagnosticSeconds) *
        100;
    const stats = await page.evaluate(() => (window as any).kiwiFog.stats),
      intervals = stats.intervals.slice(start);
    report.states.push({
      state,
      cpuDiagnosticSeconds: diagnosticSeconds,
      cpuMeanDiagnostic: diagnosticCPU,
      slow: stats.slow,
      fps:
        1 /
        (intervals.reduce((a: number, b: number) => a + b, 0) /
          intervals.length),
      p95FrameMs: percentile(intervals, 0.95) * 1000,
    });
    console.log(state, JSON.stringify(report.states.at(-1)));
  }
  report.errors = errors;
  await context.close();
} finally {
  await browser.close();
  await instance.close();
  server.close();
  writeFileSync(
    join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log("CPU mean/p95", report.cpuMean, report.cpuP95);
}
