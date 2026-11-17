// A imagem do gato na prévia da posição (Ajustes › Agente e o onboarding): `ui/kiwicat/assets/preview-cutout.webp`
// (T14885, spec #14813). O gato do app parado em repouso, na caixa do overlay (192 × 240, o gato quadrado embaixo), em
// 1× (como a de antes: a prévia mostra o gato com uns 70 px), com fundo transparente, pelo WebKit headless. Precisa do `cwebp`.
// Da raiz do app: `bun scripts/kiwicat-v2/preview.ts`.
import { webkit } from "playwright-core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serve } from "./servir";

const target = resolve(import.meta.dir, "../../ui/kiwicat/assets/preview-cutout.webp");
const server = await serve("gato-funcoes.ts");
const browser = await webkit.launch({ headless: true });
const dir = mkdtempSync(join(tmpdir(), "kn-preview-"));
try {
  const page = await browser.newPage({ viewport: { width: 192, height: 240 }, deviceScaleFactor: 1 });
  await page.goto(`${server.url}/?mode=capture&state=repouso&w=192&h=240`);
  await page.waitForFunction(() => (window as any).kiwiReady, null, { timeout: 30000 });
  await page.evaluate(() => {
    document.documentElement.style.background = document.body.style.background = "transparent";
    (window as any).kiwiCat.capture(2.5);
  });
  const png = join(dir, "preview.png");
  await page.screenshot({ path: png, omitBackground: true, clip: { x: 0, y: 0, width: 192, height: 240 } });
  const r = Bun.spawnSync(["cwebp", "-quiet", "-q", "90", "-alpha_q", "100", png, "-o", target]);
  if (r.exitCode !== 0) throw new Error(new TextDecoder().decode(r.stderr));
  console.log(target);
} finally {
  await browser.close();
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
