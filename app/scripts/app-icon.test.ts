// T4411: a fonte v2 aprovada na grade do Channels e o iconset com todos os tamanhos. Sem navegador.

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { GRID, iconSvg, iconsetFiles } from "./app-icon.ts";

const app = path.resolve(import.meta.dirname, "..");

test("a v2 aprovada fica embutida sem rede, na base preta de 824 e raio 185", () => {
  const source = readFileSync(path.join(app, "..", "docs/brand/kiwi-cat/gerada/kiwi-cat-candidata-v2.png"));
  const svg = iconSvg(source);
  expect(svg).toContain('x="100" y="100" width="824" height="824" rx="185"');
  expect(svg).toContain('fill="#000"');
  expect(svg).toContain('clip-path="url(#base)"');
  expect(svg).toContain('preserveAspectRatio="xMidYMid slice"');
  expect(svg).toContain(`href="data:image/png;base64,${source.toString("base64")}"`);
  expect(GRID.inset * 2 + GRID.base).toBe(GRID.canvas);
});

test("o iconset tem 16, 32, 128, 256 e 512 em 1x e 2x (até 1024), e o commitado bate com o gerador", () => {
  const files = iconsetFiles();
  expect(files.map((f) => f.px).sort((a, b) => a - b)).toEqual([16, 32, 32, 64, 128, 256, 256, 512, 512, 1024]);
  for (const f of files) expect(existsSync(path.join(app, "build-config", "icon.iconset", f.name))).toBe(true);
  // A fonte v2 é exatamente a aprovada; ninguém trocou a imagem nem esqueceu de gerar.
  const svg = readFileSync(path.join(app, "build-config", "icon.svg"), "utf8");
  expect(svg).toBe(iconSvg());
  expect(svg).toContain('href="../../docs/brand/kiwi-cat/gerada/kiwi-cat-candidata-v2.png"');
  expect(svg).not.toContain("base64");
});
