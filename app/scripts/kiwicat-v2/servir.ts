// Serve uma página de teste do gato (hoje.ts ou novo.tsx) em 127.0.0.1, com a CSP das janelas (T14773).
import { basename, resolve } from "node:path";
import { VIEWS_CSP } from "../../src/bun/window-security.ts";

export async function serve(entry: string) {
  const build = await Bun.build({
    entrypoints: [resolve(import.meta.dir, entry)], target: "browser", minify: true,
    loader: { ".webp": "file" }, publicPath: "/", define: { "process.env.NODE_ENV": '"production"' },
    // O pacote do gato novo fica em docs/, fora do app: o React vem do node_modules do app.
    plugins: [{ name: "react-do-app", setup(b) {
      b.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (a) => ({ path: Bun.resolveSync(a.path, import.meta.dir) }));
    } }],
  });
  if (!build.success) throw new Error(build.logs.join("\n"));
  const files = new Map(build.outputs.map((o) => [basename(o.path), o]));
  const js = basename(build.outputs.find((o) => o.kind === "entry-point")!.path);
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#090a0e;overflow:hidden}</style><div id="cat"></div><script type="module" src="/${js}"></script>`;
  const headers = (type: string) => ({ "Content-Type": type, "Content-Security-Policy": VIEWS_CSP });
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/") return new Response(html, { headers: headers("text/html") });
      const file = files.get(path.slice(1));
      return file ? new Response(file, { headers: headers(file.type) }) : new Response("not found", { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, close: () => server.stop(true) };
}
