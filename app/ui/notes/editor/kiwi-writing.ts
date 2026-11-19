// O Kiwi escrevendo ao vivo na nota aberta (spec #20843, T20869). A escrita já foi aceita e gravada (o `agent.wrote`,
// T20868); aqui ela só se mostra: o cursor do Kiwi (um traço na cor dele com o rostinho e "Kiwi") vai a cada trecho,
// o texto trocado some, o novo se escreve letra a letra (no máximo ~2 s por trecho) e o mexido fica realçado e some.
//
// - O roteiro (`kiwiWriteFrames`) é puro: uma lista de quadros (mudanças, efeitos e a espera), testada sobre o
//   EditorState. Quem toca o relógio e a view é o `playKiwiWrite`.
// - Nada disto entra no Desfazer do editor (`addToHistory: false`): a escrita é do Kiwi, e o Desfazer dela é o do agente.
// - Durante a animação, a nota é só de leitura: um clique ou uma tecla da pessoa pula para o fim e devolve a nota.
// - O texto final é sempre o do disco: no fim (ou no pulo), o que a tela tiver de diferente vira o `final`.

import { Annotation, type ChangeSpec, EditorState, type Extension, RangeSet, StateEffect, StateField, Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { LiveEdit } from "../../../src/shared/live-edits.ts";
import { lineChanges } from "../../../src/shared/merge3.ts";

/** Um trecho trocado, em posições do texto de antes (o contrato do `agent.wrote`). */
export type KiwiEdit = LiveEdit;

/** O ritmo da escrita (ms). */
export const KIWI_PACE = {
  /** Uma letra; um trecho longo acelera para caber no teto. */
  perChar: 22,
  /** O teto de um trecho, por maior que seja (spec: "no máximo ~2 s"). */
  maxPerEdit: 2000,
  /** Um quadro. */
  frame: 16,
  /** O cursor parado no trecho antes de mexer. */
  arrive: 260,
  /** O texto trocado esmaecendo antes de sair. */
  removing: 260,
  /** O realce do trecho mexido, depois do fim: some aos poucos (o CSS) e sai daqui. */
  highlight: 3200,
} as const;

/** As transações do Kiwi: o editor não sobe isto como digitação da pessoa nem o filtro de só leitura barra. */
export const kiwiWriting = Annotation.define<true>();

const setCursor = StateEffect.define<number | null>({ map: (pos, change) => (pos === null ? null : change.mapPos(pos, 1)) });
const markRemoving = StateEffect.define<{ from: number; to: number } | null>({
  map: (r, change) => (r ? { from: change.mapPos(r.from, 1), to: change.mapPos(r.to, -1) } : null),
});
const addHighlight = StateEffect.define<{ from: number; to: number }>({
  map: (r, change) => ({ from: change.mapPos(r.from, -1), to: change.mapPos(r.to, 1) }),
});
const setPhase = StateEffect.define<KiwiPhase>();

/** `writing`: o Kiwi escreve (a nota é só de leitura); `fading`: o realce some; `idle`: nada. */
export type KiwiPhase = "writing" | "fading" | "idle";

interface KiwiView {
  phase: KiwiPhase;
  cursor: number | null;
  removing: { from: number; to: number } | null;
  highlights: DecorationSet;
}

const IDLE: KiwiView = { phase: "idle", cursor: null, removing: null, highlights: Decoration.none };

/**
 * Quando a última etiqueta saiu da tela. O CodeMirror refaz o widget a cada linha nova e a cada troca de fase; a entrada
 * da etiqueta só anima na primeira vez, senão ela pisca a cada quebra de linha (#21354).
 */
let tagGoneAt = -Infinity;
const TAG_STILL_MS = 600;

class KiwiCursorWidget extends WidgetType {
  constructor(readonly writing: boolean) {
    super();
  }
  override eq(other: KiwiCursorWidget): boolean {
    return other.writing === this.writing;
  }
  toDOM(): HTMLElement {
    const root = document.createElement("span");
    root.className = "kn-kiwi-cursor";
    root.setAttribute("aria-hidden", "true");
    const caret = document.createElement("span");
    caret.className = "kn-kiwi-caret";
    const tag = document.createElement("span");
    tag.className = performance.now() - tagGoneAt < TAG_STILL_MS ? "kn-kiwi-tag kn-kiwi-tag-still" : "kn-kiwi-tag";
    tag.append(kiwiFace(), document.createTextNode("Kiwi"));
    root.append(caret, tag);
    return root;
  }
  override ignoreEvent(): boolean {
    return true;
  }
  override destroy(): void {
    tagGoneAt = performance.now();
  }
}

/** O rostinho da etiqueta: quem desenha é a janela (o `setKiwiFace`), com o gato v2 na cor escolhida. */
let faceFactory: () => HTMLElement = () => {
  const dot = document.createElement("span");
  dot.className = "kn-kiwi-face";
  return dot;
};
function kiwiFace(): HTMLElement {
  return faceFactory();
}
export function setKiwiFace(make: () => HTMLElement): void {
  faceFactory = make;
}

const highlightMark = Decoration.mark({ class: "kn-kiwi-written" });
const removingMark = Decoration.mark({ class: "kn-kiwi-removing" });

export const kiwiWritingField = StateField.define<KiwiView>({
  create: () => IDLE,
  update(value, tr) {
    let { phase, cursor, removing, highlights } = value;
    if (tr.docChanged) {
      highlights = highlights.map(tr.changes);
      if (cursor !== null) cursor = tr.changes.mapPos(cursor, 1);
      if (removing) removing = { from: tr.changes.mapPos(removing.from, 1), to: tr.changes.mapPos(removing.to, -1) };
    }
    for (const e of tr.effects) {
      if (e.is(setCursor)) cursor = e.value;
      else if (e.is(markRemoving)) removing = e.value;
      else if (e.is(addHighlight) && e.value.to > e.value.from) highlights = highlights.update({ add: [highlightMark.range(e.value.from, e.value.to)] });
      else if (e.is(setPhase)) {
        phase = e.value;
        if (phase !== "writing") {
          cursor = null;
          removing = null;
        }
        if (phase === "idle") highlights = Decoration.none;
      }
    }
    if (removing && removing.to <= removing.from) removing = null;
    if (phase === value.phase && cursor === value.cursor && removing === value.removing && highlights === value.highlights) return value;
    return { phase, cursor, removing, highlights };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (v) => {
      if (v.phase === "idle") return Decoration.none;
      const extra = [];
      if (v.removing) extra.push(removingMark.range(v.removing.from, v.removing.to));
      if (v.cursor !== null) extra.push(Decoration.widget({ widget: new KiwiCursorWidget(true), side: 1 }).range(v.cursor));
      return extra.length ? RangeSet.join([v.highlights, Decoration.set(extra, true)]) : v.highlights;
    }),
    EditorView.editorAttributes.compute([field], (state): Record<string, string> => {
      const p = state.field(field).phase;
      return p === "idle" ? {} : { "data-kiwi-writing": p };
    }),
    EditorView.contentAttributes.compute([field], (state): Record<string, string> =>
      state.field(field).phase === "writing" ? { "aria-readonly": "true", "aria-busy": "true" } : {},
    ),
  ],
});

/** O estado da escrita do Kiwi num EditorState (para a janela e os testes). */
export function kiwiWritingState(state: EditorState): { phase: KiwiPhase; cursor: number | null; highlights: { from: number; to: number }[]; removing: { from: number; to: number } | null } {
  const v = state.field(kiwiWritingField, false) ?? IDLE;
  const highlights: { from: number; to: number }[] = [];
  v.highlights.between(0, state.doc.length, (from, to) => void highlights.push({ from, to }));
  return { phase: v.phase, cursor: v.cursor, highlights, removing: v.removing };
}

/**
 * Os trechos que ficam crus enquanto o Kiwi escreve e o realce some: o cursor dele, o que sai e o que entrou. O preview
 * desenhado (`rendered.ts`) troca o bloco por um widget, e o cursor e o realce ficariam escondidos dentro dele.
 */
export function kiwiRawRanges(state: EditorState): [number, number][] {
  const v = state.field(kiwiWritingField, false);
  if (!v || v.phase === "idle") return [];
  const out: [number, number][] = [];
  if (v.cursor !== null) out.push([v.cursor, v.cursor]);
  if (v.removing) out.push([v.removing.from, v.removing.to]);
  v.highlights.between(0, state.doc.length, (from, to) => void out.push([from, to]));
  return out;
}

/** A escrita do Kiwi mudou o que fica cru (o preview desenhado se refaz). */
export function kiwiRawChanged(tr: Transaction): boolean {
  return tr.startState.field(kiwiWritingField, false) !== tr.state.field(kiwiWritingField, false);
}

/** A extensão do editor: o campo e o filtro. O pulo pelo clique ou tecla é do `playKiwiWrite`. */
export function kiwiWritingExtension(): Extension {
  return [kiwiWritingField, kiwiFilter];
}

/** Enquanto o Kiwi escreve, o texto é só dele: mudanças de outra origem (colar, arrastar) não entram. */
const kiwiFilter = EditorState.transactionFilter.of((tr: Transaction) =>
  tr.docChanged && !tr.annotation(kiwiWriting) && tr.startState.field(kiwiWritingField, false)?.phase === "writing" ? [] : tr,
);

/**
 * Os trechos do arquivo inteiro (o contrato) no texto do editor, que não tem o frontmatter: `null` quando um trecho
 * mexe no frontmatter, quando o `removed` não bate com o texto de antes, ou quando se sobrepõem. Aí a janela recarrega
 * como antes, sem animar.
 */
export function bodyEdits(before: string, edits: readonly KiwiEdit[], frontmatterLength: number): KiwiEdit[] | null {
  const out: KiwiEdit[] = [];
  let last = -1;
  for (const e of edits) {
    if (!Number.isInteger(e.from) || !Number.isInteger(e.to) || e.from > e.to || e.from < last) return null;
    if (e.from < frontmatterLength) return null;
    if (before.slice(e.from, e.to) !== e.removed) return null;
    last = e.to;
    out.push({ from: e.from - frontmatterLength, to: e.to - frontmatterLength, removed: e.removed, inserted: e.inserted });
  }
  return out;
}

/** Aplica os trechos (em posições do texto de antes, em ordem crescente). */
export function applyKiwiEdits(before: string, edits: readonly KiwiEdit[]): string {
  let out = "";
  let at = 0;
  for (const e of edits) {
    out += before.slice(at, e.from) + e.inserted;
    at = e.to;
  }
  return out + before.slice(at);
}

/** Os pedaços de um texto a cada quadro: uma letra por `perChar`, e um trecho longo em pedaços maiores, até o teto. */
export function typingChunks(text: string, pace: Pick<typeof KIWI_PACE, "perChar" | "maxPerEdit" | "frame"> = KIWI_PACE): { text: string; wait: number }[] {
  if (!text) return [];
  const chars = Array.from(text);
  const total = Math.min(pace.maxPerEdit, chars.length * pace.perChar);
  const frames = Math.max(1, Math.min(chars.length, Math.floor(total / pace.frame)));
  const wait = Math.round(total / frames);
  const out: { text: string; wait: number }[] = [];
  for (let i = 0; i < frames; i++) {
    const a = Math.round((i * chars.length) / frames);
    const b = Math.round(((i + 1) * chars.length) / frames);
    if (b > a) out.push({ text: chars.slice(a, b).join(""), wait });
  }
  return out;
}

/** Um quadro: o que muda no editor e quanto esperar depois dele. */
export interface KiwiFrame {
  changes?: ChangeSpec;
  effects: StateEffect<unknown>[];
  /** Rolar até a posição (no texto depois deste quadro). */
  scrollTo?: number;
  wait: number;
}

/**
 * O roteiro da escrita: o cursor chega a cada trecho, o texto trocado esmaece e sai, e o novo entra em pedaços, com o
 * realce crescendo atrás dele. Com `reduced`, tudo num quadro só, sem cursor, só com o realce.
 */
export function kiwiWriteFrames(edits: readonly KiwiEdit[], reduced: boolean, pace: typeof KIWI_PACE = KIWI_PACE): KiwiFrame[] {
  const frames: KiwiFrame[] = [];
  if (reduced) {
    let delta = 0;
    const effects: StateEffect<unknown>[] = [setPhase.of("fading")];
    const changes: { from: number; to: number; insert: string }[] = [];
    for (const e of edits) {
      changes.push({ from: e.from, to: e.to, insert: e.inserted });
      const at = e.from + delta;
      effects.push(addHighlight.of({ from: at, to: at + e.inserted.length }));
      delta += e.inserted.length - (e.to - e.from);
    }
    const first = edits[0];
    frames.push({ changes, effects, ...(first ? { scrollTo: first.from } : {}), wait: 0 });
    return frames;
  }
  let delta = 0;
  for (const e of edits) {
    const at = e.from + delta;
    // A nota vira do Kiwi junto com a chegada do cursor: nunca "escrevendo" sem o cursor na tela.
    frames.push({ effects: [...(frames.length ? [] : [setPhase.of("writing")]), setCursor.of(at)], scrollTo: at, wait: pace.arrive });
    if (e.to > e.from) {
      frames.push({ effects: [markRemoving.of({ from: at, to: e.to + delta })], wait: pace.removing });
      frames.push({ changes: { from: at, to: e.to + delta }, effects: [markRemoving.of(null), setCursor.of(at)], wait: pace.frame });
    }
    let pos = at;
    for (const chunk of typingChunks(e.inserted, pace)) {
      frames.push({
        changes: { from: pos, insert: chunk.text },
        effects: [addHighlight.of({ from: pos, to: pos + chunk.text.length }), setCursor.of(pos + chunk.text.length)],
        scrollTo: pos + chunk.text.length,
        wait: chunk.wait,
      });
      pos += chunk.text.length;
    }
    delta += e.inserted.length - (e.to - e.from);
  }
  frames.push({ effects: [setPhase.of("fading")], wait: 0 });
  return frames;
}

/** Onde o texto mexido fica no texto depois de todos os trechos (para o realce do pulo). */
export function writtenRanges(edits: readonly KiwiEdit[]): { from: number; to: number }[] {
  let delta = 0;
  const out: { from: number; to: number }[] = [];
  for (const e of edits) {
    const at = e.from + delta;
    if (e.inserted) out.push({ from: at, to: at + e.inserted.length });
    delta += e.inserted.length - (e.to - e.from);
  }
  return out;
}

/** Como uma escrita acabou: até o fim, ou pulada (pela pessoa, ou por outra escrita na mesma view). */
export type KiwiWriteEnd = "end" | "skipped";

export interface KiwiWriteHandle {
  /** Pula para o fim: o texto do disco na hora, com o realce. */
  skip(): void;
  /** Resolve quando a escrita acabou: `"end"` no fim, `"skipped"` no pulo. O realce ainda some depois. */
  done: Promise<KiwiWriteEnd>;
}

export interface KiwiClock {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}
const realClock: KiwiClock = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) };

/**
 * Mostra a escrita na view. `edits` estão no texto que a view tem agora; `final` é o texto do disco, e é o que a view
 * tem no fim, por qualquer caminho. Uma escrita que ainda corre na mesma view pula para o fim antes desta começar.
 */
export function playKiwiWrite(view: EditorView, edits: readonly KiwiEdit[], final: string, opts: { reduced: boolean; clock?: KiwiClock; onEnd?(): void }): KiwiWriteHandle {
  running.get(view)?.skip();
  const clock = opts.clock ?? realClock;
  const frames = kiwiWriteFrames(edits, opts.reduced);
  let timer: unknown = null;
  let fadeTimer: unknown = null;
  let finished = false;
  let resolve!: (how: KiwiWriteEnd) => void;
  const done = new Promise<KiwiWriteEnd>((r) => (resolve = r));

  const dispatch = (spec: { changes?: ChangeSpec; effects: StateEffect<unknown>[]; scrollTo?: number }) => {
    const effects = [...spec.effects];
    if (spec.scrollTo !== undefined) effects.push(EditorView.scrollIntoView(spec.scrollTo, { y: "center" }));
    view.dispatch({
      ...(spec.changes ? { changes: spec.changes } : {}),
      effects,
      annotations: [kiwiWriting.of(true), Transaction.addToHistory.of(false)],
    });
  };

  const fadeOut = () => {
    clock.clear(fadeTimer);
    fadeTimer = clock.set(() => {
      if (kiwiWritingState(view.state).phase === "fading") dispatch({ effects: [setPhase.of("idle")] });
    }, KIWI_PACE.highlight);
  };

  const settle = (how: KiwiWriteEnd, highlights?: { from: number; to: number }[]) => {
    if (finished) return;
    finished = true;
    clock.clear(timer);
    detach();
    running.delete(view);
    const now = view.state.doc.toString();
    const effects: StateEffect<unknown>[] = [setPhase.of("fading")];
    if (highlights) for (const h of highlights) effects.push(addHighlight.of(h));
    if (now !== final) dispatch({ changes: lineChanges(now, final), effects });
    else dispatch({ effects });
    fadeOut();
    opts.onEnd?.();
    resolve(how);
  };

  const skip = () => {
    if (finished) return;
    // Os trechos já escritos ficam realçados; os que faltam entram realçados também.
    const remaining = kiwiWritingState(view.state).phase === "writing";
    dispatch({ effects: [setPhase.of("idle")] });
    settle("skipped", remaining ? writtenRanges(edits).filter((r) => r.to <= final.length) : undefined);
  };

  let i = 0;
  const step = () => {
    // Os quadros sem espera saem juntos (o Reduzir movimento termina aqui mesmo).
    for (;;) {
      if (finished) return;
      const f = frames[i++];
      if (!f) return settle("end");
      dispatch(f);
      if (f.wait > 0) {
        timer = clock.set(step, f.wait);
        return;
      }
    }
  };

  // A pessoa no controle: um clique ou uma tecla pula. A tecla que pulou não escreve (a nota ainda era do Kiwi).
  const onKey = (e: KeyboardEvent) => {
    if (kiwiWritingState(view.state).phase !== "writing") return;
    if (e.metaKey && (e.key === "c" || e.key === "a")) return;
    e.preventDefault();
    e.stopPropagation();
    skip();
  };
  const onPointer = () => {
    if (kiwiWritingState(view.state).phase === "writing") skip();
  };
  view.dom.addEventListener("keydown", onKey, true);
  view.dom.addEventListener("mousedown", onPointer, true);
  view.dom.addEventListener("paste", onPointer, true);
  const detach = () => {
    view.dom.removeEventListener("keydown", onKey, true);
    view.dom.removeEventListener("mousedown", onPointer, true);
    view.dom.removeEventListener("paste", onPointer, true);
  };

  const handle: KiwiWriteHandle = { skip, done };
  running.set(view, handle);
  step();
  return handle;
}

const running = new WeakMap<EditorView, KiwiWriteHandle>();

/** A escrita que corre agora nesta view (para a janela pular ao trocar de nota). */
export function runningKiwiWrite(view: EditorView): KiwiWriteHandle | null {
  return running.get(view) ?? null;
}
