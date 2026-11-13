// T10727: render the ghost prototype in headless WebKit. Usage: bun ghost-shoot.ts <out> [frames=1] [fps=30]
// [params-json]. Writes frame-XXXX.png (the 3-panel strip) and, with frames>1, a video.
import { readFileSync, mkdirSync } from "node:fs";
const app = "/Users/davivicente/Documents/personal-projects/code-projects/kiwinotes-wt/T10727/app";
const { webkit } = await import(`${app}/node_modules/playwright-core`);
const here = import.meta.dir;
const out = process.argv[2]!, frames = Number(process.argv[3] ?? 1), fps = Number(process.argv[4] ?? 30);
const params = process.argv[5] ? JSON.parse(process.argv[5]) : {};
mkdirSync(out, { recursive: true });
const sdf = JSON.parse(readFileSync(`${here}/sdf.json`, "utf8"));
const v2 = `data:image/png;base64,${readFileSync(`${here}/v2-800.png`).toString("base64")}`;
const b = await webkit.launch({ headless: true });
try {
  const p = await b.newPage({ viewport: { width: 1200, height: 526 }, deviceScaleFactor: 1 });
  const errors: string[] = []; p.on("pageerror", e => errors.push(String(e)));
  await p.goto(`file://${here}/ghost.html`);
  await p.evaluate(([s, u, pr]) => { Object.assign((window as any).PARAMS, pr); (window as any).init(s, u); }, [sdf, v2, params] as const);
  if (errors.length) throw new Error(errors.join("\n"));
  await p.waitForFunction(() => { const i = document.getElementById("v2") as HTMLImageElement; return i.complete && i.naturalWidth > 0; });
  for (let i = 0; i < frames; i++) {
    await p.evaluate(t => (window as any).renderAt(t), i / fps);
    await p.screenshot({ path: `${out}/frame-${String(i).padStart(4, "0")}.png` });
  }
} finally { await b.close(); }
