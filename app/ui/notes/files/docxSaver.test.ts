// O gravador do docx (T21152): espera a última edição, grava com a versão, reconhece a própria gravação, cede ao arquivo
// de fora e adota a versão do agente (T21231). Os bytes são inventados (cada "documento" é um texto curto).

import { describe, expect, test } from "bun:test";

import type { FileSaveResult } from "../types.ts";
import { base64Of } from "./csv.ts";
import { CHANGED_OUTSIDE, DocxSaver, SAVE_FAILED } from "./docxSaver.ts";

const enc = (t: string) => new TextEncoder().encode(t);
const b64 = (t: string) => base64Of(enc(t));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function setup(opts: { fail?: boolean; stale?: { base64: string; version: string } } = {}) {
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

  test("sem saveBytes, nada grava", async () => {
    const saver = new DocxSaver({ path: "a.docx", files: {}, bytes: () => enc("x"), notice: () => {}, reload: () => {} }, "v1");
    expect(saver.canSave).toBe(false);
    saver.edited();
    expect(saver.pending).toBe(false);
    expect(await saver.flush()).toBe(true);
  });
});
