// Aggregate all predeclared B1 runs; preserve every raw report, including misses.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";
const input = resolve(process.argv[2] ?? "/tmp");
const prefix = process.argv[4] ?? "kiwi-T8487-B1-approved";
const out = resolve(
  process.argv[3] ?? "docs/brand/kiwi-cat/nevoa/final-b1/medidas",
);
let fingerprint: string | undefined;
function read(label: string, repetition: number) {
  const name = `${prefix}-${label}-r${repetition}`,
    path = join(input, name, "report.json");
  const r = JSON.parse(readFileSync(path, "utf8"));
  const hashes = JSON.stringify(Object.entries(r.source_sha256).sort());
  fingerprint ??= hashes;
  if (
    hashes !== fingerprint ||
    r.variant !== "B1" ||
    r.backend !== "webgpu" ||
    r.errors?.length ||
    !r.noRecorder ||
    r.samples.length !== 60 ||
    r.elapsedSampleSeconds < 60 ||
    r.elapsedSampleSeconds > 61 ||
    r.cpuMeanMethod !== "totalCPU/elapsed" ||
    r.processes.length !== 5
  )
    throw new Error(`Invalid profile ${name}`);
  const sum =
    (r.processes.reduce((a: number, p: any) => a + p.cpuSecondsSampled, 0) /
      r.elapsedSampleSeconds) *
    100;
  if (Math.abs(sum - r.cpuMean) > 1e-8)
    throw new Error(`Incomplete process CPU ${name}`);
  const fixed = label === "base";
  if (
    Boolean(r.fixed) !== fixed ||
    r.states.length !== (fixed ? 1 : 8) ||
    (!fixed && r.states.some((s: any) => s.slow || !Number.isFinite(s.fps))) ||
    (fixed && r.states[0].draws !== 1)
  )
    throw new Error(`Invalid drawing behaviour ${name}`);
  return { name, path, repetition, report: r };
}
const baselines = [1, 2, 3].map((r) => read("base", r));
const configs = [1, 0.5, 0.25].map((scale) => {
  const runs = [1, 2, 3].map((r) => read(String(scale), r)),
    means = runs.map((r) => r.report.cpuMean);
  const mean = means.reduce((a, b) => a + b, 0) / 3,
    min = Math.min(...means),
    max = Math.max(...means);
  const states = runs[0]!.report.states.map((state: any, index: number) => ({
    state: state.state,
    fps: runs.map((r) => r.report.states[index].fps),
    cpuMeanDiagnostic: runs.map(
      (r) => r.report.states[index].cpuMeanDiagnostic ?? null,
    ),
    cpuDiagnosticSeconds: runs.map(
      (r) => r.report.states[index].cpuDiagnosticSeconds ?? null,
    ),
  }));
  const processes = runs.map((run) => ({
    repetition: run.repetition,
    items: run.report.processes.map((p: any) => ({
      role: p.command.includes("WebContent")
        ? "page"
        : p.command.includes("WebKit.GPU")
          ? "GPU-process"
          : p.command.includes("Networking")
            ? "networking"
            : p.command.includes("pw_run.sh")
              ? "launcher"
              : "browser",
      cpuPercent: (p.cpuSecondsSampled / run.report.elapsedSampleSeconds) * 100,
    })),
  }));
  return {
    scale,
    means,
    mean,
    min,
    max,
    p95s: runs.map((r) => r.report.cpuP95),
    deltaFromFixed: runs.map(
      (r, i) => r.report.cpuMean - baselines[i]!.report.cpuMean,
    ),
    passes: mean < 3,
    states,
    processes,
    runs,
  };
});
const eligible = configs
    .filter((c) => c.passes)
    .sort((a, b) => a.mean - b.mean),
  best = eligible[0],
  full = eligible.find((c) => c.scale === 1);
const fullOverlaps =
  full && best && Math.max(full.min, best.min) <= Math.min(full.max, best.max);
const proposedScale = fullOverlaps ? 1 : (best?.scale ?? null);
mkdirSync(out, { recursive: true });
for (const run of [...baselines, ...configs.flatMap((c) => c.runs)])
  copyFileSync(run.path, join(out, run.name + ".json"));
const summary = {
  task: "T8487",
  variant: "B1",
  scope: "standalone WebKit headless, NOT production WKWebView",
  measuredCommits: [
    ...new Set(
      [...baselines, ...configs.flatMap((c) => c.runs)].map(
        (r) => r.report.measuredCommit,
      ),
    ),
  ],
  source_sha256: Object.fromEntries(JSON.parse(fingerprint!)),
  browser: baselines[0]!.report.browser,
  size: [640, 800],
  dpr: 1,
  idleFPS: 3,
  warmupSeconds: 10,
  deadlineSeconds: 60,
  cpuUnit:
    "percent of one core; sum of own frozen browser/page/GPU/networking/launcher PIDs",
  baselines: baselines.map((r) => ({
    mean: r.report.cpuMean,
    p95: r.report.cpuP95,
    seconds: r.report.elapsedSampleSeconds,
    draws: r.report.states[0].draws,
    file: r.name + ".json",
  })),
  configs: configs.map(({ runs, ...c }) => ({
    ...c,
    reports: runs.map((r) => r.name + ".json"),
  })),
  proposedScale,
  requiresOptimization: proposedScale === null,
  selectionPolicy:
    "mean of3<3%; lowest mean; prefer full if eligible observed min/max ranges overlap; no repetitions discarded",
  activeCPU: "diagnostic3s after1s settle, not the60s idle measure",
};
writeFileSync(
  join(out, "summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
const f = (n: number) => n.toFixed(3);
const md = [
  "# CPU e FPS — B1",
  "",
  "Demonstração WebKit, 640×800/DPR1, repouso3/s. CPU em % de um núcleo, somando os cinco processos próprios. Cada execução aquece10s e usa prazo monotônico60s; a duração efetiva, incluindo a última consulta, fica em cada JSON. Nenhuma gravação ocorreu durante as medidas.",
  "",
  "| Escala | Média1 | Média2 | Média3 | Média das3 | P95 máximo | Média <3% |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...configs.map(
    (c) =>
      `| ${c.scale} | ${c.means.map(f).join(" | ")} | ${f(c.mean)} | ${f(Math.max(...c.p95s))} | ${c.passes ? "sim" : "não"} |`,
  ),
  "",
  `Base parada: ${baselines.map((r) => `${f(r.report.cpuMean)}%`).join(" / ")}; um desenho por execução. Diferenças para a base permanecem no JSON; o critério usa CPU absoluta.`,
  `Proposta de escala: ${proposedScale ?? "nenhuma; precisa otimizar"}. A preferência pela inteira só vale se sua média passar e as faixas observadas se sobrepuserem. Não é uma declaração de equivalência estatística.`,
  "",
  "CPU dos estados ativos tem janela diagnóstica de3s; FPS vem dos intervalos reais dos desenhos. P95 descreve pulsos de1s e não substitui a média. Os contadores por processo são da janela inteira: não atribuem a causa de cada pico. Todos os relatórios brutos e hashes foram preservados.",
  "",
];
writeFileSync(join(out, "README.md"), md.join("\n"));
console.log(
  JSON.stringify(
    {
      configs: configs.map(({ scale, mean, p95s, passes }) => ({
        scale,
        mean,
        p95s,
        passes,
      })),
      proposedScale,
    },
    null,
    2,
  ),
);
