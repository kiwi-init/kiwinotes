// O canal **local** de UI (T1192): serve .ui-channel/ em 127.0.0.1, só para dev. O app só olha para ele com
// `KIWI_UI_CHANNEL=http://127.0.0.1:5179`; sem a variável, o canal fica desligado e nada é consultado.
//
//   bun scripts/ui-serve.ts [porta]

import { existsSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", ".ui-channel");
const port = Number(process.argv[2] ?? 5179);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request) {
    const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || !existsSync(file) || !statSync(file).isFile()) return new Response("not found", { status: 404 });
    return new Response(Bun.file(file), { headers: { "cache-control": "no-store" } });
  },
});
console.log(`ui-serve: ${root} em http://127.0.0.1:${server.port}`);
