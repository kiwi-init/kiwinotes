// O gravador do docx (T21152): espera a última edição, grava com a versão, reconhece a própria gravação, cede ao arquivo
// de fora e adota a versão do agente (T21231). Os bytes são inventados (cada "documento" é um texto curto).

import { describe, expect, test } from "bun:test";

import type { FileSaveResult } from "../types.ts";
import { base64Of } from "./csv.ts";
import { CHANGED_OUTSIDE, caretReporter, DocxSaver, SAVE_FAILED } from "./docxSaver.ts";

const enc = (t: string) => new TextEncoder().encode(t);
const b64 = (t: string) => base64Of(enc(t));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function setup(opts: { fail?: boolean; stale?: { base64: string; version: string }; catWrote?: (base: string, version: string) => boolean } = {}) {
  let doc = "Proposta da Ana";
  let n = 0;
  const calls: { base64: string; base: string }[] = [];
  const notices: (string | null)[] = [];
  const reloads: string[] = [];
  const saver = new DocxSaver(
    {
      path: "Docs/proposta.docx",
      delay: 20,
      files: {
        async saveBytes(_path, base64, base) {
          calls.push({ base64, base });
          if (opts.fail) throw new Error("disco cheio");
          if (opts.stale) return { saved: false, current: opts.stale } as FileSaveResult;
          return { saved: true, version: `v${++n + 1}` } as FileSaveResult;
        },
      },
      bytes: () => enc(doc),
      notice: (t) => notices.push(t),
      reload: (base64) => reloads.push(base64),
      ...(opts.catWrote ? { catWrote: opts.catWrote } : {}),
    },
    "v1",
  );
  return { saver, calls, notices, reloads, edit: (t: string) => ((doc = t), saver.edited()) };
}

describe("DocxSaver", () => {
  test("grava uma vez, um instante depois da última edição, com a versão do disco", async () => {
    const { saver, calls, edit } = setup();
    edit("Proposta da Ana.");
    edit("Proposta da Ana. Revisada.");
    expect(saver.pending).toBe(true);
    await tick(60);
    expect(calls).toEqual([{ base64: b64("Proposta da Ana. Revisada."), base: "v1" }]);
    expect(saver.pending).toBe(false);
    // A próxima gravação parte da versão que a primeira deu.
    edit("Outra frase.");
    await saver.flush();
    expect(calls[1]?.base).toBe("v2");
  });

  test("o flush pega os bytes na hora, antes de o documento fechar", async () => {
    const { saver, calls, edit } = setup();
    edit("Texto da Ana");
    const done = saver.flush();
    edit("Depois de fechar"); // o motor já não vale: o que conta é o que foi pego no flush
    saver.dispose();
    expect(await done).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.base64).toBe(b64("Texto da Ana"));
  });

  test("a leitura com os nossos bytes não reabre; a de fora reabre e avisa se havia edição", async () => {
    const { saver, edit, notices } = setup();
    edit("Nossa versão");
    await saver.flush();
    expect(saver.incoming(b64("Nossa versão"), "v2")).toBe(true);
    expect(saver.incoming(b64("qualquer"), "v2")).toBe(true); // mesma versão: nada mudou
    expect(saver.incoming(b64("Do outro app"), "v9")).toBe(false);
    expect(notices).toEqual([]);
    edit("Edição por gravar");
    expect(saver.incoming(b64("Do outro app de novo"), "v10")).toBe(false);
    expect(notices).toEqual([CHANGED_OUTSIDE]);
    expect(saver.pending).toBe(false);
  });

  test("versão velha no disco: não grava por cima, avisa e abre o arquivo de lá", async () => {
    const { saver, edit, notices, reloads } = setup({ stale: { base64: b64("Do Bruno"), version: "v7" } });
    edit("Da Ana");
    expect(await saver.flush()).toBe(false);
    expect(notices).toEqual([CHANGED_OUTSIDE]);
    expect(reloads).toEqual([b64("Do Bruno")]);
    expect(saver.pending).toBe(false);
  });

  test("gravação que falha: avisa e fica por gravar", async () => {
    const { saver, edit, notices } = setup({ fail: true });
    edit("Da Ana");
    expect(await saver.flush()).toBe(false);
    expect(notices).toEqual([SAVE_FAILED]);
    expect(saver.pending).toBe(true);
  });

  test("adopt: a versão do agente vira a base, sem reabrir; a edição da pessoa segue por cima dela", async () => {
    const { saver, calls, edit, reloads, notices } = setup();
    edit("A Ana digitando");
    saver.adopt("v-agente");
    expect(saver.incoming(b64("O que o agente gravou"), "v-agente")).toBe(true);
    await saver.flush();
    expect(calls).toEqual([{ base64: b64("A Ana digitando"), base: "v-agente" }]);
    expect(reloads).toEqual([]);
    expect(notices).toEqual([]);
  });

  test("hold: enquanto o gato toca, a edição da pessoa não grava; o release grava por cima da versão dele", async () => {
    const { saver, calls, edit } = setup();
    edit("A Ana digitando");
    saver.hold();
    edit("A Ana digitando mais");
    await tick(60);
    expect(await saver.flush()).toBe(true);
    expect(calls).toEqual([]);
    expect(saver.pending).toBe(true);
    saver.adopt("v-agente");
    saver.release();
    await tick(60);
    expect(calls).toEqual([{ base64: b64("A Ana digitando mais"), base: "v-agente" }]);
  });

  test("hold e a tela que não bateu: a leitura do disco reabre, avisa, e o release não grava nada", async () => {
    const { saver, calls, edit, notices } = setup();
    edit("A Ana digitando");
    saver.hold();
    expect(saver.known(b64("O que o agente gravou"), "v-agente")).toBe(false);
    expect(saver.incoming(b64("O que o agente gravou"), "v-agente")).toBe(false);
    saver.release();
    await tick(60);
    expect(calls).toEqual([]);
    expect(notices).toEqual([CHANGED_OUTSIDE]);
    expect(saver.known("", "v-agente")).toBe(true);
  });

  test("a gravação da pessoa que perde para a do gato enquanto ele toca: não reabre, e grava de novo sobre a versão dele", async () => {
    const stale = { base64: b64("O que o agente gravou"), version: "v-agente" };
    const opts: { stale?: typeof stale } = { stale };
    const { saver, calls, edit, notices, reloads } = setup(opts);
    edit("A Ana digitando");
    const going = saver.flush();
    expect(saver.unsaved).toBe(true);
    saver.hold();
    expect(await going).toBe(false);
    delete opts.stale;
    expect(reloads).toEqual([]);
    expect(notices).toEqual([]);
    expect(saver.pending).toBe(true);
    saver.adopt("v-agente");
    saver.release();
    await tick(60);
    expect(calls.map((c) => c.base)).toEqual(["v1", "v-agente"]);
  });

  test("a recusa que chega depois de a tela adotar a versão do gato: grava de novo, sem reabrir", async () => {
    const stale = { base64: b64("O que o agente gravou"), version: "v-agente" };
    const opts: { stale?: typeof stale } = { stale };
    const { saver, calls, edit, notices, reloads } = setup(opts);
    edit("A Ana digitando");
    const going = saver.flush();
    saver.hold();
    saver.adopt("v-agente");
    saver.release();
    expect(await going).toBe(false);
    delete opts.stale;
    await tick(60);
    expect(reloads).toEqual([]);
    expect(calls.map((c) => c.base)).toEqual(["v1", "v-agente"]);
    expect(notices).toEqual([]);
  });

  test("sem saveBytes, nada grava", async () => {
    const saver = new DocxSaver({ path: "a.docx", files: {}, bytes: () => enc("x"), notice: () => {}, reload: () => {} }, "v1");
    expect(saver.canSave).toBe(false);
    saver.edited();
    expect(saver.pending).toBe(false);
    expect(await saver.flush()).toBe(true);
  });

  // Revisão #23268, item 1: a gravação da pessoa recusada pela do gato antes de a tela receber a versão dele.
  describe("a recusa pela gravação do gato, antes de a tela receber", () => {
    const stale = { base64: b64("O que o agente gravou"), version: "v-agente" };
    async function cat(catWrote: (base: string, version: string) => boolean) {
      const opts: { stale?: typeof stale; catWrote: typeof catWrote } = { stale, catWrote };
      const t = setup(opts);
      t.edit("A Ana digitando noutro parágrafo");
      expect(await t.saver.flush()).toBe(false);
      delete opts.stale;
      return t;
    }
    test("sem aviso e sem reabrir; a edição fica por gravar e grava por cima da versão do gato depois que a tela toca", async () => {
      const { saver, calls, notices, reloads } = await cat((base, v) => base === "v1" && v === "v-agente");
      expect(notices).toEqual([]);
      expect(reloads).toEqual([]);
      expect(saver.pending).toBe(true);
      // A versão do gato chega: não é nossa, e a tela vai tocá-la.
      expect(saver.known(stale.base64, "v-agente")).toBe(false);
      saver.hold();
      saver.adopt("v-agente");
      saver.release();
      await tick(60);
      expect(calls.map((c) => c.base)).toEqual(["v1", "v-agente"]);
      expect(calls[1]?.base64).toBe(b64("A Ana digitando noutro parágrafo"));
      expect(notices).toEqual([]);
    });
    test("o aviso do gato chega um pouco depois da recusa: ainda conta", async () => {
      let known = false;
      setTimeout(() => (known = true), 120);
      const { notices, reloads, saver } = await cat(() => known);
      expect(notices).toEqual([]);
      expect(reloads).toEqual([]);
      expect(saver.pending).toBe(true);
    });
    test("uma versão que não é do gato: vale o arquivo de fora, com o aviso", async () => {
      const { notices, reloads } = await cat(() => false);
      expect(notices).toEqual([CHANGED_OUTSIDE]);
      expect(reloads).toEqual([stale.base64]);
    });
  });

  // Revisão #23268, item 2: sair do parágrafo dentro dos 400 ms da gravação.
  describe("caretReporter", () => {
    test("sair do parágrafo com uma edição por gravar: grava antes, e só então diz o parágrafo novo", async () => {
      const order: string[] = [];
      let release!: () => void;
      const saver = {
        unsaved: true,
        flush: () =>
          new Promise<boolean>((go) => {
            order.push("grava");
            release = () => {
              saver.unsaved = false;
              order.push("gravou");
              go(true);
            };
          }),
      };
      const tell = caretReporter(saver, async (id) => void order.push(`cursor ${id}`));
      tell("Q");
      await tick(20);
      expect(order).toEqual(["grava"]);
      release();
      await tick(0);
      expect(order).toEqual(["grava", "gravou", "cursor Q"]);
    });
    test("sem edição por gravar, o cursor vai na hora; o mesmo parágrafo não vai de novo", async () => {
      const sent: (string | null)[] = [];
      const tell = caretReporter({ unsaved: false, flush: async () => true }, async (id) => void sent.push(id));
      tell("P");
      tell("P");
      tell(null);
      await tick(0);
      expect(sent).toEqual(["P", null]);
    });
    test("com o DocxSaver de verdade: a edição está no disco antes de o gato saber que a pessoa saiu", async () => {
      const { saver, calls, edit } = setup();
      const sent: { id: string | null; saves: number }[] = [];
      const tell = caretReporter(saver, async (id) => void sent.push({ id, saves: calls.length }));
      edit("A Ana digitou no parágrafo do gato");
      tell("Q");
      await tick(5);
      expect(sent).toEqual([{ id: "Q", saves: 1 }]);
    });
  });
});
