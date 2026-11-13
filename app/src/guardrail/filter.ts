// O filtro do guardrail (spec #9818, T9833): o que vai para o agente sai sem os segredos que o detector acha
// (`detector.ts`). Cada segredo vira um marcador, `‹segredo 3 · k7q2›`, e a escrita do agente põe o original de volta.
//
// - **Por sessão do agente:** um `SecretGuard` por sessão. O código (`k7q2`) é dela, e o número não se repete nela.
//   Uma sessão nova, ou o app reaberto, começa um guard novo: um marcador de antes vira "de outra sessão".
// - **Preso à nota:** o mesmo segredo da mesma nota leva sempre o mesmo número, em qualquer leitura. Na escrita, o
//   marcador só volta na nota de onde saiu; em outra, a escrita é recusada.
// - **A dúvida também é segurada** (até a pergunta à pessoa, #8357): todo trecho que o detector devolve vira marcador.
// - **Um texto que só parece marcador é texto:** só o formato exato (`‹segredo N · cccc›`) é marcador. E um marcador
//   exato escrito na própria nota é guardado como "segredo" dele mesmo, para voltar igual.
// - **Nunca escreve o segredo** em lugar nenhum: ele só existe na memória do guard, enquanto a sessão dura.

import { randomBytes } from "node:crypto";

import { detect, mask as maskOf, type Finding } from "./detector.ts";
import type { DoubtAnswers } from "./answers.ts";
import type { DoubtItem, DoubtQuestions } from "./questions.ts";

/** Quem decide a dúvida (spec #9873): a resposta guardada, ou a pergunta à pessoa no cartão do pedido. */
export interface DoubtDecider {
  answers: DoubtAnswers;
  questions: DoubtQuestions;
  /** O pedido em que a leitura acontece: as dúvidas dele vão para o mesmo cartão. */
  request: string;
  /** Abortado quando o agente desiste da chamada: o que falta é segurado. */
  signal?: AbortSignal;
}

/**
 * Um pouco do texto em volta do trecho, numa linha, para a pessoa reconhecer no cartão. Os outros achados que caem ali
 * (um segredo certo, outra dúvida) vão mascarados: no cartão só aparece, inteiro, o trecho perguntado (revisão do
 * T10122).
 */
function contextOf(text: string, f: Finding, all: Finding[]): string {
  const a = Math.max(0, f.start - 60);
  const b = Math.min(text.length, f.end + 60);
  let out = "";
  let at = a;
  for (const o of all) {
    if (o === f || o.end <= a || o.start >= b) continue;
    const s = Math.max(o.start, a);
    if (s < at) continue;
    out += text.slice(at, s) + maskOf(text, o);
    at = Math.min(o.end, b);
  }
  out += text.slice(at, b);
  return `${a > 0 ? "…" : ""}${out.replace(/\s+/g, " ")}${b < text.length ? "…" : ""}`;
}

/** O marcador exato: o número e o código da sessão. */
export const MARKER = /‹segredo (\d{1,6}) · ([a-z0-9]{4})›/g;

/** Um marcador que não pode voltar: de outra sessão, de outra nota, ou que esta sessão não deu. */
export class GuardError extends Error {
  readonly code = "E_SECRET_MARKER";
}

interface Held {
  path: string;
  value: string;
  /** Um marcador escrito na própria nota, guardado como ele mesmo: não conta como segredo segurado. */
  literal: boolean;
}

/** Um código de sessão: 4 letras e números minúsculos. */
export function sessionCode(): string {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  return [...randomBytes(4)].map((b) => abc[b % abc.length]).join("");
}

export class SecretGuard {
  readonly code: string;
  private next = 1;
  private readonly byKey = new Map<string, number>();
  private readonly byNumber = new Map<number, Held>();

  constructor(code = sessionCode()) {
    if (!/^[a-z0-9]{4}$/.test(code)) throw new Error(`bad session code: ${code}`);
    this.code = code;
  }

  private marker(n: number): string {
    return `‹segredo ${n} · ${this.code}›`;
  }

  /** O número de um valor da nota `path`: o mesmo de antes, ou o próximo da sessão. */
  private number(path: string, value: string, literal: boolean): number {
    const key = `${path}\u0000${value}`;
    let n = this.byKey.get(key);
    if (n === undefined) {
      n = this.next++;
      this.byKey.set(key, n);
      this.byNumber.set(n, { path, value, literal });
    }
    return n;
  }

  /**
   * O texto da nota `path` como o agente vê: cada segredo (ou dúvida) trocado pelo marcador dele. Olha o texto inteiro;
   * quem corta em pedaços corta o resultado. `held` é quantos segredos diferentes o texto tinha.
   */
  read(path: string, text: string, keepOwn = false, send?: ReadonlySet<string>): { text: string; held: number } {
    // `send`: os trechos em dúvida que a pessoa deixou ir como texto (spec #9873).
    const spans: { start: number; end: number; literal: boolean }[] = detect(text)
      .filter((f) => !(f.verdict === "doubt" && send?.has(text.slice(f.start, f.end))))
      .map((f) => ({ start: f.start, end: f.end, literal: false }));
    for (const m of text.matchAll(MARKER)) {
      // No pedido, um marcador desta sessão é a referência que a pessoa copiou da resposta: fica como está.
      if (keepOwn && m[2] === this.code) continue;
      spans.push({ start: m.index!, end: m.index! + m[0].length, literal: true });
    }
    spans.sort((a, b) => a.start - b.start || b.end - a.end);
    let out = "";
    let at = 0;
    const held = new Set<number>();
    for (const s of spans) {
      if (s.start < at) continue; // dentro de um trecho já trocado
      const n = this.number(path, text.slice(s.start, s.end), s.literal);
      if (!s.literal) held.add(n);
      out += text.slice(at, s.start) + this.marker(n);
      at = s.end;
    }
    return { text: out + text.slice(at), held: held.size };
  }

  /**
   * Como o `read`, mas a dúvida é decidida antes (spec #9873): a resposta guardada vale ("Pode mandar" passa, "É
   * segredo" segura), e o que nunca foi respondido é perguntado à pessoa, que tem até o prazo. Sem `decider`, a dúvida
   * é segurada, como no filtro. `doubts` é quantas dúvidas foram perguntadas e ficaram seguras.
   */
  async decide(path: string, text: string, decider?: DoubtDecider, keepOwn = false): Promise<{ text: string; held: number }> {
    if (!decider) return this.read(path, text, keepOwn);
    const send = new Set<string>();
    const ask = new Map<string, DoubtItem>();
    const found = detect(text);
    for (const f of found) {
      if (f.verdict !== "doubt") continue;
      const value = text.slice(f.start, f.end);
      const fingerprint = decider.answers.fingerprint(value);
      const known = decider.answers.get(fingerprint);
      if (known === "send") send.add(value);
      else if (known === null && !ask.has(fingerprint))
        ask.set(fingerprint, { fingerprint, value, context: contextOf(text, f, found), mask: maskOf(text, f), kind: f.kind, path, line: f.line });
    }
    if (ask.size) {
      const ok = await decider.questions.ask(decider.request, [...ask.values()], decider.signal);
      for (const [fp, item] of ask) if (ok.has(fp)) send.add(item.value);
    }
    return this.read(path, text, keepOwn, send);
  }

  /**
   * O pedido da pessoa, filtrado como uma nota sem caminho: os segredos dele não voltam em nota nenhuma. Um marcador
   * desta sessão que a pessoa copiou da resposta do agente passa como está.
   */
  request(text: string): { text: string; held: number } {
    return this.read("", text, true);
  }

  /**
   * O texto que o agente escreve na nota `path`, com os originais no lugar dos marcadores. `GuardError` se um marcador
   * exato é de outra sessão, de outra nota, ou não foi dado por esta sessão.
   */
  write(path: string, text: string): string {
    return text.replace(MARKER, (whole, num: string, code: string) => {
      if (code !== this.code)
        throw new GuardError(
          `O marcador ${whole} é de outra sessão (ou de antes de o Kiwi reabrir), e o Kiwi não sabe mais o que ele guardava. Nada foi escrito: leia a nota de novo e mande o texto com os marcadores da leitura nova.`,
        );
      const held = this.byNumber.get(Number(num));
      if (!held)
        throw new GuardError(`O marcador ${whole} não foi dado nesta sessão. Nada foi escrito: leia a nota de novo e use os marcadores dela.`);
      if (held.path !== path)
        throw new GuardError(
          `O marcador ${whole} é de ${held.path ? `outra nota (${held.path})` : "um pedido"}, e um segredo só volta na nota de onde saiu. Nada foi escrito: escreva sem esse marcador.`,
        );
      return held.value;
    });
  }

  /** Quantos segredos de verdade (não marcadores literais) aparecem em `text`, que o guard já trocou. */
  heldIn(text: string): number {
    const seen = new Set<number>();
    for (const m of text.matchAll(MARKER)) {
      if (m[2] !== this.code) continue;
      const n = Number(m[1]);
      if (this.byNumber.get(n)?.literal === false) seen.add(n);
    }
    return seen.size;
  }
}

/** Quantos segredos de `before` não estão mais em `after`: o agente trocou o trecho e não mandou o marcador de volta. */
export function removedSecrets(before: string, after: string): number {
  const values = new Set(detect(before).filter((f) => f.verdict === "secret").map((f) => before.slice(f.start, f.end)));
  let gone = 0;
  for (const v of values) if (!after.includes(v)) gone++;
  return gone;
}
