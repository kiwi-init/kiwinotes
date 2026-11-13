// A pergunta na dúvida (spec #9873): a memória das respostas (impressão digital com chave, sem o trecho), o cartão por
// pedido (o prazo, o juntar, o cancelar, o agente que desiste), a decisão do guard e o servidor que aguenta a espera.
// Só exemplos inventados.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DoubtAnswers } from "./answers.ts";
import { SecretGuard } from "./filter.ts";
import { DoubtQuestions, type DoubtItem, type PendingDoubt } from "./questions.ts";
import { KiwiToolServer } from "../agent/tools/server.ts";
import type { VaultReader } from "../agent/tools/reader.ts";
import { tempDir } from "../../test/tmp.ts";

// Uma sequência longa e aleatória, sem nada em volta: o detector fica em dúvida.
const DOUBT = "Qx7Lm2Vb9Rt4Wz8Np3Kd6Hs1Fg5Jc0Ya";
const OTHER = "Zk4Pw8Rn2Tb6Ym1Vc5Xs9Lq3Hd7Gf0Ja";
const GH = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = tempDir("kiwi-doubt-");
  dirs.push(d);
  return d;
};

const item = (answers: DoubtAnswers, value: string, p = "Notas.md"): DoubtItem => ({
  fingerprint: answers.fingerprint(value),
  value,
  context: `anotei ${value} aqui`,
  mask: `•••• (${value.length} caracteres)`,
  kind: "random",
  path: p,
  line: 1,
});

describe("a memória das respostas (spec #9873)", () => {
  test("a impressão digital tem chave: o arquivo não tem o trecho, e sem a chave dela não se chega ao trecho", () => {
    const dir = tmp();
    const a = new DoubtAnswers(dir);
    const fp = a.fingerprint(DOUBT);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(a.fingerprint(DOUBT)).toBe(fp);
    // Outra instalação (outra chave) dá outra impressão: não é um hash puro do trecho.
    expect(new DoubtAnswers(tmp()).fingerprint(DOUBT)).not.toBe(fp);
    a.set(fp, "send", "•••• (32 caracteres)", "random");
    expect(new DoubtAnswers(dir).get(fp)).toBe("send");
    expect(readFileSync(path.join(dir, "guardrail-answers.json"), "utf8")).not.toContain(DOUBT);
    expect(statSync(path.join(dir, "guardrail.key")).mode & 0o777).toBe(0o600);
    expect(statSync(path.join(dir, "guardrail-answers.json")).mode & 0o777).toBe(0o600);
    expect(a.list()).toEqual([expect.objectContaining({ fingerprint: fp, answer: "send", mask: "•••• (32 caracteres)" })]);
    expect(a.forget(fp)).toBe(true);
    expect(a.get(fp)).toBeNull();
  });

  test("um arquivo de respostas estragado vai para o lado, e não é sobrescrito calado", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "guardrail-answers.json"), "{ estragado");
    const a = new DoubtAnswers(dir);
    expect(a.list()).toEqual([]);
    expect(readFileSync(path.join(dir, "guardrail-answers.json.bad"), "utf8")).toBe("{ estragado");
  });
});

describe("o cartão da pergunta (spec #9873)", () => {
  test("o pedido espera: Pode mandar solta o trecho, e a resposta fica lembrada", async () => {
    const answers = new DoubtAnswers(tmp());
    const changes: boolean[] = [];
    const q = new DoubtQuestions({ answers, onChange: (e) => changes.push(e.open) });
    const waiting = q.ask("p1", [item(answers, DOUBT)]);
    const card = q.current()!;
    expect(card.items).toEqual([expect.objectContaining({ value: DOUBT, path: "Notas.md" })]);
    expect(q.answer(card.id, card.items[0]!.fingerprint, "send")).toBe(true);
    expect([...(await waiting)]).toEqual([answers.fingerprint(DOUBT)]);
    expect(q.current()).toBeNull();
    expect(answers.get(answers.fingerprint(DOUBT))).toBe("send");
    expect(changes.at(-1)).toBe(false);
  });

  test("várias dúvidas e outra leitura do mesmo pedido vão no mesmo cartão; É tudo segredo segura o que falta", async () => {
    const answers = new DoubtAnswers(tmp());
    const q = new DoubtQuestions({ answers });
    const first = q.ask("p1", [item(answers, DOUBT)]);
    const second = q.ask("p1", [item(answers, OTHER, "Outra.md")]);
    const card = q.current()!;
    expect(card.items.map((i) => i.path)).toEqual(["Notas.md", "Outra.md"]);
    q.answer(card.id, answers.fingerprint(DOUBT), "send");
    q.holdAll(card.id);
    expect([...(await first)]).toEqual([answers.fingerprint(DOUBT)]);
    expect([...(await second)]).toEqual([]);
    expect(answers.get(answers.fingerprint(OTHER))).toBe("hold");
  });

  test("sem resposta no prazo, o trecho é segurado, o pedido segue, e a dúvida fica pendente sem o trecho", async () => {
    const answers = new DoubtAnswers(tmp());
    const pending: { request: string; items: PendingDoubt[] }[] = [];
    const q = new DoubtQuestions({ answers, timeoutMs: 40, onPending: (request, items) => pending.push({ request, items }) });
    expect([...(await q.ask("p1", [item(answers, DOUBT)]))]).toEqual([]);
    expect(pending).toEqual([{ request: "p1", items: [expect.objectContaining({ fingerprint: answers.fingerprint(DOUBT), mask: "•••• (32 caracteres)" })] }]);
    expect(JSON.stringify(pending)).not.toContain(DOUBT);
    expect(answers.get(answers.fingerprint(DOUBT))).toBeNull();
  });

  test("o agente que desiste da chamada e o pedido cancelado também seguram", async () => {
    const answers = new DoubtAnswers(tmp());
    const q = new DoubtQuestions({ answers });
    const stop = new AbortController();
    const gaveUp = q.ask("p1", [item(answers, DOUBT)], stop.signal);
    stop.abort();
    expect([...(await gaveUp)]).toEqual([]);
    expect(q.current()).toBeNull();
    const cancelled = q.ask("p2", [item(answers, OTHER)]);
    q.cancel("p2");
    expect([...(await cancelled)]).toEqual([]);
  });
});

describe("o guard decide a dúvida antes do marcador (spec #9873)", () => {
  test("a resposta guardada vale nos dois sentidos, o segredo certo nunca é perguntado, e o que não sabe pergunta", async () => {
    const answers = new DoubtAnswers(tmp());
    const q = new DoubtQuestions({ answers });
    const g = new SecretGuard("k7q2");
    const decider = { answers, questions: q, request: "p1" };
    answers.set(answers.fingerprint(DOUBT), "send", "m", "random");
    answers.set(answers.fingerprint(OTHER), "hold", "m", "random");
    const text = `a: ${DOUBT}\nb: ${OTHER}\ntoken ${GH}\n`;
    const r = await g.decide("Notas.md", text, decider);
    expect(r.text).toContain(DOUBT);
    expect(r.text).not.toContain(OTHER);
    expect(r.text).not.toContain(GH);
    expect(q.current()).toBeNull();
    // Um trecho que ninguém respondeu: a leitura espera a pessoa.
    answers.forget(answers.fingerprint(OTHER));
    const waiting = g.decide("Notas.md", text, decider);
    await Bun.sleep(5);
    const card = q.current()!;
    expect(card.items.map((i) => i.value)).toEqual([OTHER]);
    // No texto em volta, o token certo vai mascarado: só o trecho perguntado aparece inteiro (revisão do T10122).
    expect(card.items[0]!.context).toContain(OTHER);
    expect(card.items[0]!.context).not.toContain(GH);
    expect(card.items[0]!.context).toContain("ghp_••••");
    q.answer(card.id, card.items[0]!.fingerprint, "hold");
    expect((await waiting).text).not.toContain(OTHER);
  });
});

describe("o servidor de ferramentas aguenta a espera (spec #9873)", () => {
  test("uma chamada que espera mais de 10 s (o idleTimeout padrão do Bun) não cai", async () => {
    const slow: VaultReader = {
      search: async () => [],
      list: async () => ({ folders: [], notes: [] }),
      meetings: async () => [],
      get: async (p: string) => {
        await Bun.sleep(11_500);
        return { path: p, title: "Lenta", content: "devagar" };
      },
    } as unknown as VaultReader;
    const server = new KiwiToolServer({ reader: slow });
    const config = server.start();
    try {
      const headers = Object.fromEntries(config.headers.map((h) => [h.name, h.value]));
      const r = await fetch(config.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "notes_read", arguments: { path: "Lenta.md" } } }),
      });
      expect(r.status).toBe(200);
      expect(JSON.stringify(await r.json())).toContain("devagar");
    } finally {
      server.stop();
    }
  }, 30_000);
});
