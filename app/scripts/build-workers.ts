// preBuild: o worker do índice do conteúdo (P0 #23988) num .js só, em `.workers/`. O Electrobun junta só o
// `src/bun/index.ts`, e o Bun não segue o `new Worker(caminho)`: o `copy` do electrobun.config.ts põe este arquivo em
// `workers/` dentro do app, e o `textIndexWorkerScript` o acha ao lado do bundle.

import { rmSync } from "node:fs";
import path from "node:path";

export async function buildWorkers(app: string): Promise<string[]> {
  const out = path.join(app, ".workers");
  rmSync(out, { recursive: true, force: true });
  const r = await Bun.build({ entrypoints: [path.join(app, "src/notes/text-index-worker.ts")], outdir: out, target: "bun", minify: true });
  if (!r.success) throw new AggregateError(r.logs, "o worker do índice não compilou");
  return r.outputs.map((o) => o.path);
}

if (import.meta.main) for (const f of await buildWorkers(process.cwd())) console.log(`build-workers: ${f}`);
