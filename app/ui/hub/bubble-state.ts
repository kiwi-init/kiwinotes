// O balão do gato (spec #9495, T10832; um balão só desde o spec #27881): o que ele mostra a partir dos eventos do agente
// (`agent.turn`), sem depender do desenho. TypeScript puro, testado no `bun test`; o tempo entra sempre como argumento
// (`now`), então o teste anda o relógio sem esperar.
//
// - Enquanto o agente trabalha, o balão mostra só a linha de estado ("Pesquisando na web…", o aviso do limite) ou o que
//   a pessoa falou (spec #9876). O texto que o agente diz entre as ferramentas não vai ao balão: fica no [Ver mais].
//   O aviso do limite fica pelo menos o tempo de leitura (`readingMs`), mesmo que a resposta chegue antes (T28584).
// - Quando a resposta chega (`done`), entra um balão só, com o resumo, de uma vez: ele não troca de trecho, não digita
//   e não muda com o relógio. O resumo é a fala do `cat_speak` (o evento `speech`), quando o agente mandou; senão, o
//   começo da resposta final, cortado no fim de uma frase que caiba (`summaryOf`). O [Ver mais] aparece quando a
//   resposta inteira é maior que o resumo, e mostra tudo o que o agente disse no pedido.
// - No erro, o balão mostra a mensagem. Um pedido novo fecha o balão do anterior; o clique fecha o balão.
// - O texto nunca é reescrito: só cortado. Nada aqui interpreta HTML (a tela mostra como texto).
// - O markdown (spec #17679): o balão pequeno mostra o texto corrido, sem `**`, `#`, `|` nem a crase. O corte é feito
//   nesse texto, e não no cru.

import type { AgentTurnEvent, BubbleLink } from "../../src/shared/ui-contract";
import { linkLabel } from "../../src/shared/bubble-links";
import { plainMarkdown } from "../src/bubbleMarkdown";
import { limitBubble } from "../settings/usageText";
import { t } from "../src/i18n";

/** O que o balão diz enquanto o agente está na web (spec #11908). */
export const webLine = (): string => t("hub.bubble.web");

/**
 * Quanto a resposta fica na tela antes de dar lugar a um balão com ação (a memória, a rotina, a proposta; T28350): o
 * tempo de leitura de antes do balão único, 1,5 s mais 60 ms por caractere, entre 2 e 8 s. Sem balão esperando, a
 * resposta fica até o clique (spec #27881).
 */
export function readingMs(text: string): number {
  return Math.min(8000, Math.max(2000, 1500 + 60 * [...text].length));
}

/** A largura máxima do balão, em pixels, e quantas linhas cabem. */
export const BUBBLE_WIDTH = 320; // a do balão do pacote do KiwiCat (T14933)
export const BUBBLE_LINES = 3;

/** O texto corrido, como o balão pequeno mostra: sem `**`, `#`, `|` nem a crase (o que sobra de um negrito aberto também). */
function plainOf(raw: string): string {
  return plainMarkdown(raw).replace(/\*\*|__|~~|`+/g, "");
}

const words = (s: string) => s.split(/\s+/).filter(Boolean);
const sameWords = (a: string, b: string) => words(a).join(" ") === words(b).join(" ");

/** O texto corrido de uma resposta inteira (spec #17679): o que o balão pequeno corta. */
export function bubblePlain(raw: string): string {
  return plainOf(raw);
}

/** O fim de cada frase de `text`: depois do `.`, `!`, `?` ou `…` (e das aspas ou parênteses que fecham), ou numa quebra. */
function sentenceEnds(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/[.!?…]+["”’')\]]*(?=\s)|\n/g)) out.push(m.index! + (m[0] === "\n" ? 0 : m[0].length));
  return out;
}

/**
 * A linha que pode ser título no texto corrido (o `#` já saiu): curta, sem pontuação no fim, sem ser item de lista nem
 * linha de tabela (as células vêm com " · ").
 */
const TITLE_LINE = /^(?![•◦▪]\s|\d+[.)]\s)(?!.* · )[^\n]{1,60}(?<![.!?…:;,])$/;
/** Quantas linhas curtas do começo contam como título: o título e um subtítulo. Mais que isso é conteúdo (#28077). */
const MAX_TITLES = 2;

/**
 * Onde o corpo começa depois dos títulos do começo (#28009, #28077): até `MAX_TITLES` linhas curtas, e só quando a
 * linha seguinte é corpo (um parágrafo, um item de lista ou uma linha de tabela). Linhas curtas seguidas de outra
 * linha curta, ou sem nada depois, não são título: o resumo começa no começo. 0 quando não há título a pular.
 */
function titlesEnd(t: string): number {
  let at = 0;
  for (let n = 0; n <= MAX_TITLES; n++) {
    const nl = t.indexOf("\n", at);
    const line = (nl < 0 ? t.slice(at) : t.slice(at, nl)).trim();
    if (!TITLE_LINE.test(line)) return n > 0 && line ? at : 0;
    if (nl < 0) return 0;
    at = nl + 1;
    while (/\s/.test(t[at] ?? "")) at++;
  }
  return 0;
}

/**
 * O resumo de um texto corrido (spec #27881): ele inteiro, se cabe no balão (`fits`); senão, as frases do começo que
 * cabem; senão, as palavras do começo que cabem com "…" (e, se nem a primeira palavra cabe, as letras dela). No corte,
 * os títulos do começo ficam de fora: o resumo sai do parágrafo (#28009). `from` é onde ele começa em `plain`.
 */
export function summarize(plain: string, fits: (s: string) => boolean): { text: string; from: number } {
  const t = plain.trim();
  let from = plain.length - plain.trimStart().length;
  if (!t || fits(t)) return { text: t, from };
  const skip = titlesEnd(t);
  return { text: cut(t.slice(skip), fits), from: from + skip };
}

export function summaryOf(plain: string, fits: (s: string) => boolean): string {
  return summarize(plain, fits).text;
}

function cut(t: string, fits: (s: string) => boolean): string {
  if (fits(t)) return t;
  let best = "";
  for (const end of sentenceEnds(t)) {
    const cand = t.slice(0, end).trimEnd();
    if (!cand) continue;
    if (!fits(cand)) break;
    best = cand;
  }
  if (best) return best;
  // Nem a primeira frase cabe: entre palavras, com "…". A vírgula ou os dois-pontos do fim saem antes das reticências.
  const ell = (s: string) => `${s.replace(/[\s,;:–—-]+$/, "")}…`;
  for (const m of t.matchAll(/\S+/g)) {
    const cand = ell(t.slice(0, m.index! + m[0].length));
    if (!fits(cand)) break;
    best = cand;
  }
  if (best) return best;
  // Uma palavra sozinha maior que o balão (um link, um código): as letras dela que cabem.
  const chars = [...t];
  let n = 1;
  while (n < chars.length && fits(`${chars.slice(0, n + 1).join("")}…`)) n++;
  return `${chars.slice(0, n).join("")}…`;
}

export interface BubbleView {
  /** O que aparece no balão. */
  text: string;
  /** O mesmo texto, inteiro (a tela mede o balão por ele). */
  full: string;
  error: boolean;
  /** A resposta inteira é maior que o balão: o [Ver mais] aparece. */
  more: boolean;
  /** Muda a cada balão novo (a troca de um balão para outro, spec #11652). */
  key: number;
  /** As notas e os arquivos do resumo (spec #17683), nas posições do `full`: só no balão da resposta. */
  links?: ChunkLink[];
}

/** Uma nota ou um arquivo dentro do balão pequeno: o rótulo em `full.slice(from, to)`. */
export type ChunkLink = { from: number; to: number; path: string };

/**
 * Onde cada link do `done` cai no texto corrido de `raw` (spec #17683). O main dá a posição no texto cru, a partir de
 * `base`; aqui se acha o rótulo, na ordem, a partir da palavra em que a menção começa (e não o primeiro "Plano" do
 * texto). O que não se acha fica sem link.
 */
export function plainLinks(raw: string, links: readonly BubbleLink[], base = 0): ChunkLink[] {
  const plain = plainOf(raw);
  const starts = [...plain.matchAll(/\S+/g)].map((m) => m.index!);
  const out: ChunkLink[] = [];
  let at = 0;
  for (const l of [...links].sort((a, b) => a.from - b.from)) {
    const from = l.from - base;
    if (from < 0 || l.to - base > raw.length) continue;
    const label = plainOf(linkLabel(l.text)).trim();
    if (!label) continue;
    // A palavra da menção no corrido, contada pelo corrido do que vem antes dela; duas de folga para trás.
    const word = words(plainOf(raw.slice(0, from))).length;
    const near = starts[Math.max(0, Math.min(word - 2, starts.length - 1))] ?? 0;
    const i = plain.indexOf(label, Math.max(at, near));
    if (i < 0) continue;
    out.push({ from: i, to: i + label.length, path: l.path });
    at = i + label.length;
  }
  return out;
}

/** O que está no balão: `line` é uma linha de estado (a web, o limite), `heard` o que a pessoa falou. */
interface Head {
  key: number;
  text: string;
  kind: "line" | "heard" | "answer" | "error";
  links?: ChunkLink[];
}

/**
 * Quanto a resposta de antes fica no canto depois do `started` de um pedido novo, à espera do primeiro balão dele
 * (T15377). Cobre a ida e volta do pedido, não a espera do agente: com mais que isso, o canto fica vazio.
 */
export const ANSWER_HOLD_MS = 1500;

export class BubbleFeed {
  private request: string | null = null;
  private readonly finished = new Set<string>();
  private head: Head | null = null;
  private keys = 0;
  /** Tudo o que o agente disse no pedido (o [Ver mais]). */
  private said = "";
  /** As notas e os arquivos que o `done` achou no `said` (spec #17683): viram link no balão grande. */
  private saidLinks: readonly BubbleLink[] = [];
  /** O que foi dito antes da última ferramenta: a resposta final é o que vem depois. */
  private closedLen = 0;
  /** A fala do `cat_speak` deste pedido (spec #27881): o resumo do balão. */
  private speech = "";
  private ended = false;
  private dismissed = false;
  private announced: string | null = null;
  /** O limite acabado com a hora de volta (spec #11084): o erro de limite que vem depois mostra esta linha. */
  private outLine: string | null = null;
  /**
   * A resposta do pedido anterior, parada no canto depois do `started` do novo (T15377): ela sai no mesmo quadro em que
   * o primeiro balão do novo entra, e não antes, com o canto vazio entre elas. Sai também no fim do pedido, no clique ou
   * no `ANSWER_HOLD_MS`.
   */
  private held: { view: BubbleView; until: number } | null = null;
  /**
   * O aviso de limite fica o tempo de leitura (T28584): o que vem depois dele no pedido (a resposta, a linha de outra
   * ferramenta, o canto vazio) espera em `afterWarning` até `warnUntil`. Sem isso, uma resposta rápida o tirava da tela
   * antes de dar para ler. O erro não espera.
   */
  private warnUntil = 0;
  private afterWarning: { head: Head | null } | null = null;

  constructor(
    private readonly fits: (s: string) => boolean,
    /** Sem digitação desde o spec #27881: fica pela assinatura de quem cria o balão. */
    _reduced = false,
    /** O relógio de parede, para dizer a hora de volta do limite (spec #11084). */
    private readonly wall: () => number = Date.now,
  ) {}

  /** O balão não anima mais o texto (spec #27881); a tela ainda avisa quando o movimento reduzido muda. */
  setReduced(_on: boolean): void {}

  /** O texto inteiro do pedido, para o [Ver mais]. */
  all(): string {
    return this.said;
  }

  /** Os links do `done` (spec #17683), nas posições do `all()`. Vazio enquanto a resposta chega. */
  links(): readonly BubbleLink[] {
    return this.saidLinks;
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
      // O que está no canto agora fica até o primeiro balão do pedido novo. Dois `started` seguidos não esticam o prazo.
      const before = this.view(now);
      const until = this.held?.until ?? now + ANSWER_HOLD_MS;
      this.reset(e.id);
      this.held = before ? { view: { ...before, more: false }, until } : null;
      return;
    }
    if (this.request !== e.id) {
      // Um pedido que o balão não viu começar (o hub abriu no meio): só se não há outro.
      if (this.request !== null && !this.ended) return;
      if (this.request !== null) this.finished.add(this.request);
      this.reset(e.id);
    }
    if (e.type === "text") {
      // O texto vai ao [Ver mais], não ao balão. O que a pessoa falou sai quando o agente começa a responder.
      this.said += e.text;
      if (this.head?.kind === "heard") this.head = null;
    } else if (e.type === "speech") {
      this.speech = plainOf(e.text).trim();
    } else if (e.type === "status" && e.status === "running") {
      // A ferramenta começou: o que foi dito antes não é a resposta final.
      this.closedLen = this.said.length;
      if (this.dismissed) return;
      // A web (spec #11908): o balão diz que o agente saiu do cofre, até a próxima ferramenta ou a resposta.
      this.put("tool" in e && e.tool === "web" ? this.line(webLine()) : null, now);
    } else if (e.type === "done") {
      this.finish(e.id);
      let base = this.closedLen;
      if (e.text) {
        // O `done` traz tudo; se ele não bate com o que chegou em pedaços, a resposta final é o texto inteiro.
        if (!e.text.startsWith(this.said.slice(0, this.closedLen))) base = 0;
        this.said = e.text;
        this.saidLinks = e.links ?? [];
      }
      // Fechar o balão é fechar o desenho: o leitor de tela ainda ouve a resposta, uma vez, no fim (revisão #10936).
      if (e.stopReason === "end_turn" && this.said.trim()) this.announced = this.said;
      this.put(e.stopReason !== "end_turn" || this.dismissed ? null : this.answer(base), now);
    } else if (e.type === "limit") {
      // O limite (spec #11084): o aviso do agente entra como a linha de estado, até a resposta; o limite acabado troca a
      // mensagem do erro que vem em seguida pela hora de volta, se o agente disse. A hora de volta se lê no relógio de
      // parede: o `now` daqui é o do balão (o `performance.now()` da tela).
      const line = limitBubble(e.status, e.percent, e.resetsAt, this.wall());
      if (e.status === "out") this.outLine = line;
      else if (!this.dismissed) {
        this.head = this.line(line);
        this.afterWarning = null;
        this.warnUntil = now + readingMs(line);
      }
    } else if (e.type === "error") {
      this.finish(e.id);
      this.afterWarning = null;
      const line = (e.code === "E_AGENT_LIMIT" && this.outLine ? this.outLine : e.message || e.code).split("\n")[0]!.trim();
      this.head = { key: ++this.keys, text: line, kind: "error" };
      this.dismissed = false;
    }
  }

  /**
   * O texto entendido da fala pelo Control (spec #9876): aparece no balão, entre aspas, enquanto o pedido começa. Sai
   * quando o agente começa a responder.
   */
  heard(id: string, text: string, _now: number): void {
    if (this.finished.has(id) || !text.trim()) return;
    if (this.request !== id) {
      if (this.request) this.finished.add(this.request);
      this.reset(id);
    }
    if (this.said || this.dismissed || this.head) return;
    this.head = { key: ++this.keys, text: `“${text.trim()}”`, kind: "heard" };
  }

  /** O clique no balão: fecha (o resto deste pedido não aparece mais no balão; o [Ver mais] não abre mais). */
  close(): void {
    this.held = null;
    this.afterWarning = null;
    this.warnUntil = 0;
    this.dismissed = true;
    this.head = null;
  }

  /** O que o balão mostra agora; null sem balão. */
  view(now: number): BubbleView | null {
    if (this.afterWarning && now >= this.warnUntil) {
      this.head = this.afterWarning.head;
      this.afterWarning = null;
    }
    if (this.held) {
      if (this.head || this.ended || this.dismissed || now >= this.held.until) this.held = null;
      else return this.held.view;
    }
    const h = this.head;
    if (!h || this.dismissed) return null;
    // Só a resposta pede o [Ver mais]: a linha de estado e a fala da pessoa não são o que o agente disse.
    const more = h.kind === "answer" && !sameWords(plainOf(this.said), h.text);
    return { text: h.text, full: h.text, error: h.kind === "error", more, key: h.key, ...(h.links ? { links: h.links } : {}) };
  }

  /** Quando o balão muda sozinho de novo: a resposta de antes, parada no canto, ou o que espera o aviso de limite; Infinity se nada muda. */
  nextWake(now: number): number {
    if (this.afterWarning && now < this.warnUntil) return this.warnUntil;
    if (this.held && !this.head && !this.ended && !this.dismissed && now < this.held.until) return this.held.until;
    return Infinity;
  }

  /** O próximo do balão; com o aviso de limite na tela, ele espera o tempo de leitura do aviso (T28584). */
  private put(head: Head | null, now: number): void {
    if (this.head?.kind === "line" && now < this.warnUntil) this.afterWarning = { head };
    else this.head = head;
  }

  private line(text: string): Head {
    return { key: ++this.keys, text, kind: "line" };
  }

  /**
   * O balão da resposta: a fala do `cat_speak`, ou o começo da resposta final (o que veio depois da última ferramenta;
   * sem nada depois dela, o pedido inteiro), cortado para caber. Os links só no começo cortado, que é o texto do `done`.
   */
  private answer(base: number): Head | null {
    if (this.speech) {
      const text = summaryOf(this.speech, this.fits);
      return text ? { key: ++this.keys, text, kind: "answer" } : null;
    }
    let raw = this.said.slice(base);
    if (!plainOf(raw).trim()) [raw, base] = [this.said, 0];
    const plain = plainOf(raw);
    const { text, from: lead } = summarize(plain, this.fits);
    if (!text) return null;
    // O texto cortado com "…" acaba antes delas: um rótulo cortado leva só o pedaço que aparece.
    const shown = text.endsWith("…") && !plain.slice(lead).startsWith(text) ? text.length - 1 : text.length;
    const links = this.saidLinks.length
      ? plainLinks(raw, this.saidLinks, base)
          .map((l) => ({ from: l.from - lead, to: Math.min(l.to - lead, shown), path: l.path }))
          .filter((l) => l.from >= 0 && l.from < shown)
      : [];
    return { key: ++this.keys, text, kind: "answer", ...(links.length ? { links } : {}) };
  }

  private reset(id: string): void {
    this.request = id;
    this.head = null;
    this.said = "";
    this.saidLinks = [];
    this.closedLen = 0;
    this.speech = "";
    this.ended = false;
    this.dismissed = false;
    this.announced = null;
    this.outLine = null;
    this.afterWarning = null;
    this.warnUntil = 0;
  }

  private finish(id: string): void {
    this.ended = true;
    this.finished.add(id);
    if (this.finished.size > 64) this.finished.delete(this.finished.values().next().value!);
  }
}
