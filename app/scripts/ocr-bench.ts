// Mede o OCR na abertura de um cofre cheio de anexos (spec #12918, T13161): quanto o Bun fica parado ao pôr tudo na
// fila e ao conferir o cache (o hash de cada arquivo), com um helper de mentira que responde na hora. Numa pasta
// temporária: não toca no cofre de ninguém.
//
//   bun scripts/ocr-bench.ts [imagens] [pdfs grandes] [MB de cada pdf]
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { OcrIndex } from "../src/notes/ocr.ts";

const N = Number(process.argv[2] ?? 60000);
const BIG = Number(process.argv[3] ?? 5);
const MB = Number(process.argv[4] ?? 200);
const root = mkdtempSync(path.join(tmpdir(), "kiwi-ocr-bench-"));
const cacheDir = path.join(root, ".cache-ocr");
try {
  for (let i = 0; i < N; i++) {
    const d = path.join(root, `Docs ${i % 200}`, "Resources", "Images");
    if (i < 200) mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, `img-${i}.png`), `png ${i}`);
  }
  const big = Buffer.alloc(MB * 1024 * 1024, 7);
  mkdirSync(path.join(root, "Laudos"), { recursive: true });
  for (let i = 0; i < BIG; i++) {
    big.writeUInt32LE(i, 0);
    writeFileSync(path.join(root, "Laudos", `laudo-${i}.pdf`), big);
  }
  // O Bun parado: a maior volta atrasada de um relógio de 50 ms.
  let last = performance.now();
  let worst = 0;
  let stalls = 0;
  const timer = setInterval(() => {
    const t = performance.now();
    const late = t - last - 50;
    last = t;
    worst = Math.max(worst, late);
    if (late > 100) stalls++;
  }, 50);
  const run = async (label: string) => {
    worst = 0;
    stalls = 0;
    last = performance.now();
    const ocr = new OcrIndex({
      root,
      cacheDir,
      runner: { run: async (abs) => abs.map((file) => ({ file, text: "x", method: "fake", pages: 1, ms: 1 })) },
      enabled: async () => true,
      battery: async () => "",
      sleep: async () => {},
    });
    const t0 = performance.now();
    await ocr.scan();
    const queued = performance.now() - t0;
    await ocr.idle();
    const total = performance.now() - t0;
    await Bun.sleep(120);
    console.log(
      `${label}: fila em ${queued.toFixed(0)} ms, tudo em ${(total / 1000).toFixed(1)} s (${ocr.stats.read} lidos, ${ocr.stats.cached} do cache); ` +
        `o Bun parado: pior ${worst.toFixed(0)} ms, ${stalls} vezes acima de 100 ms`,
    );
  };
  console.log(`${N} imagens pequenas e ${BIG} PDFs de ${MB} MB`);
  await run("1ª abertura (nada no cache)");
  await run("2ª abertura (tudo no cache)");
  clearInterval(timer);
} finally {
  rmSync(root, { recursive: true, force: true });
}
