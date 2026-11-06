// preBuild (electrobun.config.ts): o ONNX Runtime da busca semântica (onnxruntime.ts) e depois o helper Swift
// (build-helper.ts, que pode sair do processo no caminho do cache).

import { stageOnnxRuntime } from "./onnxruntime.ts";

for (const file of stageOnnxRuntime(process.cwd())) console.log(`pre-build: staged ${file}`);
await import("./build-helper.ts");
