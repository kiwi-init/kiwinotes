// Prints dos protótipos (spec #12550): WebKit headless, 1380x820 em 2x, sem rede (só o servidor local).
//   bun shoot.ts <pasta do protótipo> <saída> skill1,skill2 [nota,aparencia,balao] [light,dark]
import { webkit } from "playwright-core";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
const [dir, out, skills, screens = "nota,aparencia,balao", themes = "light,dark"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (r) => { const p = decodeURIComponent(new URL(r.url).pathname); return new Response(Bun.file(join(dir, p === "/" ? "proto.html" : p))); } });
const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1380, height: 820 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
await ctx.route("**/*", (route) => route.request().url().startsWith(`http://127.0.0.1:${server.port}/`) ? route.continue() : route.abort());
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
for (const s of skills!.split(",")) for (const sc of screens.split(",")) for (const t of themes.split(",")) {
  await page.goto(`http://127.0.0.1:${server.port}/proto.html?skill=${s}&screen=${sc}&theme=${t}`);
  await page.evaluate(() => document.fonts.ready);
  await Bun.sleep(150);
  await page.screenshot({ path: join(out, `${s}-${sc}-${t}.png`) });
}
console.log(errors.length ? errors.join("\n") : "ok");
await browser.close(); server.stop();
