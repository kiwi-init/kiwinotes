// preBuild (electrobun.config.ts): o ONNX Runtime da busca semântica (onnxruntime.ts), o worker do índice do conteúdo
// (build-workers.ts, P0 #23988) e depois o helper Swift (build-helper.ts, que pode sair do processo no caminho do cache).

import { buildWorkers } from "./build-workers.ts";
import { stageOnnxRuntime } from "./onnxruntime.ts";

for (const file of stageOnnxRuntime(process.cwd())) console.log(`pre-build: staged ${file}`);
for (const file of await buildWorkers(process.cwd())) console.log(`pre-build: built ${file}`);
await import("./build-helper.ts");
