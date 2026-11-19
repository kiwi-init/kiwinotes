import { describe, expect, test } from "bun:test";
import { applyLiveEdits, liveEdits } from "./live-edits.ts";

/** Um gerador com semente, para o teste de propriedade sair igual em toda rodada. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = ["Ana", "Projeto X", "\n", "\n\n", "- item\n", "## Título\n", " ", "exemplo", "🥝", "é", "\r\n", "---\ntag: a\n---\n"];

function randomText(r: () => number, max: number): string {
  let s = "";
  const n = Math.floor(r() * max);
  for (let i = 0; i < n; i++) s += PIECES[Math.floor(r() * PIECES.length)];
  return s;
}

/** Muda o texto como uma escrita faria: troca, apaga e acrescenta pedaços em lugares soltos. */
function mutate(r: () => number, t: string): string {
  let s = t;
  const n = 1 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const at = Math.floor(r() * (s.length + 1));
    const len = Math.floor(r() * 12);
    s = s.slice(0, at) + (r() < 0.7 ? randomText(r, 5) : "") + s.slice(Math.min(s.length, at + len));
  }
  return s;
}

describe("liveEdits", () => {
  test("texto igual: nenhum trecho", () => {
    expect(liveEdits("Ana\n", "Ana\n")).toEqual([]);
  });

  test("acrescentar no fim: um trecho, só o texto novo", () => {
    expect(liveEdits("# Nota\n\nAna", "# Nota\n\nAna\n- novo")).toEqual([{ from: 11, to: 11, removed: "", inserted: "\n- novo" }]);
  });

  test("trocar uma palavra no meio: só a palavra", () => {
    const e = liveEdits("Linha 1\nO Projeto X vai bem\nLinha 3\n", "Linha 1\nO Projeto Y vai bem\nLinha 3\n");
    expect(e).toEqual([{ from: 18, to: 19, removed: "X", inserted: "Y" }]);
  });

  test("duas mudanças longe uma da outra: dois trechos, em ordem", () => {
    const before = "a\nb\nc\nd\ne\nf\n";
    const after = "A\nb\nc\nd\ne\nF\n";
    const e = liveEdits(before, after);
    expect(e.map((x) => [x.removed, x.inserted])).toEqual([["a", "A"], ["f", "F"]]);
    expect(e[0]!.from).toBeLessThan(e[1]!.from);
  });

  test("do vazio e para o vazio", () => {
    expect(liveEdits("", "Ana")).toEqual([{ from: 0, to: 0, removed: "", inserted: "Ana" }]);
    expect(liveEdits("Ana", "")).toEqual([{ from: 0, to: 3, removed: "Ana", inserted: "" }]);
  });

  test("não parte um emoji ao meio", () => {
    for (const e of liveEdits("x🥝y", "x🍋y")) {
      expect(e.removed).toBe("🥝");
      expect(e.inserted).toBe("🍋");
    }
  });

  test("propriedade: aplicar os trechos ao texto de antes dá o texto de depois", () => {
    const r = rng(20868);
    for (let i = 0; i < 3000; i++) {
      const before = randomText(r, 40);
      const after = r() < 0.15 ? randomText(r, 40) : mutate(r, before);
      const edits = liveEdits(before, after);
      expect(applyLiveEdits(before, edits)).toBe(after);
      let at = 0;
      for (const e of edits) {
        expect(e.from).toBeGreaterThanOrEqual(at);
        expect(e.removed).toBe(before.slice(e.from, e.to));
        expect(e.removed === "" && e.inserted === "").toBe(false);
        at = e.to;
      }
    }
  });

  test("uma nota grande reescrita inteira continua certa (cai num trecho só se precisar)", () => {
    const before = Array.from({ length: 4000 }, (_, i) => `linha ${i}\n`).join("");
    const after = Array.from({ length: 4000 }, (_, i) => `outra ${i}\n`).join("");
    const edits = liveEdits(before, after);
    expect(applyLiveEdits(before, edits)).toBe(after);
  });
});

describe("applyLiveEdits", () => {
  test("recusa trechos que não servem para o texto", () => {
    expect(applyLiveEdits("Ana", [{ from: 0, to: 3, removed: "Bia", inserted: "x" }])).toBeNull();
    expect(applyLiveEdits("Ana", [{ from: 2, to: 3, removed: "a", inserted: "" }, { from: 0, to: 1, removed: "A", inserted: "" }])).toBeNull();
    expect(applyLiveEdits("Ana", [{ from: 0, to: 9, removed: "Ana", inserted: "" }])).toBeNull();
  });
});
