// Latência da limpeza só com regras, sobre as fixtures: `bun src/cleanup/bench.ts`.
// A do LLM se mede no sidecar (o `ms` do `llm.complete`), porque depende do modelo.

import { fixtures } from "./fixtures.ts";
import { cleanupWithRules } from "./index.ts";

const ROUNDS = 200;
const dictionary = ["DICOM", "PACS", "Healthcare API", "kubectl", "Kiwi Notes"];
const run = () => {
  for (const f of fixtures) cleanupWithRules({ raw: f.raw, bundleId: f.bundleId, dictionary: f.dictionary ?? dictionary });
};

for (let i = 0; i < 20; i++) run();
const times: number[] = [];
for (let r = 0; r < ROUNDS; r++) {
  for (const f of fixtures) {
    const t0 = performance.now();
    cleanupWithRules({ raw: f.raw, bundleId: f.bundleId, dictionary: f.dictionary ?? dictionary });
    times.push(performance.now() - t0);
  }
}
times.sort((a, b) => a - b);
const at = (q: number) => times[Math.min(times.length - 1, Math.floor(times.length * q))]!.toFixed(3);
console.log(`${times.length} limpezas (${fixtures.length} fixtures × ${ROUNDS}): p50 ${at(0.5)} ms · p95 ${at(0.95)} ms · p99 ${at(0.99)} ms · máx ${at(1)} ms`);
