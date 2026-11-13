// A prova da página do gato no overlay (spec #9810), pelo caminho do helper: `kiwi-helper --cat-probe`, com a janela
// fora de todas as telas, sem mic, sem atalho e sem pedir permissão. Para cada desenho (WebGL2 e a imagem parada):
// - a página carrega só os arquivos do app (o esquema `kiwi-cat://`);
// - um fetch, um WebSocket e uma navegação para um servidor local são recusados, e o servidor não recebe nada;
// - o handler recusa um caminho fora da pasta;
// - do `show` ao primeiro quadro apresentado: no máximo 300 ms (cinco vezes), e a abertura a frio é informada.
//
//   bun scripts/kiwicat-overlay-probe.ts            (precisa do `swift build` em native/; constrói a página)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const app = path.resolve(import.meta.dirname, "..");
const helper = process.env.KIWI_HELPER ?? path.join(app, "..", "native", ".build", "debug", "kiwi-helper");
if (!existsSync(helper)) throw new Error(`sem o helper em ${helper}: rode \`swift build\` em native/`);
const page = path.join(app, "dist", "catoverlay");
const build = spawnSync("bun", ["x", "vite", "build"], { cwd: app, stdio: "ignore", env: { ...process.env, KIWI_UI_WINDOW: "catoverlay" } });
if (build.status !== 0 || !existsSync(path.join(page, "index.html"))) throw new Error("o build da página catoverlay falhou");

const hits: string[] = [];
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (r) => (hits.push(r.url), new Response("x")) });
let failed = false;
try {
  for (const backend of ["webgl2", "none"]) {
    const p = Bun.spawn([helper, "--cat-probe", page, "--backend", backend, "--blocked", `http://127.0.0.1:${server.port}/x`], { stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => p.kill(), 60_000);
    const out = await new Response(p.stdout).text();
    clearTimeout(timer);
    const code = await p.exited;
    const line = out.trim().split("\n").at(-1) ?? "{}";
    const r = JSON.parse(line) as Record<string, unknown>;
    const ok = code === 0 && r.ok === true && hits.length === 0;
    failed ||= !ok;
    console.log(`${ok ? "ok" : "FALHOU"} ${backend}: ${line}`);
  }
  console.log(`servidor local: ${hits.length} acessos`);
} finally {
  server.stop(true);
}
process.exit(failed ? 1 : 0);
