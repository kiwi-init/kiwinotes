// A janela curta e a cápsula (ADR 0013, peça 5; T13835): a conversa mora no Kiwi, e a sessão do agente é curta.
//
// - **Uma janela é uma sessão do agente.** Dentro dela tudo segue como antes: a sessão é retomada entre os pedidos, com o
//   cache quente, e a conversa contínua do balão (#13380) tem a memória de verdade do agente.
// - **A janela fecha quando esfriou ou engordou:** mais de 55 min sem ida (o cache venceu: retomar seria reescrever a
//   conversa inteira), mais de 6 mil tokens de conversa, ou quando a pessoa pede uma conversa nova. Pelo tamanho, nunca
//   com a conversa do gato na tela: o teto vale no próximo pedido depois que ela acaba.
// - **A janela nova começa com a cápsula,** montada pelo Kiwi sem modelo e sem ida: os 3 últimos pedidos com as
//   respostas, cortados, os cartões das notas que eles tocaram (o caminho, sem o texto) e o mapa da pasta (os projetos e
//   as pastas do primeiro nível, com a contagem). Até 800 tokens, o mapa até 300.
//
// Aqui só a lógica pura: quando fechar e o que vai na cápsula. Quem guarda a conversa é a Atividade do agente (30 dias),
// e quem abre a sessão nova é o serviço.

import { countTokens } from "./token-count.ts";

/** Sem ida por mais que isto, a janela esfriou: o cache do agente vence em 1 hora, e a margem é para o pedido caber. */
export const WINDOW_IDLE_MS = 55 * 60_000;
/** A conversa da janela passou disto (em tokens do modelo): a próxima janela começa com a cápsula. */
export const WINDOW_MAX_TOKENS = 6_000;
/** A cápsula inteira, em tokens do modelo. */
export const CAPSULE_MAX_TOKENS = 800;
/** O mapa da pasta, dentro da cápsula. */
export const CAPSULE_MAP_MAX_TOKENS = 300;
/** Quantos pedidos de antes vão na cápsula. */
export const CAPSULE_TURNS = 3;
/** Quantos cartões de nota, no máximo. */
export const CAPSULE_CARDS = 8;

/**
 * Do contador local para os tokens do modelo: a calibração da bateria (T13702, `test/tokens/idas.ts`) pelo registro do
 * harry deu 1,236 por token contado, e uns 27 tokens de marcas do Claude Code em cada pedido, resposta ou resultado.
 */
export const MODEL_TOKEN_FACTOR = 1.236;
export const MODEL_TOKENS_PER_ITEM = 27;

/** Os tokens do modelo de um texto que entra na conversa (um pedido, uma resposta, um resultado de ferramenta). */
export function modelTokens(text: string): number {
  return Math.round(countTokens(text) * MODEL_TOKEN_FACTOR) + MODEL_TOKENS_PER_ITEM;
}

/** O mesmo, só pelo tamanho (um resultado de ferramenta de que só se sabe quantos caracteres tinha). */
export function modelTokensOfChars(chars: number): number {
  // O JSON das ferramentas dá uns 3,2 caracteres por token no contador local (a bateria).
  return Math.round((chars / 3.2) * MODEL_TOKEN_FACTOR) + MODEL_TOKENS_PER_ITEM;
}

/** A janela aberta: a sessão dela, quando começou, a última ida e quantos tokens de conversa ela já tem. */
export interface WindowState {
  sessionId: string;
  startedAt: number;
  lastIdaAt: number;
  tokens: number;
}

/** `web`: o "Pesquisar na web" mudou desde que a sessão abriu, e as ferramentas dela são outras (revisão do T19300). */
export type WindowCloseReason = "start" | "idle" | "size" | "asked" | "web";

/**
 * Se a janela fecha antes deste pedido, e por quê. Sem janela (`start`: a 1ª vez, um estado perdido, ou a sessão do
 * agente não é mais a da janela) a sessão aberta tem um tamanho que o Kiwi não conhece: começa uma janela nova.
 */
export function windowCloseReason(
  w: WindowState | null,
  o: { now: number; asked?: boolean; conversationOpen?: boolean; maxTokens?: number; idleMs?: number },
): WindowCloseReason | null {
  if (o.asked) return "asked";
  if (!w) return "start";
  if (o.now - w.lastIdaAt > (o.idleMs ?? WINDOW_IDLE_MS)) return "idle";
  if (!o.conversationOpen && w.tokens > (o.maxTokens ?? WINDOW_MAX_TOKENS)) return "size";
  return null;
}

// ── A cápsula ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Um pedido de antes: o texto e a resposta (já guardados cortados), e as notas que ele leu ou mudou. */
export interface CapsuleTurn {
  request: string;
  answer?: string;
  read: string[];
  changed: string[];
}

/** O mapa da pasta: os projetos e as pastas do primeiro nível, com quantas notas cada um tem. */
export interface CapsuleMap {
  projects: { name: string; folder: string; notes: number }[];
  folders: { folder: string; notes: number }[];
}

/** O mapa a partir da lista das notas: as pastas do primeiro nível (e a raiz), com a contagem, das maiores para as menores. */
export function folderCounts(notes: readonly { folder: string }[]): { folder: string; notes: number }[] {
  const counts = new Map<string, number>();
  for (const n of notes) {
    const top = n.folder.split("/")[0] ?? "";
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  return [...counts].map(([folder, notes]) => ({ folder, notes })).sort((a, b) => b.notes - a.notes || a.folder.localeCompare(b.folder));
}

/** Os tokens de um pedaço de texto dentro de um item (sem as marcas do item). */
const pieceTokens = (text: string) => Math.round(countTokens(text) * MODEL_TOKEN_FACTOR);

/** Corta um texto em uma linha, com até `max` tokens do modelo, com "…" no fim quando cortou. */
export function cut(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (pieceTokens(line) <= max) return line;
  // Busca binária no tamanho: o contador não é linear (palavras longas, sinais).
  let lo = 0;
  let hi = line.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (pieceTokens(line.slice(0, mid) + "…") <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo ? line.slice(0, lo).trimEnd() + "…" : "";
}

const MAP_TITLE = "Mapa da pasta (notas por pasta):";

/** O mapa em texto, até `max` tokens: os projetos primeiro, depois as pastas que não são projeto. */
export function mapText(map: CapsuleMap, max = CAPSULE_MAP_MAX_TOKENS): string {
  const projectFolders = new Set(map.projects.map((p) => p.folder.split("/")[0] ?? p.folder));
  const items = [
    ...map.projects.map((p) => `${p.folder} (projeto, ${p.notes})`),
    ...map.folders.filter((f) => !projectFolders.has(f.folder)).map((f) => `${f.folder || "(raiz)"} (${f.notes})`),
  ];
  if (!items.length) return "";
  let text = MAP_TITLE;
  let shown = 0;
  for (const item of items) {
    const next = `${text}${shown ? "; " : " "}${item}`;
    const rest = items.length - shown - 1;
    // Sempre cabe o "e mais N" do fim.
    if (modelTokens(rest ? `${next}; e mais ${rest}` : next) > max) break;
    text = next;
    shown++;
  }
  if (!shown) return "";
  if (shown < items.length) text += `; e mais ${items.length - shown}`;
  return text;
}

/**
 * A cápsula é um bloco entre colchetes, como as outras instruções do Kiwi (a memória, as instruções da pessoa): o
 * começo numa linha, o fim numa linha só com "]". Cada parte dentro dela é uma linha só (o `cut` junta as linhas).
 */
const HEAD = "[A conversa de antes, que o Kiwi guardou (esta sessão do agente é nova):";

/**
 * A cápsula da janela nova, em até `max` tokens do modelo: o mapa da pasta (até 300), os pedidos de antes, do mais
 * antigo para o mais novo, cada um com a resposta cortada, e os cartões das notas que eles tocaram. O que não cabe sai
 * do mais antigo: o pedido mais novo é o que a pessoa ainda tem na cabeça. Sem nada para pôr, a cápsula é vazia.
 */
export function buildCapsule(turns: readonly CapsuleTurn[], map: CapsuleMap | null, max = CAPSULE_MAX_TOKENS): string {
  const recent = turns.slice(-CAPSULE_TURNS);
  const mapPart = map ? mapText(map, Math.min(CAPSULE_MAP_MAX_TOKENS, max)) : "";
  // Os cartões: as notas tocadas, as mudadas primeiro, sem repetir, das mais novas para as mais velhas.
  const seen = new Set<string>();
  const cards: string[] = [];
  for (const t of [...recent].reverse()) {
    for (const p of t.changed) if (!seen.has(p)) seen.add(p), cards.push(`${p} (mudada)`);
    for (const p of t.read) if (!seen.has(p)) seen.add(p), cards.push(`${p} (lida)`);
  }
  const lines = (shownTurns: { request: string; answer: string }[], shownCards: string[]): string[] => {
    const out: string[] = [];
    shownTurns.forEach((t, i) => {
      out.push(`${i + 1}. Pedido: ${t.request}`);
      if (t.answer) out.push(`   Resposta: ${t.answer}`);
    });
    if (shownCards.length) out.push(`Notas tocadas: ${shownCards.join("; ")}`);
    if (mapPart) out.push(mapPart);
    return out.length ? [HEAD, ...out, "]"] : [];
  };
  const total = (l: string[]) => (l.length ? modelTokens(l.join("\n")) : 0);
  // Cada pedido e cada resposta têm um teto. Se não cabe, os tetos baixam um pouco, depois sai o pedido mais velho; só
  // com um pedido sozinho ainda grande demais é que as respostas e os cartões encolhem de vez.
  const plans: { keep: number; req: number; ans: number; cards: number }[] = [];
  for (let keep = recent.length; keep >= 1; keep--)
    for (const [req, ans, cards] of [[60, 90, CAPSULE_CARDS], [40, 60, CAPSULE_CARDS], [40, 60, 4]] as const) plans.push({ keep, req, ans, cards });
  for (let keep = recent.length; keep >= 1; keep--)
    for (const [req, ans, cards] of [[30, 40, 2], [30, 0, 0]] as const) plans.push({ keep, req, ans, cards });
  for (const p of plans) {
    const shown = recent.slice(recent.length - p.keep).map((t) => ({ request: cut(t.request, p.req), answer: p.ans && t.answer ? cut(t.answer, p.ans) : "" }));
    const l = lines(shown, cards.slice(0, p.cards));
    if (total(l) <= max) return l.join("\n");
  }
  const onlyMap = lines([], []).join("\n");
  return onlyMap && modelTokens(onlyMap) <= max ? onlyMap : "";
}

/** A cápsula vai na frente do primeiro pedido da janela nova, depois do começo fixo (o cache pega o fixo antes dela). */
export function withCapsule(capsule: string, text: string): string {
  return capsule ? `${capsule}\n\n${text}` : text;
}
