// O Histórico em inglês (T29247, spec #28171): a janela, o dia, a hora, o dia do áudio e o que a tela diz depois do
// "Enviar para nota…". A pasta da nota é a do disco e não muda com a língua.

import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { setAppLocale } from "../src/i18n.ts";
import type { NoteMeta } from "../src/api.ts";
import { audioUntil, dayLabel, History, time } from "./History.tsx";
import { sentText } from "./toNote.ts";

const english = () => setAppLocale({ setting: "en", locale: "en", system: "en" });
afterEach(() => setAppLocale({ setting: "auto", locale: "pt", system: "pt" }));

const note = (folder: string, title: string) => ({ path: `${folder ? `${folder}/` : ""}${title}.md`, title, folder }) as unknown as NoteMeta;

/** A janela sem engine e sem DOM: o `has()` lê o `window.engine`, e o `Window` do kit, o `document.visibilityState`. */
function render(): string {
  const g = globalThis as unknown as { window?: unknown; document?: unknown };
  const before = { window: g.window, document: g.document };
  g.window = {};
  g.document = { visibilityState: "visible" };
  try {
    return renderToStaticMarkup(<History />);
  } finally {
    g.window = before.window;
    g.document = before.document;
  }
}

describe("o Histórico em inglês", () => {
  test("a janela: título e busca", () => {
    expect(render()).toContain('placeholder="Buscar nos ditados"');
    english();
    const html = render();
    expect(html).toContain("History");
    expect(html).toContain('placeholder="Search dictations"');
    expect(html).not.toContain("Histórico");
  });

  test("o dia, a hora e o dia do áudio", () => {
    const today = new Date("2026-11-07T10:00:00");
    expect(dayLabel("2026-11-07T08:00:00", "en", today)).toBe("Today");
    expect(dayLabel("2026-11-06T08:00:00", "pt", today)).toBe("Ontem");
    expect(dayLabel("2026-11-05T08:00:00", "en", today)).toBe("Thursday, November 5");
    expect(time("2026-11-06T16:30:00")).toBe("16:30");
    expect(time("2026-11-06T16:30:00", "en")).toBe("4:30 PM");
    expect(audioUntil("2026-11-20T12:00:00", "en")).toBe("Nov 20");
    expect(audioUntil("2026-11-20T12:00:00")).toBe("20 de nov.");
  });

  test("o aviso do envio: a pasta fica como está no disco, e a raiz se traduz", () => {
    expect(sentText({ note: note("Caixa de entrada", "Comprar pão"), created: true, already: false }, "en")).toBe("Became the note “Comprar pão”, in Caixa de entrada");
    expect(sentText({ note: note("", "Ideias"), created: true, already: false }, "en")).toBe("Became the note “Ideias”, in Notes");
    expect(sentText({ note: note("", "Ideias"), created: true, already: false })).toBe("Virou a nota “Ideias”, em Notas");
    expect(sentText({ note: note("", "Ideias"), created: false, already: false }, "en")).toBe("Added to the end of “Ideias”");
    expect(sentText({ note: note("", "Ideias"), created: false, already: true }, "en")).toBe("Already in “Ideias”");
  });
});
