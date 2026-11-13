// O balão do gato (spec #9495, T10832): o que ele mostra a partir dos eventos do agente (`agent.turn`), sem depender do
// desenho. TypeScript puro, testado no `bun test`; o tempo entra sempre como argumento (`now`), então o teste anda o
// relógio sem esperar.
//
// - O texto chega em pedaços (`text`) e aparece digitado. O balão tem tamanho máximo (quem mede é a tela, pelo `fits`):
//   um texto maior vira uma fila de trechos, cortados entre palavras, cada um pelo tempo de leitura.
// - O texto dito antes de uma ferramenta sai quando ela começa (`status` `running`). A resposta final entra num balão
//   novo; o [Ver mais] mostra tudo o que o agente disse no pedido.
// - O `done` traz o texto inteiro do pedido: o trecho final é o que vem depois do que já foi dito antes da última
//   ferramenta. No erro, o balão mostra a mensagem. Um pedido novo fecha o balão do anterior.
// - O texto nunca é reescrito: só cortado. Nada aqui interpreta HTML (a tela mostra como texto).

import type { AgentTurnEvent } from "../../src/shared/ui-contract";
import { limitBubble } from "../settings/usageText";

/** A largura máxima do balão, em pixels, e quantas linhas cabem. */
export const BUBBLE_WIDTH = 280;
export const BUBBLE_LINES = 3;
/** A digitação: um caractere a cada tanto. */
export const TYPE_MS = 18;

/** O tempo de leitura de um trecho: 1,5 s mais 60 ms por caractere, entre 2 e 8 s. */
export function readingMs(text: string): number {
  return Math.min(8000, Math.max(2000, 1500 + 60 * [...text].length));
}

export interface Chunk {
  text: string;
  /** Onde o trecho termina no texto de origem (para o resto continuar dali). */
  end: number;
}

/**
 * Corta o texto em trechos que cabem no balão (`fits`), entre palavras. Uma palavra sozinha maior que o balão (um link,
 * um código) é a única coisa cortada no meio, e só porque não há outro jeito. Os espaços e as quebras de linha dentro do
 * trecho ficam como estão; os do começo de cada trecho saem.
 */
export function splitChunks(text: string, fits: (s: string) => boolean): Chunk[] {
  const out: Chunk[] = [];
  const re = /\S+/g;
  let start = -1; // onde começa o trecho aberto
  let last = -1; // onde termina a última palavra que coube
  const flush = () => {
    if (start >= 0) out.push({ text: text.slice(start, last), end: last });
    start = last = -1;
  };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const from = m.index, to = from + m[0].length;
    if (start >= 0 && fits(text.slice(start, to))) {
      last = to;
      continue;
    }
    flush();
    if (fits(m[0])) {
      start = from;
      last = to;
      continue;
    }
    // A palavra não cabe sozinha: corta por caractere, o maior pedaço que cabe.
    let at = from;
    while (at < to) {
      let n = 1;
      while (at + n < to && fits(text.slice(at, at + n + 1))) n++;
      if (at + n < to) out.push({ text: text.slice(at, at + n), end: at + n });
      else {
        start = at;
        last = to;
      }
      at += n;
    }
  }
  flush();
  return out;
}

export interface BubbleView {
  /** O que aparece agora no balão (a parte já digitada). */
  text: string;
  /** O trecho inteiro, já chegado (para medir o balão e não deixá-lo pular de tamanho durante a digitação). */
  full: string;
  error: boolean;
  /** Há mais do que este trecho: o [Ver mais] aparece. */
  more: boolean;
}

interface Head {
  text: string;
  complete: boolean;
  shownAt: number;
  completeAt: number;
  /** O texto entendido da fala pelo Control (spec #9876): sai quando a resposta começa a chegar. */
  heard?: boolean;
}

export class BubbleFeed {
  private request: string | null = null;
  private readonly finished = new Set<string>();
  /** Os trechos completos que esperam a vez. */
  private queue: string[] = [];
  /** O texto do segmento aberto que ainda não virou trecho completo. */
  private open = "";
  private head: Head | null = null;
  /** Tudo o que o agente disse no pedido (o [Ver mais]). */
  private said = "";
  /** O que foi dito antes do segmento aberto (antes da última ferramenta). */
  private closedLen = 0;
  private ended = false;
  private error = false;
  private dismissed = false;
  private announced: string | null = null;
  /** O limite acabado com a hora de volta (spec #11084): o erro de limite que vem depois mostra esta linha. */
  private outLine: string | null = null;

  constructor(
    private readonly fits: (s: string) => boolean,
    private reduced = false,
    /** O relógio de parede, para dizer a hora de volta do limite (spec #11084). */
    private readonly wall: () => number = Date.now,
  ) {}

  setReduced(on: boolean): void {
    this.reduced = on;
  }

  /** O texto inteiro do pedido, para o [Ver mais]. */
  all(): string {
    return this.said;
  }

  /** O que o leitor de tela anuncia: uma vez, no fim, com o texto inteiro. Quem lê consome. */
  takeAnnouncement(): string | null {
    const a = this.announced;
    this.announced = null;
    return a;
  }

  event(e: AgentTurnEvent, now: number): void {
    if (this.finished.has(e.id)) return;
    if (e.type === "started") {
      if (this.request && this.request !== e.id) this.finished.add(this.request);
      this.reset(e.id);
      return;
    }
    if (this.request !== e.id) {
      // Um pedido que o balão não viu começar (o hub abriu no meio): só se não há outro.
      if (this.request !== null && !this.ended) return;
      if (this.request !== null) this.finished.add(this.request);
      this.reset(e.id);
    }
    if (this.dismissed && e.type !== "done" && e.type !== "error") {
      if (e.type === "text") this.said += e.text;
      return;
    }
    if (e.type === "text") {
      if (this.head?.heard) this.head = null;
      this.said += e.text;
      this.open += e.text;
      this.chunkOpen(now, false);
    } else if (e.type === "status" && e.status === "running") {
      // A ferramenta começou: o que foi dito antes sai do balão.
      this.queue = [];
      this.open = "";
      this.head = null;
      this.closedLen = this.said.length;
    } else if (e.type === "done") {
      this.finish(e.id);
      if (e.stopReason !== "end_turn" || this.dismissed) {
        this.clear();
        if (e.stopReason === "end_turn") {
          if (e.text) this.said = e.text;
          // Fechar o balão é fechar o desenho: o leitor de tela ainda ouve a resposta, uma vez, no fim (revisão #10936).
          if (this.said.trim()) this.announced = this.said;
        }
        return;
      }
      if (e.text) {
        // O `done` traz tudo: o trecho final é o que veio depois da última ferramenta. O que dele já está no balão ou
        // na fila continua; o resto entra agora. Se o texto não bate com o que chegou em pedaços, fica o que chegou.
        if (e.text.startsWith(this.said.slice(0, this.closedLen))) this.open = e.text.slice(this.closedLen + this.segmentShown());
        this.said = e.text;
      }
      this.chunkOpen(now, true);
      if (this.said.trim()) this.announced = this.said;
      if (!this.head && !this.queue.length) this.clear();
    } else if (e.type === "limit") {
      // O limite (spec #11084): o aviso do agente entra como um trecho, logo depois do que está na tela, sem parar a
      // resposta; o limite acabado troca a mensagem do erro que vem em seguida pela hora de volta, se o agente disse.
      // A hora de volta se lê no relógio de parede: o `now` daqui é o do balão (o `performance.now()` da tela).
      const line = limitBubble(e.status, e.percent, e.resetsAt, this.wall());
      if (e.status === "out") this.outLine = line;
      else if (!this.dismissed) {
        this.queue.unshift(line);
        if (!this.head) this.next(now);
      }
    } else if (e.type === "error") {
      this.finish(e.id);
      this.queue = [];
      this.open = "";
      this.error = true;
      const line = (e.code === "E_AGENT_LIMIT" && this.outLine ? this.outLine : e.message || e.code).split("\n")[0]!.trim();
      this.head = { text: line, complete: true, shownAt: now, completeAt: now };
      this.dismissed = false;
    }
  }

  /**
   * O texto entendido da fala pelo Control (spec #9876): aparece no balão, entre aspas, enquanto o pedido começa. A
   * resposta do agente, quando chega, toma o lugar dele.
   */
  heard(id: string, text: string, now: number): void {
    if (this.finished.has(id) || !text.trim()) return;
    if (this.request !== id) {
      if (this.request) this.finished.add(this.request);
      this.reset(id);
    }
    if (this.said || this.dismissed || this.head) return;
    this.head = { text: `“${text.trim()}”`, complete: true, shownAt: now, completeAt: now, heard: true };
  }

  /** O clique no balão: fecha (o resto deste pedido não aparece mais no balão; o [Ver mais] não abre mais). */
  close(): void {
    this.dismissed = true;
    this.queue = [];
    this.open = "";
    this.head = null;
  }

  /** O que o balão mostra agora; null sem balão. */
  view(now: number): BubbleView | null {
    this.advance(now);
    const h = this.head;
    if (!h || this.dismissed) return null;
    const len = [...h.text].length;
    const typed = this.reduced || this.error ? len : Math.min(len, Math.floor((now - h.shownAt) / TYPE_MS));
    const text = cutAtCodePoint(h.text, typed);
    const more = !this.error && (this.queue.length > 0 || this.said.trim() !== h.text.trim());
    return { text, full: h.text, error: this.error, more };
  }

  /** Quando o balão muda de novo (a próxima letra ou o fim da leitura); Infinity se nada muda sozinho. */
  nextWake(now: number): number {
    this.advance(now);
    const h = this.head;
    if (!h || this.dismissed) return Infinity;
    if (!this.reduced && !this.error && now < this.typedAt(h)) return now + TYPE_MS;
    const expire = this.expireAt(h);
    return Number.isFinite(expire) ? expire : Infinity;
  }

  private reset(id: string): void {
    this.request = id;
    this.queue = [];
    this.open = "";
    this.head = null;
    this.said = "";
    this.closedLen = 0;
    this.ended = false;
    this.error = false;
    this.dismissed = false;
    this.announced = null;
    this.outLine = null;
  }

  private clear(): void {
    this.queue = [];
    this.open = "";
    this.head = null;
  }

  private finish(id: string): void {
    this.ended = true;
    this.finished.add(id);
    if (this.finished.size > 64) this.finished.delete(this.finished.values().next().value!);
  }

  /** Quanto do segmento aberto já virou balão (o trecho na tela e os da fila). */
  private segmentShown(): number {
    return this.said.length - this.closedLen - this.open.length;
  }

  /** Corta o segmento aberto: os trechos completos vão para a fila; com `all`, o resto também. */
  private chunkOpen(now: number, all: boolean): void {
    const chunks = splitChunks(this.open, this.fits);
    const complete = all ? chunks : chunks.slice(0, -1);
    for (const c of complete) this.queue.push(c.text);
    if (all) this.open = "";
    else if (complete.length) this.open = this.open.slice(complete.at(-1)!.end);
    // O trecho na tela que ainda estava chegando: se ele virou o primeiro completo da fila, fica completo.
    // O trecho na tela que ainda estava chegando é sempre o começo do segmento aberto: se um trecho completo saiu dele,
    // é esse, e o balão fica com ele (sem o espaço do fim, que é o que separa do próximo).
    const h = this.head;
    if (h && !h.complete) {
      const first = this.queue.shift();
      if (first !== undefined) {
        h.text = first;
        h.complete = true;
        h.completeAt = now;
      } else h.text = this.open.trimStart();
    }
    if (!this.head) this.next(now);
  }

  /** O próximo trecho entra no balão. */
  private next(at: number): void {
    const t = this.queue.shift();
    if (t !== undefined) {
      this.head = { text: t, complete: true, shownAt: at, completeAt: at };
      return;
    }
    const open = this.open.trimStart();
    this.head = open ? { text: open, complete: false, shownAt: at, completeAt: Infinity } : null;
  }

  private typedAt(h: Head): number {
    return this.reduced || this.error ? h.shownAt : h.shownAt + [...h.text].length * TYPE_MS;
  }

  private expireAt(h: Head): number {
    if (!h.complete) return Infinity;
    // Sem mais nada na fila e com o pedido ainda rodando, o último trecho espera o resto chegar.
    if (!this.queue.length && !this.ended && !this.error) return Infinity;
    return Math.max(h.completeAt, this.typedAt(h)) + readingMs(h.text);
  }

  private advance(now: number): void {
    for (let h = this.head; h && !this.dismissed; h = this.head) {
      const expire = this.expireAt(h);
      if (now < expire) return;
      this.next(expire);
      if (this.head && this.head.shownAt > now) return;
    }
  }
}

function cutAtCodePoint(s: string, n: number): string {
  if (n >= [...s].length) return s;
  return [...s].slice(0, n).join("");
}
