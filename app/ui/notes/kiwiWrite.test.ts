// T20869 (spec #20843): a janela anima a escrita do Kiwi só quando ela fecha com o disco; senão, recarrega como antes.
import { describe, expect, test } from "bun:test";

import type { EditorView } from "@codemirror/view";

import { fakeClock, fakeView } from "./editor/kiwi-fakes.ts";
import { kiwiWriting, kiwiWritingState, playKiwiWrite, runningKiwiWrite } from "./editor/kiwi-writing.ts";
import { type KiwiEditor, KiwiQueue, KiwiWrites, kiwiPlan, startKiwiWrite } from "./kiwiWrite.ts";
import type { AgentWrote } from "./types.ts";

const fm = "---\nprojeto: exemplo\n---\n";
const before = `${fm}# Viagem\n\nLevar mapa.\n`;
const at = before.indexOf("mapa");
const after = `${fm}# Viagem\n\nLevar mapa e lanterna.\n`;
const event: AgentWrote = {
  path: "Viagem.md",
  baseVersion: "v1",
  version: "v2",
  turnId: "t1",
  edits: [{ from: at + 4, to: at + 4, removed: "", inserted: " e lanterna" }],
};

describe("o plano", () => {
  test("a escrita que fecha com o disco vira trechos no corpo (sem o frontmatter)", () => {
    const plan = kiwiPlan({ content: before, version: "v1" }, { content: after, version: "v2" }, event);
    expect(plan).not.toBeNull();
    expect(plan!.before).toBe("# Viagem\n\nLevar mapa.\n");
    expect(plan!.final).toBe("# Viagem\n\nLevar mapa e lanterna.\n");
    expect(plan!.edits[0]!.from).toBe(at + 4 - fm.length);
  });

  test("recarrega como antes: outra versão aberta, disco diferente, frontmatter mexido ou arquivo sem trechos", () => {
    expect(kiwiPlan({ content: before, version: "v0" }, { content: after, version: "v2" }, event)).toBeNull();
    expect(kiwiPlan({ content: before, version: "v1" }, { content: after + "mais\n", version: "v2" }, event)).toBeNull();
    expect(kiwiPlan({ content: before, version: "v1" }, { content: after, version: "v3" }, event)).toBeNull();
    const fmEdit: AgentWrote = { ...event, edits: [{ from: 4, to: 11, removed: "projeto", inserted: "tema" }] };
    expect(kiwiPlan({ content: before, version: "v1" }, { content: before.replace("projeto", "tema"), version: "v2" }, fmEdit)).toBeNull();
    expect(kiwiPlan({ content: before, version: "v1" }, { content: after, version: "v2" }, { path: "Viagem.md" })).toBeNull();
    expect(kiwiPlan({ content: before, version: "v1" }, { content: after, version: "v2" }, null)).toBeNull();
  });
});

describe("as escritas esperando a recarga", () => {
  test("cada uma sai uma vez, pela versão nova", () => {
    const w = new KiwiWrites();
    w.add(event);
    expect(w.take("Viagem.md", "v1")).toBeNull();
    expect(w.take("Viagem.md", "v2")).toEqual(event);
    expect(w.take("Viagem.md", "v2")).toBeNull();
  });

  test("arquivo sem trechos não fica guardado, e a lista não cresce sem fim", () => {
    const w = new KiwiWrites();
    w.add({ path: "planilha.xlsx", version: "v9" });
    expect(w.take("planilha.xlsx", "v9")).toBeNull();
    for (let i = 0; i < 100; i++) w.add({ ...event, version: `x${i}` });
    expect(w.take("Viagem.md", "x0")).toBeNull();
    expect(w.take("Viagem.md", "x99")).not.toBeNull();
  });

  test("a planilha fechada: as gravações seguidas do gato saem juntas, na ordem, ao abrir (T21114)", () => {
    const w = new KiwiWrites();
    const set = (row: number) => [{ op: "set" as const, sheet: "Estoque", row, col: 0, value: "x" }];
    w.add({ path: "estoque.xlsx", baseVersion: "a", version: "b", sheetOps: set(1) });
    w.add({ path: "estoque.xlsx", baseVersion: "b", version: "c", sheetOps: set(2) });
    w.add({ path: "outra.xlsx", baseVersion: "b", version: "c", sheetOps: set(9) });
    expect(w.takeSheet("estoque.xlsx", "c")).toEqual({ sheetOps: [...set(1), ...set(2)] });
    // Uma vez só: a segunda abertura não realça de novo.
    expect(w.takeSheet("estoque.xlsx", "c")).toBeNull();
    expect(w.takeSheet("outra.xlsx", "c")).toEqual({ sheetOps: set(9) });
  });

  test("o docx fechado (T21231): as operações de todas as gravações, na ordem, uma vez só", () => {
    const w = new KiwiWrites();
    const troca = (t: string) => [{ op: "replace" as const, paragraphId: "1A2B3C4D", from: 0, to: 3, text: t }];
    w.add({ path: "carta.docx", baseVersion: "a", version: "b", docxOps: troca("Olá") });
    w.add({ path: "carta.docx", baseVersion: "b", version: "c", docxOps: troca("Oi") });
    expect(w.takeSheet("carta.docx", "c")).toBeNull();
    expect(w.takeDocx("carta.docx", "c")).toEqual({ docxOps: [...troca("Olá"), ...troca("Oi")] });
    expect(w.takeDocx("carta.docx", "c")).toBeNull();
  });
});

// #21094: duas escritas seguidas do mesmo pedido (`notes_edit` e depois `notes_append`), cada uma com o seu `agent.wrote`
// e o seu `notes.changed`, chegando juntas. O mesmo caminho da janela (`startKiwiWrite`), sobre a view de mentira.
describe("escritas seguidas na nota aberta", () => {
  const v0 = `${fm}# Viagem\n\nLevar mapa.\n`;
  const v1 = `${fm}# Viagem\n\nLevar mapa e lanterna.\n`;
  const v2 = `${v1}\nSaída às 7h.\n`;
  const body = (t: string) => t.slice(fm.length);
  const w1: AgentWrote = { path: "Viagem.md", baseVersion: "v0", version: "v1", turnId: "t1", edits: [{ from: v0.indexOf("."), to: v0.indexOf("."), removed: "", inserted: " e lanterna" }] };
  const w2: AgentWrote = { path: "Viagem.md", baseVersion: "v1", version: "v2", turnId: "t1", edits: [{ from: v1.length, to: v1.length, removed: "", inserted: "\nSaída às 7h.\n" }] };
  const notes = { v1: { path: "Viagem.md", content: v1, version: "v1" }, v2: { path: "Viagem.md", content: v2, version: "v2" } };

  /** A janela: a nota aberta, a fila e o editor; `changed` é a recarga do `notes.changed`. */
  function windowWith() {
    const view = fakeView(body(v0));
    const { clock, advance } = fakeClock();
    const played: string[] = [];
    const replaced: string[] = [];
    let idle = 0;
    let reloads = 0;
    const open = { content: v0, version: "v0" };
    const writes = new KiwiWrites();
    const queue = new KiwiQueue(() => idle++);
    const editor: KiwiEditor = {
      play(before, edits, final, reduced) {
        if (view.state.doc.toString() !== before) return null;
        played.push(reduced ? "direto" : "animado");
        return playKiwiWrite(view as unknown as EditorView, edits, final, { reduced, clock }).done;
      },
      replace(text) {
        replaced.push(text);
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      },
    };
    const changed = (n: { path: string; content: string; version: string }) => {
      if (!startKiwiWrite(queue, writes, open, n, editor, false)) {
        // Como o efeito do `docKey` no NoteEditor: a escrita na tela pula, e o editor troca de texto.
        queue.clear();
        reloads++;
        runningKiwiWrite(view as unknown as EditorView)?.skip();
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: body(n.content) } });
      }
      open.content = n.content;
      open.version = n.version;
    };
    /** Anda o relógio de quadro em quadro, deixando as promessas da fila andarem entre um e outro. */
    const run = async (ms: number) => {
      for (let t = 0; t < ms; t += 16) {
        advance(16);
        // Uma volta do laço: todas as promessas pendentes da fila andam.
        await new Promise((r) => setTimeout(r, 0));
      }
    };
    return { view, writes, queue, changed, run, played, replaced, open, get idle() { return idle; }, get reloads() { return reloads; } };
  }

  test("as duas animam, em ordem, e a tela acaba no disco com a versão da 2ª", async () => {
    const w = windowWith();
    w.writes.add(w1);
    w.changed(notes.v1);
    w.writes.add(w2);
    w.changed(notes.v2);
    // A 2ª espera: a 1ª continua na tela, sem pular.
    expect(w.played).toEqual(["animado"]);
    expect(kiwiWritingState(w.view.state as never).phase).toBe("writing");
    expect(w.queue.busy).toBe(true);
    await w.run(6000);
    expect(w.played).toEqual(["animado", "animado"]);
    expect(w.reloads).toBe(0);
    expect(w.replaced).toEqual([]);
    expect(w.view.state.doc.toString()).toBe(body(v2));
    expect(w.open.version).toBe("v2");
    expect(w.queue.busy).toBe(false);
    expect(w.idle).toBe(1);
  });

  test("a pessoa pula a 1ª: as que faltam entram de uma vez, com o realce", async () => {
    const w = windowWith();
    w.writes.add(w1);
    w.changed(notes.v1);
    w.writes.add(w2);
    w.changed(notes.v2);
    await w.run(48);
    w.view.dom.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "x", metaKey: false }));
    await w.run(32);
    expect(w.played).toEqual(["animado", "direto"]);
    expect(w.view.state.doc.toString()).toBe(body(v2));
    expect(kiwiWritingState(w.view.state as never).highlights.length).toBeGreaterThan(0);
    expect(w.queue.busy).toBe(false);
  });

  test("uma recarga no meio larga a fila: a 2ª não toca depois", async () => {
    const w = windowWith();
    w.writes.add(w1);
    w.changed(notes.v1);
    w.writes.add(w2);
    w.changed(notes.v2);
    // Outra mudança, sem escrita do Kiwi: a janela recarrega como antes.
    const v3 = `${v2}Fim.\n`;
    w.changed({ path: "Viagem.md", content: v3, version: "v3" });
    await w.run(6000);
    expect(w.reloads).toBe(1);
    expect(w.played).toEqual(["animado"]);
    expect(w.view.state.doc.toString()).toBe(body(v3));
    expect(w.queue.busy).toBe(false);
  });

  test("na vez dela, o editor não está no texto esperado: vai direto ao disco", async () => {
    const w = windowWith();
    w.writes.add(w1);
    w.changed(notes.v1);
    w.writes.add(w2);
    w.changed(notes.v2);
    await w.run(6000);
    expect(w.view.state.doc.toString()).toBe(body(v2));
    // Um caso a mais: a fila com o editor fora do esperado (aqui, mexido por fora antes da vez da 2ª).
    const x = windowWith();
    x.writes.add(w1);
    x.changed(notes.v1);
    x.writes.add(w2);
    x.changed(notes.v2);
    await x.run(48);
    // Pula a 1ª e, antes da vez da 2ª, o texto muda por fora (com a anotação do Kiwi, para passar o filtro).
    x.view.dom.dispatchEvent(new Event("mousedown"));
    x.view.dispatch({ changes: { from: 0, insert: "?" }, annotations: kiwiWriting.of(true) });
    await x.run(32);
    expect(x.replaced).toEqual([body(v2)]);
    expect(x.view.state.doc.toString()).toBe(body(v2));
  });
});
