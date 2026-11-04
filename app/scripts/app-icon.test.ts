// T2467: o ícone na grade do Channels, e o iconset com todos os tamanhos. Sem navegador: só o SVG e os nomes.

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { GRID, iconSvg, iconsetFiles } from "./app-icon.ts";

const app = path.resolve(import.meta.dirname, "..");

test("o Aura entra na base de 824 com 100 de margem, e o raio de dentro vira o 185 do Channels", () => {
  const svg = iconSvg('<svg viewBox="0 0 1024 1024"><rect id="bg" width="1024" height="1024" rx="224"/><g/></svg>');
  expect(svg).toContain(`<svg id="kiwi-cat" x="100" y="100" width="824" height="824" viewBox="0 0 1024 1024">`);
  expect(svg).toContain('rx="230"');
  expect(Math.round((230 * GRID.base) / GRID.canvas)).toBe(GRID.radius);
  expect(() => iconSvg("<svg><g/></svg>")).toThrow();
});

test("o iconset tem 16, 32, 128, 256 e 512 em 1x e 2x (até 1024), e o commitado bate com o gerador", () => {
  const files = iconsetFiles();
  expect(files.map((f) => f.px).sort((a, b) => a - b)).toEqual([16, 32, 32, 64, 128, 256, 256, 512, 512, 1024]);
  for (const f of files) expect(existsSync(path.join(app, "build-config", "icon.iconset", f.name))).toBe(true);
  // O icon.svg commitado é o que o gerador faz hoje do Aura (ninguém editou à mão nem esqueceu de rodar).
  const aura = readFileSync(path.join(app, "..", "docs", "brand", "kiwi-cat-familia", "kiwi-cat-1-aura.svg"), "utf8");
  expect(readFileSync(path.join(app, "build-config", "icon.svg"), "utf8")).toBe(iconSvg(aura));
});
