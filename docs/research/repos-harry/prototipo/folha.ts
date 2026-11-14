import { webkit } from "playwright-core";
import { join } from "node:path";
const [dir, out] = process.argv.slice(2);
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (r) => new Response(Bun.file(join(dir!, decodeURIComponent(new URL(r.url).pathname)))) });
const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 1 });
await ctx.route("**/*", (route) => route.request().url().startsWith(`http://127.0.0.1:${server.port}/`) ? route.continue() : route.abort());
const page = await ctx.newPage();
for (const t of ["light", "dark"]) {
  await page.goto(`http://127.0.0.1:${server.port}/folha.html?theme=${t}`);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(out!, `folha-${t}.png`), fullPage: true });
}
console.log("ok"); await browser.close(); server.stop();
