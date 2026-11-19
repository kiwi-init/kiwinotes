// O índice do conteúdo num Worker do Bun (P0 #23988, 2ª metade). O `TextIndex` roda aqui inteiro: o SQLite, a leitura
// dos arquivos, a extração do pdf, do docx e do xlsx e a tokenização do FTS5. A thread do main só manda a lista e recebe
// os achados (`text-index-client.ts`), e o histórico do Ditado e a colagem não esperam mais atrás de um lote.
//
// No app, o preBuild (`scripts/build-workers.ts`) junta este arquivo em `workers/text-index-worker.js`; no código-fonte
// (a CLI headless e os testes), o Bun roda o .ts.

import { heapStats } from "bun:jsc";

import { TextIndex } from "./text-index.ts";
import type { WorkerReply, WorkerRequest } from "./text-index-client.ts";
import type { VaultFile } from "./vault.ts";

declare const self: Worker;

let index: TextIndex | null = null;
/** O que a pasta tem agora, pelo que o main mandou: é o `stat` do índice aqui dentro. */
const files = new Map<string, VaultFile>();
const stat = (p: string) => files.get(p);

function ready(): TextIndex {
  if (!index) throw new Error("o índice ainda não abriu");
  return index;
}

async function run(m: WorkerRequest): Promise<unknown> {
  switch (m.op) {
    case "init":
      index = new TextIndex({ ...m.options, ...(m.pauseMs === 0 ? { pause: async () => {} } : {}) });
      return;
    case "sync":
      files.clear();
      for (const f of m.files) files.set(f.path, f);
      return ready().sync(m.files);
    case "update":
      for (const f of m.now) files.set(f.path, f);
      for (const p of m.gone) files.delete(p);
      return ready().update([...m.now.map((f) => f.path), ...m.gone], stat);
    case "search":
      return ready().search(m.query, m.limit, stat);
    case "idle":
      return ready().idle();
    case "stats":
      return { ...ready().stats, lastSearchBytes: ready().lastSearchBytes, heapBytes: heapStats().heapSize, mainThread: Bun.isMainThread };
    case "close":
      return index?.close();
  }
}

// Cada pedido responde pelo `id`. Um `sync` longo não segura os outros: a busca anda enquanto o lote indexa, como no main.
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const m = e.data;
  let reply: WorkerReply;
  try {
    reply = { id: m.id, value: await run(m) };
  } catch (err) {
    reply = { id: m.id, error: err instanceof Error ? err.message : String(err) };
  }
  postMessage(reply);
};
