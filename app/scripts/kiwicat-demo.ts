// Standalone loopback demonstration; no engine, helper, notes or microphone.
import { resolve, basename } from "node:path";
import { writeFileSync } from "node:fs";
import { VIEWS_CSP } from "../src/bun/window-security.ts";
const app = resolve(import.meta.dir, "..");
export async function serveFogDemo(entry = "demo.ts") {
  const build = await Bun.build({
    entrypoints: [resolve(app, "ui/kiwicat", entry)],
    target: "browser",
    minify: true,
    loader: { ".webp": "file" },
    publicPath: "/",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!build.success) throw new Error(build.logs.join("\n"));
  const files = new Map(
    build.outputs.map((output) => [basename(output.path), output]),
  );
  const html =
    '<!doctype html><meta charset="utf-8"><title>Kiwi-cat · demo de teste</title><style>html,body{margin:0;background:#000;overflow:hidden}img,canvas{display:block}</style><div id="fog"></div><script type="module" src="/' +
    entry.replace(/\.ts$/, ".js") +
    '"></script>';
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/")
        return new Response(html, {
          headers: {
            "Content-Type": "text/html",
            "Content-Security-Policy": VIEWS_CSP,
          },
        });
      const file = files.get(path.slice(1));
      return file
        ? new Response(file, {
            headers: {
              "Content-Type": file.type,
              "Content-Security-Policy": VIEWS_CSP,
            },
          })
        : new Response("not found", { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    close: () => server.stop(true),
  };
}
if (import.meta.main) {
  const demo = await serveFogDemo();
  console.log(demo.url);
  if (process.argv[2]) writeFileSync(process.argv[2], demo.url + "\n");
}
