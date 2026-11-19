// O índice do conteúdo num Worker do Bun (P0 #23988, 2ª metade). O `TextIndex` roda aqui inteiro: o SQLite, a leitura
// dos arquivos, a extração do pdf, do docx e do xlsx e a tokenização do FTS5. A thread do main só manda a lista e recebe
// os achados (`text-index-client.ts`), e o histórico do Ditado e a colagem não esperam mais atrás de um lote.
//
// No app, o preBuild (`scripts/build-workers.ts`) junta este arquivo em `workers/text-index-worker.js`; no código-fonte
// (a CLI headless e os testes), o Bun roda o .ts.

import { heapStats } from "bun:jsc";

import { TextIndex } from "./text-index.ts";
import type { WorkerLog, WorkerReply, WorkerRequest } from "./text-index-client.ts";
import type { VaultFile } from "./vault.ts";

declare const self: Worker;

// O `console` do worker não passa pelo `teeConsole` do main: os erros e avisos daqui (uma passada que falhou no SQLite,
// na leitura ou na extração) iriam só ao stderr, fora do `kiwi.log`. Vão ao main, que os escreve pelo dele.
const text = (a: unknown) => (a instanceof Error ? a.message : typeof a === "string" ? a : Bun.inspect(a));
for (const level of ["error", "warn"] as const) {
  console[level] = (...args: unknown[]) => postMessage({ log: level, args: args.map(text) } satisfies WorkerLog);
}

let index: TextIndex | null = null;

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
      // O `sync` escolhe o que entra (`isIndexedFile`): o filtro de 250 mil caminhos fica aqui, não no main.
      return ready().sync(JSON.parse(m.json) as VaultFile[]);
    case "update": {
      const now = new Map(m.now.map((f) => [f.path, f]));
      return ready().update([...now.keys(), ...m.gone], (p) => now.get(p));
    }
    case "search": {
      // O arquivo como o banco o tem; o main confere com o de agora.
      const t = ready();
      return t.search(m.query, m.limit, (p) => t.stored(p));
    }
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
