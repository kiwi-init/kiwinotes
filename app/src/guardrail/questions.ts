// A pergunta na dúvida (spec #9873): quando uma leitura do agente ou o texto de um pedido tem um trecho em dúvida, o
// Kiwi pergunta à pessoa antes de mandar ("É segredo" ou "Pode mandar"), num cartão por pedido.
//
// - **Um cartão por pedido:** as dúvidas de outra leitura do mesmo pedido entram no cartão aberto.
// - **Até 2 minutos, contados do cartão:** uma leitura que entra num cartão já aberto espera só o que sobra do prazo
//   dele (até 2 minutos, como diz o spec). Sem resposta, o que falta é segurado desta vez, o pedido segue, e a dúvida fica pendente para a
//   pessoa responder depois (na Atividade, pela impressão digital). Se o agente desiste antes (a chamada caiu), o mesmo.
// - **A resposta é lembrada** (`DoubtAnswers`), e a próxima leitura do mesmo trecho não pergunta.
// - **O trecho só existe aqui, na memória, enquanto o cartão está aberto,** e só sai pela capacidade da tela
//   (`agent.question`). O aviso de mudança leva só o id do cartão.

import { randomUUID } from "node:crypto";

import type { DoubtAnswer, DoubtAnswers } from "./answers.ts";

/** O prazo da pergunta. */
export const DOUBT_TIMEOUT_MS = 120_000;

export interface DoubtItem {
  fingerprint: string;
  /** O trecho em dúvida: só para a tela, nunca para log, evento ou registro. */
  value: string;
  /** Um pouco do texto em volta, com o trecho dentro, para a pessoa reconhecer. */
  context: string;
  mask: string;
  kind: string;
  /** De onde ele vem: o caminho da nota, ou "" para o texto do pedido. */
  path: string;
  line: number;
}

/** Uma dúvida que ficou sem resposta: sem o trecho, só o que permite responder depois. */
export type PendingDoubt = Omit<DoubtItem, "value" | "context">;

interface Card {
  id: string;
  request: string;
  deadline: number;
  items: Map<string, DoubtItem & { answer?: DoubtAnswer }>;
  waiters: Set<Waiter>;
  timer: ReturnType<typeof setTimeout>;
}

interface Waiter {
  fingerprints: string[];
  resolve: (send: Set<string>) => void;
}

export interface DoubtQuestionsOptions {
  answers: DoubtAnswers;
  timeoutMs?: number;
  now?: () => number;
  /** O cartão abriu, mudou ou fechou (só os ids: a tela lê o cartão pela capacidade). */
  onChange?: (e: { card: string; request: string; open: boolean }) => void;
  /** Dúvidas que ficaram sem resposta (o prazo, o agente que desistiu, o pedido cancelado). */
  onPending?: (request: string, items: PendingDoubt[]) => void;
}

/** O cartão como a tela vê: os trechos, a nota de cada um e o que já foi respondido. */
export interface DoubtCardView {
  id: string;
  request: string;
  deadline: string;
  items: { fingerprint: string; value: string; context: string; mask: string; kind: string; path: string; line: number; answer?: DoubtAnswer }[];
}

export class DoubtQuestions {
  private readonly cards = new Map<string, Card>();
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly o: DoubtQuestionsOptions) {
    this.timeoutMs = o.timeoutMs ?? DOUBT_TIMEOUT_MS;
    this.now = o.now ?? Date.now;
  }

  private cardOf(request: string): Card | undefined {
    for (const c of this.cards.values()) if (c.request === request) return c;
    return undefined;
  }

  /**
   * Pergunta sobre `items` no cartão do pedido `request` e espera. Devolve as impressões digitais que podem ir como
   * texto ("Pode mandar"); o resto é segurado. `signal` abortado (o agente desistiu) segura o que falta.
   */
  ask(request: string, items: DoubtItem[], signal?: AbortSignal): Promise<Set<string>> {
    if (!items.length) return Promise.resolve(new Set());
    let card = this.cardOf(request);
    if (!card) {
      const id = randomUUID();
      const c: Card = {
        id,
        request,
        deadline: this.now() + this.timeoutMs,
        items: new Map(),
        waiters: new Set(),
        timer: setTimeout(() => this.expire(id), this.timeoutMs),
      };
      (c.timer as { unref?: () => void }).unref?.();
      this.cards.set(id, c);
      card = c;
    }
    for (const i of items) if (!card.items.has(i.fingerprint)) card.items.set(i.fingerprint, { ...i });
    const c = card;
    const fingerprints = [...new Set(items.map((i) => i.fingerprint))];
    const done = new Promise<Set<string>>((resolve) => {
      const w: Waiter = { fingerprints, resolve };
      c.waiters.add(w);
      signal?.addEventListener("abort", () => {
        if (!c.waiters.delete(w)) return;
        w.resolve(this.sendable(c, fingerprints));
        if (!c.waiters.size) this.close(c, true);
      });
    });
    this.o.onChange?.({ card: c.id, request, open: true });
    this.settle(c);
    return done;
  }

  /** O que já pode ir como texto, das impressões `fps`. */
  private sendable(c: Card, fps: string[]): Set<string> {
    return new Set(fps.filter((fp) => c.items.get(fp)?.answer === "send"));
  }

  /** Solta quem já tem todas as respostas, e fecha o cartão respondido por inteiro. */
  private settle(c: Card): void {
    for (const w of [...c.waiters]) {
      if (w.fingerprints.every((fp) => c.items.get(fp)?.answer)) {
        c.waiters.delete(w);
        w.resolve(this.sendable(c, w.fingerprints));
      }
    }
    if ([...c.items.values()].every((i) => i.answer)) this.close(c, false);
  }

  /** Fecha o cartão: o que ficou sem resposta vira pendente, e os trechos saem da memória. */
  private close(c: Card, pending: boolean): void {
    if (!this.cards.delete(c.id)) return;
    clearTimeout(c.timer);
    for (const w of c.waiters) w.resolve(this.sendable(c, w.fingerprints));
    c.waiters.clear();
    const open = [...c.items.values()].filter((i) => !i.answer);
    if (pending && open.length) this.o.onPending?.(c.request, open.map(({ value: _v, context: _c, answer: _a, ...rest }) => rest));
    c.items.clear();
    this.o.onChange?.({ card: c.id, request: c.request, open: false });
  }

  private expire(id: string): void {
    const c = this.cards.get(id);
    if (c) this.close(c, true);
  }

  /** A resposta da pessoa a um trecho do cartão; fica lembrada. */
  answer(cardId: string, fingerprint: string, answer: DoubtAnswer): boolean {
    const c = this.cards.get(cardId);
    const item = c?.items.get(fingerprint);
    if (!c || !item) return false;
    item.answer = answer;
    this.o.answers.set(fingerprint, answer, item.mask, item.kind);
    this.o.onChange?.({ card: c.id, request: c.request, open: true });
    this.settle(c);
    return true;
  }

  /** "É tudo segredo": o que falta no cartão vira segredo. */
  holdAll(cardId: string): boolean {
    const c = this.cards.get(cardId);
    if (!c) return false;
    for (const i of c.items.values()) {
      if (i.answer) continue;
      i.answer = "hold";
      this.o.answers.set(i.fingerprint, "hold", i.mask, i.kind);
    }
    this.settle(c);
    return true;
  }

  /** O pedido foi cancelado: o cartão fecha, e o que faltava fica como não respondido. */
  cancel(request: string): void {
    const c = this.cardOf(request);
    if (c) this.close(c, true);
  }

  /** O cartão aberto (um por vez na tela: o mais velho), com os trechos; null sem cartão. */
  current(): DoubtCardView | null {
    const c = this.cards.values().next().value as Card | undefined;
    if (!c) return null;
    return {
      id: c.id,
      request: c.request,
      deadline: new Date(c.deadline).toISOString(),
      items: [...c.items.values()].map((i) => ({
        fingerprint: i.fingerprint,
        value: i.value,
        context: i.context,
        mask: i.mask,
        kind: i.kind,
        path: i.path,
        line: i.line,
        ...(i.answer ? { answer: i.answer } : {}),
      })),
    };
  }

  /** Fecha tudo (o agente desligado, o app saindo). */
  closeAll(): void {
    for (const c of [...this.cards.values()]) this.close(c, true);
  }
}
