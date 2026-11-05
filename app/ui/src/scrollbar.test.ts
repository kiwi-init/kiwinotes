// A barra de rolagem fina (T4505, spec #4497): a conta do polegar e o CSS que esconde a nativa. O comportamento na
// janela (aparece ao rolar, some depois, não ocupa espaço) é o `scripts/ui-scripts/barra-rolagem.json`.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { dragToScroll, SCROLLBAR_MIN_THUMB, thumbBox, trackLength, wheelPx } from "./scrollbar.ts";

const css = (p: string) => readFileSync(path.join(import.meta.dir, p), "utf8");

describe("o polegar", () => {
  test("conteúdo que cabe não tem barra", () => {
    expect(thumbBox(0, 300, 300, 296)).toBeNull();
    expect(thumbBox(0, 300.4, 300, 296)).toBeNull();
    expect(thumbBox(0, 0, 0, 296)).toBeNull();
  });

  test("o tamanho é a parte visível, e ele vai do topo ao fim do trilho", () => {
    expect(thumbBox(0, 1000, 250, 400)).toEqual({ offset: 0, length: 100 });
    expect(thumbBox(750, 1000, 250, 400)).toEqual({ offset: 300, length: 100 });
    expect(thumbBox(375, 1000, 250, 400)).toEqual({ offset: 150, length: 100 });
  });

  test("tem um mínimo num conteúdo longo, e não passa do trilho no rubber band", () => {
    const long = thumbBox(0, 100_000, 300, 296)!;
    expect(long.length).toBe(SCROLLBAR_MIN_THUMB);
    expect(thumbBox(-50, 1000, 250, 400)!.offset).toBe(0);
    expect(thumbBox(900, 1000, 250, 400)!.offset).toBe(300);
    expect(thumbBox(0, 1000, 250, 10)!.length).toBe(10);
  });

  test("arrastar o polegar até o fim do trilho rola até o fim", () => {
    expect(dragToScroll(300, 1000, 250, 400, 100)).toBe(750);
    expect(dragToScroll(150, 1000, 250, 400, 100)).toBe(375);
    expect(dragToScroll(10, 1000, 250, 100, 100)).toBe(0);
  });

  test("com os dois eixos, o arraste até o fim do trilho desenhado chega ao fim do conteúdo (revisão #4579)", () => {
    // A área 400×240 com conteúdo 1200×1000 do caso da revisão: o trilho vertical perde o canto do horizontal.
    const track = trackLength(240, true);
    expect(track).toBeLessThan(trackLength(240, false));
    const box = thumbBox(0, 1000, 240, track)!;
    expect(dragToScroll(track - box.length, 1000, 240, track, box.length)).toBe(760);
  });

  test("a roda sobre o polegar rola como na área: px, linhas ou páginas", () => {
    expect(wheelPx(120, 0, 400)).toBe(120);
    expect(wheelPx(3, 1, 400)).toBe(48);
    expect(wheelPx(1, 2, 400)).toBe(400);
  });
});

describe("o CSS", () => {
  test("a nativa some em todo o app, nos dois motores", () => {
    const base = css("styles/base.css");
    expect(base).toMatch(/\*\s*{\s*scrollbar-width:\s*none;/);
    expect(base).toMatch(/\*::-webkit-scrollbar\s*{\s*display:\s*none;/);
  });

  test("o polegar é fino, engrossa um pouco no hover e usa a cor fraca do tema", () => {
    const tokens = css("styles/tokens.css");
    const px = (name: string) => Number(new RegExp(`${name}:\\s*(\\d+)px;`).exec(tokens)?.[1]);
    expect(px("--scrollbar-size")).toBeLessThanOrEqual(4);
    expect(px("--scrollbar-size-hover")).toBeGreaterThan(px("--scrollbar-size"));
    expect(px("--scrollbar-size-hover")).toBeLessThanOrEqual(6);
    expect(tokens).toMatch(/--scrollbar-color:\s*color-mix\(in srgb, var\(--text\) \d+%, transparent\)/);
  });

  test("escondido, o polegar não pega o mouse (não bloqueia o clique na borda do conteúdo)", () => {
    const base = css("styles/base.css");
    expect(base).toMatch(/\.kn-scrollbars\s*{[^}]*pointer-events:\s*none/);
    expect(base).toMatch(/\.kn-scrollbar\.on\s*{[^}]*pointer-events:\s*auto/);
  });
});
