// Final predeclared full-resolution B1 run set: never discard repetitions.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";
const prefix = resolve(process.argv[2] ?? "/tmp/kiwi-T8487-B1-final2");
const out = resolve(process.argv[3] ?? "docs/brand/kiwi-cat/nevoa/final-b1/medidas-finais");
const runs = [1, 2, 3].map((repetition) => {
  const file = `${prefix}-r${repetition}/report.json`;
  return { repetition, file, data: JSON.parse(readFileSync(file, "utf8")) };
});
const first = runs[0]!.data;
for (const { repetition, data: r } of runs) {
  const cpu = r.processes.reduce((sum: number, p: any) => sum + p.cpuSecondsSampled, 0) / r.elapsedSampleSeconds * 100;
  if (r.measuredCommit !== first.measuredCommit ||
      JSON.stringify(r.source_sha256) !== JSON.stringify(first.source_sha256) ||
      r.densityScale !== 1 || r.idleFPS !== 2 || r.variant !== "B1" ||
      r.fixed || !r.noRecorder || r.backend !== "webgpu" || r.errors.length ||
      r.samples.length !== 60 || r.elapsedSampleSeconds < 60 || r.elapsedSampleSeconds > 61 ||
      r.cpuMeanMethod !== "totalCPU/elapsed" || Math.abs(cpu - r.cpuMean) > 1e-8 ||
      r.processes.length !== 5 || r.states.length !== 8 ||
      r.states.some((s: any) => s.slow || !Number.isFinite(s.fps)))
    throw new Error(`Invalid final repetition ${repetition}`);
}
const means = runs.map((r) => r.data.cpuMean),
  mean = means.reduce((a, b) => a + b, 0) / runs.length;
const f = (n: number) => n.toFixed(3);
const stateRows = first.states.map((s: any, i: number) => ({
  state: s.state,
  fps: runs.map((r) => r.data.states[i].fps),
  diagnosticCPU: runs.map((r) => r.data.states[i].cpuMeanDiagnostic ?? null),
}));
const processRows = runs.map(({ repetition, data: r }) => ({
  repetition,
  processes: r.processes.map((p: any) => ({
    role: p.command.includes("WebContent") ? "page" : p.command.includes("WebKit.GPU") ? "GPU" : p.command.includes("Networking") ? "networking" : p.command.includes("pw_run.sh") ? "launcher" : "browser",
    cpuPercent: p.cpuSecondsSampled / r.elapsedSampleSeconds * 100,
  })),
}));
const summary = {
  task: "T8487", scope: first.scope, measuredCommit: first.measuredCommit,
  source_sha256: first.source_sha256, browser: first.browser,
  size: first.size, dpr: first.dpr, variant: "B1", densityScale: 1, idleFPS: 2,
  warmupSeconds: 10, deadlineSeconds: 60, cpuUnit: first.cpuUnit,
  means, meanOfThree: mean, p95s: runs.map((r) => r.data.cpuP95),
  passes: mean < 3, criterion: "absolute mean of all three runs <3%; p95 separately reported",
  stateRows, processRows,
  activeCPUScope: "3-second diagnostic windows after 1-second settle, not the 60-second idle measure",
  baseline: "The fixed baseline at3/s is preserved in ../medidas-demanda; not subtracted from this absolute criterion",
};
mkdirSync(out, { recursive: true });
for (const r of runs) copyFileSync(r.file, join(out, `r${r.repetition}.json`));
writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
writeFileSync(join(out, "README.md"), [
  "# Medidas finais B1 — inteira, repouso 2/s", "",
  "WebKit headless, 640 × 800 / DPR 1; CPU em % de um núcleo, somando os cinco processos próprios. Cada execução aquece 10 s e mede 60 s por prazo monotônico, sem gravador nem outros testes simultâneos. Todos os brutos foram preservados.", "",
  "| Rodada | Média CPU | P95 CPU | Duração efetiva |",
  "| --- | --- | --- | --- |",
  ...runs.map((r) => `| ${r.repetition} | ${f(r.data.cpuMean)}% | ${f(r.data.cpuP95)}% | ${f(r.data.elapsedSampleSeconds)}s |`), "",
  `**Média das três: ${f(mean)}%. Critério absoluto <3%: ${mean < 3 ? "passou" : "não passou"}.** ${means.filter((n) => n >= 3).length} rodada(s) isolada(s) em ou acima de 3%; o aceite usa a média das três (#8651). P95 descreve os pulsos de 1 s e não substitui a média.`, "",
  "| Estado | FPS 1 | FPS 2 | FPS 3 |", "| --- | --- | --- | --- |",
  ...stateRows.map((s: any) => `| ${s.state} | ${s.fps.map(f).join(" | ")} |`), "",
  "FPS usa intervalos reais entre desenhos. CPU dos demais estados é diagnóstico de 3 s após 1 s de estabilização; os números completos estão no resumo e nos brutos. A [base parada da matriz anterior](../medidas-demanda/README.md) está preservada e não foi subtraída do critério absoluto.", "",
  "CPU por processo (% de um núcleo):", "",
  "| Rodada | Browser | Página | GPU | Rede | Launcher |", "| --- | --- | --- | --- | --- | --- |",
  ...processRows.map((r) => `| ${r.repetition} | ${["browser", "page", "GPU", "networking", "launcher"].map((role) => f(r.processes.find((p: any) => p.role === role)!.cpuPercent)).join(" | ")} |`), "",
  `Commit medido: ${first.measuredCommit}. Fontes e hashes no resumo. Os números valem só para a demonstração, **não para o WKWebView do app**. A gravação visual é outra execução.`, "",
].join("\n"));
console.log(JSON.stringify(summary, null, 2));
