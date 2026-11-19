// T20869 (spec #20843): o Kiwi escrevendo ao vivo. O roteiro sobre o EditorState e o tocador com um relógio falso.
import { describe, expect, test } from "bun:test";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { history, undoDepth } from "@codemirror/commands";

import {
  applyKiwiEdits, bodyEdits, KIWI_PACE, type KiwiClock, type KiwiEdit, kiwiWriteFrames, kiwiWriting, kiwiWritingExtension, kiwiWritingState,
  playKiwiWrite, typingChunks, writtenRanges,
} from "./kiwi-writing.ts";

const before = "# Lista de compras\n\nmaçã\nbanana\n\nFim.\n";
/** Troca "banana" por "pera e uva" e acrescenta uma linha no fim. */
const edits: KiwiEdit[] = [
  { from: before.indexOf("banana"), to: before.indexOf("banana") + 6, removed: "banana", inserted: "pera e uva" },
  { from: before.length, to: before.length, removed: "", inserted: "Comprar no sábado.\n" },
];
const after = applyKiwiEdits(before, edits);

const stateWith = (doc: string) => EditorState.create({ doc, extensions: [kiwiWritingExtension(), history()] });

const spec = (f: ReturnType<typeof kiwiWriteFrames>[number]): TransactionSpec => ({ ...(f.changes ? { changes: f.changes } : {}), effects: f.effects, annotations: kiwiWriting.of(true) });

function run(state: EditorState, frames: ReturnType<typeof kiwiWriteFrames>, upTo = frames.length): EditorState {
  for (const f of frames.slice(0, upTo)) state = state.update(spec(f)).state;
  return state;
}

describe("os trechos do contrato no texto do editor", () => {
  test("tira o frontmatter das posições", () => {
    const fm = "---\ntag: x\n---\n";
    const file = fm + before;
    const shifted = edits.map((e) => ({ ...e, from: e.from + fm.length, to: e.to + fm.length }));
    expect(bodyEdits(file, shifted, fm.length)).toEqual(edits);
  });

  test("um trecho no frontmatter, um removed que não bate ou trechos fora de ordem: null (recarrega como antes)", () => {
    const fm = "---\ntag: x\n---\n";
    expect(bodyEdits(fm + before, [{ from: 4, to: 7, removed: "tag", inserted: "tags" }], fm.length)).toBeNull();
    expect(bodyEdits(before, [{ ...edits[0]!, removed: "outra" }], 0)).toBeNull();
    expect(bodyEdits(before, [edits[1]!, edits[0]!], 0)).toBeNull();
  });
});

describe("o ritmo", () => {
  test("letra a letra num trecho curto", () => {
    const chunks = typingChunks("oi");
    expect(chunks.map((c) => c.text)).toEqual(["o", "i"]);
  });

  test("um trecho grande cabe no teto de ~2 s, e os pedaços juntos dão o texto", () => {
    const big = "Uma frase de exemplo, longa. ".repeat(200);
    const chunks = typingChunks(big);
    expect(chunks.map((c) => c.text).join("")).toBe(big);
    const total = chunks.reduce((s, c) => s + c.wait, 0);
    expect(total).toBeLessThanOrEqual(KIWI_PACE.maxPerEdit + chunks.length);
  });

  test("não parte um emoji no meio", () => {
    expect(typingChunks("a🥝b").map((c) => c.text)).toEqual(["a", "🥝", "b"]);
  });
});

describe("o roteiro", () => {
  test("no fim, o texto é o do disco, o cursor sumiu e o mexido está realçado", () => {
    const frames = kiwiWriteFrames(edits, false);
    const end = run(stateWith(before), frames);
    expect(end.doc.toString()).toBe(after);
    const k = kiwiWritingState(end);
    expect(k.phase).toBe("fading");
    expect(k.cursor).toBeNull();
    const text = k.highlights.map((h) => end.sliceDoc(h.from, h.to)).join("");
    expect(text).toBe("pera e uvaComprar no sábado.\n");
  });

  test("o cursor chega antes de mexer, o trocado esmaece e sai, e o novo entra aos poucos", () => {
    const frames = kiwiWriteFrames(edits, false);
    let s = stateWith(before);
    const seen: string[] = [];
    for (const f of frames) {
      s = s.update(spec(f)).state;
      const k = kiwiWritingState(s);
      if (k.removing) seen.push(`removendo:${s.sliceDoc(k.removing.from, k.removing.to)}`);
      if (k.phase === "writing") expect(k.cursor).not.toBeNull();
      seen.push(s.doc.toString().includes("banana") ? "antigo" : "novo");
    }
    expect(seen).toContain("removendo:banana");
    // Um estado do meio: "pera" já entrou e "uva" ainda não.
    const mid = frames.findIndex((_, i) => run(stateWith(before), frames, i + 1).doc.toString().includes("pera e") && !run(stateWith(before), frames, i + 1).doc.toString().includes("uva"));
    expect(mid).toBeGreaterThan(0);
  });

  test("com Reduzir movimento: um quadro só, sem cursor, com o realce", () => {
    const frames = kiwiWriteFrames(edits, true);
    expect(frames).toHaveLength(1);
    const end = run(stateWith(before), frames);
    expect(end.doc.toString()).toBe(after);
    const k = kiwiWritingState(end);
    expect(k.cursor).toBeNull();
    expect(k.phase).toBe("fading");
    expect(k.highlights.map((h) => end.sliceDoc(h.from, h.to))).toEqual(["pera e uva", "Comprar no sábado.\n"]);
  });

  test("propriedade: para trechos ao acaso, o fim do roteiro é o texto aplicado", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const base = "linha um\nlinha dois\nlinha três\n\nparágrafo final com 🥝\n";
    for (let n = 0; n < 200; n++) {
      const cuts = [Math.floor(rnd() * base.length), Math.floor(rnd() * base.length), Math.floor(rnd() * base.length), Math.floor(rnd() * base.length)].sort((a, b) => a - b);
      const safe = (i: number) => (/[\uDC00-\uDFFF]/.test(base[i] ?? "") ? i - 1 : i);
      const list: KiwiEdit[] = [];
      for (let i = 0; i < cuts.length; i += 2) {
        const from = safe(cuts[i]!), to = Math.max(from, safe(cuts[i + 1]!));
        if (list.length && from < list.at(-1)!.to) continue;
        list.push({ from, to, removed: base.slice(from, to), inserted: rnd() < 0.3 ? "" : `novo ${n}\n` });
      }
      const target = applyKiwiEdits(base, list);
      expect(run(stateWith(base), kiwiWriteFrames(list, false)).doc.toString()).toBe(target);
      expect(run(stateWith(base), kiwiWriteFrames(list, true)).doc.toString()).toBe(target);
    }
  });

  test("os trechos escritos ficam onde o texto final os tem", () => {
    expect(writtenRanges(edits).map((r) => after.slice(r.from, r.to))).toEqual(["pera e uva", "Comprar no sábado.\n"]);
  });
});

/** Um relógio que só anda quando o teste manda. */
function fakeClock() {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  const clock: KiwiClock = {
    set(fn, ms) {
      const id = next++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clear(id) {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = t.at;
      t.fn();
    }
    now = end;
  };
  return { clock, advance };
}

/** Uma view de mentira: o estado, o dispatch e um alvo de eventos (o bun test não tem DOM). */
function fakeView(doc: string) {
  const dom = new EventTarget();
  const v = {
    state: EditorState.create({ doc, extensions: [kiwiWritingExtension(), history()] }),
    dom,
    dispatch(spec: TransactionSpec) {
      v.state = v.state.update(spec).state;
    },
  };
  return v;
}
const key = (k: string) => Object.assign(new Event("keydown", { cancelable: true }), { key: k, metaKey: false });

describe("o tocador", () => {
  test("anda pelo relógio, termina no texto do disco e o realce some sozinho", async () => {
    const v = fakeView(before);
    const { clock, advance } = fakeClock();
    let ended = false;
    const h = playKiwiWrite(v as unknown as EditorView, edits, after, { reduced: false, clock, onEnd: () => (ended = true) });
    expect(kiwiWritingState(v.state).phase).toBe("writing");
    advance(200);
    expect(v.state.doc.toString()).not.toBe(after);
    advance(2500);
    await h.done;
    expect(ended).toBe(true);
    expect(v.state.doc.toString()).toBe(after);
    expect(kiwiWritingState(v.state).phase).toBe("fading");
    advance(KIWI_PACE.highlight + 10);
    expect(kiwiWritingState(v.state).phase).toBe("idle");
    expect(kiwiWritingState(v.state).highlights).toEqual([]);
  });

  test("uma tecla pula para o fim e devolve a nota; a tecla não escreve", async () => {
    const v = fakeView(before);
    const { clock, advance } = fakeClock();
    const h = playKiwiWrite(v as unknown as EditorView, edits, after, { reduced: false, clock });
    advance(400);
    const e = key("x");
    v.dom.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    await h.done;
    expect(v.state.doc.toString()).toBe(after);
    expect(kiwiWritingState(v.state).phase).toBe("fading");
    // A nota é da pessoa de novo: uma digitação entra.
    v.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input.type" });
    expect(v.state.doc.toString()).toBe("x" + after);
  });

  test("um clique pula também", async () => {
    const v = fakeView(before);
    const { clock, advance } = fakeClock();
    const h = playKiwiWrite(v as unknown as EditorView, edits, after, { reduced: false, clock });
    advance(300);
    v.dom.dispatchEvent(new Event("mousedown"));
    await h.done;
    expect(v.state.doc.toString()).toBe(after);
  });

  test("enquanto escreve, a nota é só de leitura (colar ou digitar por fora não entra)", () => {
    const v = fakeView(before);
    const { clock, advance } = fakeClock();
    playKiwiWrite(v as unknown as EditorView, edits, after, { reduced: false, clock });
    advance(100);
    const was = v.state.doc.toString();
    v.dispatch({ changes: { from: 0, insert: "colado" }, userEvent: "input.paste" });
    expect(v.state.doc.toString()).toBe(was);
  });

  test("o texto final é sempre o do disco, mesmo se os trechos não fecharem", async () => {
    const v = fakeView(before);
    const { clock, advance } = fakeClock();
    const disk = after + "linha que só o disco tem\n";
    const h = playKiwiWrite(v as unknown as EditorView, edits, disk, { reduced: false, clock });
    advance(20_000);
    await h.done;
    expect(v.state.doc.toString()).toBe(disk);
  });

  test("a escrita do Kiwi não entra no Desfazer do editor", async () => {
    const v = fakeView(before);
    v.dispatch({ changes: { from: 0, insert: "a" }, userEvent: "input.type" });
    const depth = undoDepth(v.state);
    const { clock, advance } = fakeClock();
    const at = (e: KiwiEdit) => ({ ...e, from: e.from + 1, to: e.to + 1 });
    const h = playKiwiWrite(v as unknown as EditorView, edits.map(at), "a" + after, { reduced: false, clock });
    advance(20_000);
    await h.done;
    expect(undoDepth(v.state)).toBe(depth);
  });

  test("uma segunda escrita na mesma nota termina a primeira antes", async () => {
    const v = fakeView(before);
    const { clock, advance } = fakeClock();
    const first = playKiwiWrite(v as unknown as EditorView, edits, after, { reduced: false, clock });
    advance(300);
    const more: KiwiEdit[] = [{ from: 0, to: 0, removed: "", inserted: "Topo\n" }];
    const second = playKiwiWrite(v as unknown as EditorView, more, applyKiwiEdits(after, more), { reduced: false, clock });
    await first.done;
    advance(20_000);
    await second.done;
    expect(v.state.doc.toString()).toBe("Topo\n" + after);
  });

  test("Reduzir movimento: o texto aparece de uma vez", async () => {
    const v = fakeView(before);
    const { clock } = fakeClock();
    const h = playKiwiWrite(v as unknown as EditorView, edits, after, { reduced: true, clock });
    expect(v.state.doc.toString()).toBe(after);
    expect(kiwiWritingState(v.state).cursor).toBeNull();
    await h.done;
  });
});
