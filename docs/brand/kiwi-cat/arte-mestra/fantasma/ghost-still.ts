// T10727: one ghost frame of each theme as a transparent PNG (the canvas itself), to paste on the hub at 120 px.
import { readFileSync, writeFileSync } from "node:fs";
const app = "/Users/davivicente/Documents/personal-projects/code-projects/kiwinotes-wt/T10727/app";
const { webkit } = await import(`${app}/node_modules/playwright-core`);
const here = import.meta.dir, out = process.argv[2]!, times = (process.argv[3] ?? "0.9").split(",").map(Number);
const sdf = JSON.parse(readFileSync(`${here}/sdf.json`, "utf8"));
const v2 = `data:image/png;base64,${readFileSync(`${here}/v2-800.png`).toString("base64")}`;
const b = await webkit.launch({ headless: true });
try {
  const p = await b.newPage({ viewport: { width: 1200, height: 526 } });
  await p.goto(`file://${here}/ghost.html`);
  await p.evaluate(([s, u]) => (window as any).init(s, u), [sdf, v2] as const);
  for (const t of times) {
    await p.evaluate(tt => (window as any).renderAt(tt), t);
    for (const [id, name] of [["cd", "dark"], ["cl", "light"]]) {
      const url: string = await p.evaluate(i => (document.getElementById(i) as HTMLCanvasElement).toDataURL("image/png"), id);
      const suffix = times.length > 1 ? `-${t}` : "";
      writeFileSync(`${out}/ghost-${name}${suffix}.png`, Buffer.from(url.split(",")[1]!, "base64"));
    }
  }
} finally { await b.close(); }
