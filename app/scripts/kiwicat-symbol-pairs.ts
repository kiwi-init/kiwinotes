// T10437: three pairs per candidate, alternating order. Lease bench is required.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
const out = resolve(process.argv[2] ?? "/tmp/kiwi-T10437-cpu"); mkdirSync(out, { recursive: true });
const plan = [["baseline","symbols"],["symbols","baseline"],["baseline","symbols"]];
const rows: any[] = [];
for (let pair = 0; pair < plan.length; pair++) {
  const results: any[] = [];
  for (const [i, variant] of plan[pair]!.entries()) {
    const dir = join(out, `pair-${pair+1}-${i+1}-${variant}`);
    console.log(`pair${pair+1} ${i+1}/2 ${variant}`);
    const p = Bun.spawn([process.execPath, resolve(import.meta.dir, "kiwicat-symbol-bench.ts"), dir, variant!, "--cpu-only"], { stdout: "inherit", stderr: "inherit" });
    if (await p.exited !== 0) throw new Error(`profile failed: ${dir}`);
    const r = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
    results.push({ variant, mean: r.cpuMean, p95: r.cpuP95, dir });
  }
  const old = results.find(r => r.variant === "baseline")!;
  const fresh = results.find(r => r.variant !== "baseline")!;
  rows.push({ pair: pair+1, variant: fresh.variant, order: results.map(r => r.variant), baseline: old, candidate: fresh, delta: fresh.mean-old.mean });
  writeFileSync(join(out, "pairs.json"), JSON.stringify(rows, null, 2)+"\n");
  console.log(JSON.stringify(rows.at(-1)));
}
const median = (a: number[]) => { a.sort((x,y)=>x-y); return a[Math.floor(a.length/2)]!; };
const summary = ["symbols"].map(variant => { const samples = rows.filter(r => r.variant === variant); return { variant, pairs: samples.length, meanDelta: samples.reduce((n,r)=>n+r.delta,0)/samples.length, medianDelta: median(samples.map(r=>r.delta)), maxDelta: Math.max(...samples.map(r=>r.delta)), baselineMean: samples.reduce((n,r)=>n+r.baseline.mean,0)/samples.length, candidateMean: samples.reduce((n,r)=>n+r.candidate.mean,0)/samples.length, p95s: samples.map(r=>r.candidate.p95) }; });
writeFileSync(join(out, "summary.json"), JSON.stringify({ task: "T10437", protocol: "3 alternating pairs/candidate, 10s+60s, 640x800 DPR1, five owned WebKit processes, no capture", summary }, null, 2)+"\n");
console.log(JSON.stringify(summary));
