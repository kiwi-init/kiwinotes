// O relógio e a view de mentira dos testes da escrita do Kiwi (T20869): o tocador anda pelo relógio, sem DOM.
import { history } from "@codemirror/commands";
import { EditorState, type TransactionSpec } from "@codemirror/state";

import { type KiwiClock, kiwiWritingExtension } from "./kiwi-writing.ts";

export function fakeClock() {
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
export function fakeView(doc: string) {
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
