// O simulador de idas (ADR 0013, spec #13435, T13702): quantas vezes o agente chama o modelo num pedido e quantos tokens
// cada chamada carrega, sem chamar modelo nenhum. É o "antes" de cada peça da Bússola.
//
// Uma ida é uma chamada ao modelo. Cada uma manda de novo tudo o que a sessão já tem:
// - o fixo (as instruções do Claude Code e a lista de ferramentas), uma vez por sessão no começo;
// - a conversa acumulada (os pedidos de antes, as respostas, os resultados das ferramentas);
// - o que este pedido juntou até aqui.
// Com o cache quente, a ida lê do cache tudo o que a anterior tinha e escreve só o que é novo (a saída anterior, o
// pedido, os resultados das ferramentas). Depois de mais de 1 hora parado, o cache venceu: a ida escreve a sessão
// inteira de novo, e o Claude Code ainda acrescenta os avisos da retomada (`aFrio`).
//
// Os tokens saem do contador local (`src/agent/token-count.ts`) sobre textos do mesmo tamanho, vezes o `fator` da
// calibração, que sai do registro do harry (`registro-forma.json`, só números e nomes de ferramenta).

import { countTokens } from "../../src/agent/token-count.ts";
import { windowCloseReason, type WindowCloseReason } from "../../src/agent/window.ts";

/** Uma chamada de ferramenta numa ida: o nome, o tamanho do que foi pedido e do que voltou, e se deu erro. */
export interface Chamada {
  nome: string;
  argumentosChars: number;
  resultadoChars: number;
  erro: boolean;
  /** Com a ferramenta única (T14563): a forma da chamada estava errada (a `kiwi` não entendeu, ou entendeu outra coisa). */
  erroChamada?: boolean;
  /** O texto de verdade do resultado, quando se tem (a bateria roda as ferramentas do Kiwi). Sem ele, um texto falso do tamanho. */
  resultado?: string;
}

/** Uma ida do roteiro: as ferramentas que ela chama e a saída do modelo (em tokens). */
export interface IdaRoteiro {
  ferramentas: Chamada[];
  saida: number;
}

/** Um pedido do roteiro: o tamanho do texto que vai ao agente, quanto tempo a sessão ficou parada antes, e as idas. */
export interface PedidoRoteiro {
  pedidoChars: number;
  /** O texto de verdade do pedido, quando se tem. */
  pedido?: string;
  /** Minutos sem ida antes deste pedido (mais de 60: o cache venceu). */
  pausaMin: number;
  idas: IdaRoteiro[];
  /** Depois deste pedido o Kiwi leu o `/usage` (ADR 0013): a saída dele fica na conversa e vai nas idas seguintes. */
  usageDepois?: boolean;
}

/**
 * O que um `/usage` deixa na conversa do Claude Code: o comando e a saída dele, como um comando local fica no histórico.
 * Só o tamanho importa (o texto é o do agente falso).
 */
export const USAGE_NA_CONVERSA = [
  "<command-name>/usage</command-name>",
  "<command-message>usage</command-message>",
  "<command-args></command-args>",
  "<local-command-stdout>> Claude Max subscription usage",
  "",
  "**5-hour limit** — **37%** · Resets Nov 14, 6:40 PM",
  "",
  "`███████░░░░░░░░░░░░░`",
  "",
  "**Weekly · all models** — **12%** · Resets Nov 18, 3:09 PM</local-command-stdout>",
].join("\n");

/** Os números da calibração (ver `calibrar`). */
export interface Calibracao {
  /** As instruções do Claude Code e a lista de ferramentas, em tokens. */
  fixo: number;
  /** O contador local vezes isto dá os tokens do modelo. */
  fator: number;
  /** O que cada pedido e cada resultado de ferramenta levam além do texto (as marcas do Claude Code), em tokens. */
  porItem: number;
  /** O que a retomada a frio acrescenta à sessão, em tokens. */
  aFrio: number;
}

/** As cinco partes do placar (ADR 0013). */
export const PARTES = ["pedido", "achar", "ler", "bagagem", "fixo"] as const;
export type Parte = (typeof PARTES)[number];
export type Partes = Record<Parte, number>;

/** Por que a ida existiu: a do pedido, ou uma a mais para achar, ler, só por erro, ou depois de uma escrita. */
export type Motivo = "pedido" | "achar" | "ler" | "erro" | "escrever";

export interface IdaSimulada {
  cacheLido: number;
  cacheEscrito: number;
  saida: number;
  motivo: Motivo;
  /** Os tokens desta ida (lidos, escritos e a saída) nas cinco partes. */
  partes: Partes;
}

export interface PedidoSimulado {
  idas: IdaSimulada[];
  frio: boolean;
  /** Com a janela curta (T13835): a janela nova que abriu antes deste pedido, e por quê. */
  janela?: WindowCloseReason;
  cacheLido: number;
  cacheEscrito: number;
  saida: number;
  total: number;
  partes: Partes;
}

/** As ferramentas que acham (buscar, listar) e as que leem. As outras escrevem ou propõem: são o próprio pedido. */
const ACHAR = new Set(["find", "notes_search", "notes_list", "projects_list", "meetings_list"]);
const LER = new Set(["notes_read", "notes_outline", "files_read", "meetings_get", "project_status"]);

/** A parte de um resultado: um erro é parte da caça ao alvo (achar), mesmo numa ferramenta de ler. */
export function parteDe(c: Pick<Chamada, "nome" | "erro">): Parte {
  if (c.erro || ACHAR.has(c.nome)) return "achar";
  if (LER.has(c.nome)) return "ler";
  return "pedido";
}

/** Por que a ida seguinte existiu, pelas ferramentas desta. */
function motivoDe(ferramentas: readonly Chamada[]): Motivo {
  if (!ferramentas.length) return "pedido";
  if (ferramentas.every((c) => c.erro)) return "erro";
  if (ferramentas.some((c) => LER.has(c.nome) && !c.erro)) return "ler";
  if (ferramentas.some((c) => ACHAR.has(c.nome))) return "achar";
  return "escrever";
}

// ── Os textos falsos ─────────────────────────────────────────────────────────────────────────────────────────────────

const PALAVRAS = "nota pasta projeto reunião mudança prazo caixas pendência resumo semana equipe arquivo legado contrato planilha relatório revisão orçamento".split(" ");

/** Um pedido falso de `chars` caracteres, em português. */
export function textoFalso(chars: number): string {
  let s = "";
  for (let i = 0; s.length < chars; i++) s += `${PALAVRAS[(i * 7) % PALAVRAS.length]}${i % 9 === 8 ? ". " : " "}`;
  return s.slice(0, chars);
}

/** Um resultado falso de ferramenta de `chars` caracteres: o JSON que as ferramentas do Kiwi devolvem (caminhos, títulos, trechos). */
export function resultadoFalso(chars: number): string {
  let s = '{"resultados":[';
  for (let i = 0; s.length < chars; i++) {
    s += `${i ? "," : ""}{"path":"Projetos/Area ${i % 7}/Nota ${i}.md","title":"Nota ${i}","trecho":"${textoFalso(60 + ((i * 13) % 40))}","score":0.${(97 - i) % 100}}`;
  }
  return s.slice(0, chars);
}

const tokensDe = (texto: string, cal: Pick<Calibracao, "fator">) => Math.round(countTokens(texto) * cal.fator);
const tokensPedido = (p: PedidoRoteiro, cal: Calibracao) => tokensDe(p.pedido ?? textoFalso(p.pedidoChars), cal) + cal.porItem;
const tokensResultado = (c: Chamada, cal: Calibracao) => tokensDe(c.resultado ?? resultadoFalso(c.resultadoChars), cal) + cal.porItem;

// ── A simulação ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Um pedaço da sessão: quantos tokens e de qual pedido e parte ele é. */
interface Pedaco {
  tokens: number;
  pedido: number;
  parte: Parte;
}

const vazias = (): Partes => ({ pedido: 0, achar: 0, ler: 0, bagagem: 0, fixo: 0 });

/**
 * A janela curta (ADR 0013 peça 5, T13835) no simulador: as mesmas regras do app (`windowCloseReason`), e o tamanho da
 * cápsula com que cada janela abre (a do app, `buildCapsule`, sobre os pedidos de antes).
 */
export interface JanelaSim {
  maxTokens: number;
  idleMin: number;
  /** A cápsula da janela que abre antes do pedido `n`, em tokens do modelo. */
  capsula: (n: number) => number;
  /**
   * As janelas, dadas (T14682): abrem antes destes pedidos, e só deles. Para comparar duas rodadas com as mesmas
   * janelas: sem isto, uma rodada com pedidos menores fecha a janela por tamanho mais tarde.
   */
  dadas?: ReadonlyMap<number, WindowCloseReason>;
}

/**
 * Simula uma sessão inteira: os pedidos em ordem, cada um com as idas do roteiro. Com a `janela`, a sessão é curta: ela
 * fecha antes de um pedido pela regra do app, e a nova começa com o fixo (no cache, se a pausa foi menor que 1 hora: as
 * instruções e as ferramentas do Claude Code são as mesmas) e a cápsula; nada da conversa de antes, nem os avisos da
 * retomada.
 */
export function simular(pedidos: readonly PedidoRoteiro[], cal: Calibracao, o: { janela?: JanelaSim } = {}): PedidoSimulado[] {
  const sessao: Pedaco[] = [];
  let prefixo = 0; // o que a última ida mandou (lido + escrito): o que o cache tem
  let pendente: Pedaco[] = []; // o que entra na próxima ida (a saída anterior, o pedido, os resultados)
  const out: PedidoSimulado[] = [];
  const conversa = () => [...sessao, ...pendente].reduce((s, x) => s + (x.parte === "fixo" ? 0 : x.tokens), 0);
  pedidos.forEach((p, n) => {
    const frio = n === 0 || p.pausaMin > 60;
    let janela: WindowCloseReason | undefined;
    if (o.janela) {
      const w = n === 0 ? null : { sessionId: "s", startedAt: 0, lastIdaAt: 0, tokens: conversa() };
      janela = o.janela.dadas
        ? o.janela.dadas.get(n)
        : (windowCloseReason(w, { now: p.pausaMin * 60_000, idleMs: o.janela.idleMin * 60_000, maxTokens: o.janela.maxTokens }) ?? undefined);
      if (janela) {
        sessao.length = 0;
        pendente = [{ tokens: cal.fixo, pedido: -1, parte: "fixo" }];
        const capsula = o.janela.capsula(n);
        if (capsula) pendente.push({ tokens: capsula, pedido: n - 1, parte: "bagagem" });
      }
    }
    const idas: IdaSimulada[] = [];
    p.idas.forEach((ida, i) => {
      if (n === 0 && i === 0 && !janela) pendente.push({ tokens: cal.fixo, pedido: -1, parte: "fixo" });
      if (i === 0) pendente.push({ tokens: tokensPedido(p, cal), pedido: n, parte: "pedido" });
      // A retomada a frio: a sessão inteira vai de novo, e os avisos da retomada ficam nela.
      if (i === 0 && frio && n > 0 && !janela) pendente.push({ tokens: cal.aFrio, pedido: n - 1, parte: "bagagem" });
      const novo = pendente.reduce((s, x) => s + x.tokens, 0);
      sessao.push(...pendente);
      pendente = [];
      // A janela nova: só o fixo pode estar no cache (o de outra sessão, igual), e só com o cache quente.
      const emCache = janela ? (frio ? 0 : cal.fixo) : prefixo;
      const lido = i === 0 && (frio || janela) ? (janela ? emCache : 0) : prefixo;
      const escrito = i === 0 && (frio || janela) ? (janela ? novo - emCache : prefixo + novo) : novo;
      prefixo = lido + escrito;
      // As partes: cada pedaço da sessão conta uma vez por ida; o que é de pedidos de antes é bagagem.
      const partes = vazias();
      for (const x of sessao) partes[x.parte === "fixo" ? "fixo" : x.pedido < n ? "bagagem" : x.parte] += x.tokens;
      // A saída é da parte das ferramentas que ela chamou; a resposta final é do pedido.
      const parteSaida = ida.ferramentas.length ? parteDe(ida.ferramentas[0]!) : "pedido";
      partes[parteSaida] += ida.saida;
      idas.push({ cacheLido: lido, cacheEscrito: escrito, saida: ida.saida, motivo: i === 0 ? "pedido" : motivoDe(p.idas[i - 1]!.ferramentas), partes });
      pendente.push({ tokens: ida.saida, pedido: n, parte: parteSaida });
      for (const c of ida.ferramentas) pendente.push({ tokens: tokensResultado(c, cal), pedido: n, parte: parteDe(c) });
    });
    // O `/usage` de depois do pedido entra na conversa: é bagagem dali em diante.
    if (p.usageDepois) pendente.push({ tokens: tokensDe(USAGE_NA_CONVERSA, cal) + cal.porItem, pedido: n, parte: "bagagem" });
    const soma = (k: "cacheLido" | "cacheEscrito" | "saida") => idas.reduce((s, x) => s + x[k], 0);
    const partes = vazias();
    for (const ida of idas) for (const k of PARTES) partes[k] += ida.partes[k];
    out.push({ idas, frio, ...(janela ? { janela } : {}), cacheLido: soma("cacheLido"), cacheEscrito: soma("cacheEscrito"), saida: soma("saida"), total: soma("cacheLido") + soma("cacheEscrito") + soma("saida"), partes });
  });
  return out;
}

/** A soma de uma sessão simulada. */
export function somar(pedidos: readonly PedidoSimulado[]): { idas: number; cacheLido: number; cacheEscrito: number; saida: number; total: number; partes: Partes } {
  const partes = vazias();
  for (const p of pedidos) for (const k of PARTES) partes[k] += p.partes[k];
  const s = (k: "cacheLido" | "cacheEscrito" | "saida" | "total") => pedidos.reduce((a, p) => a + p[k], 0);
  return { idas: pedidos.reduce((a, p) => a + p.idas.length, 0), cacheLido: s("cacheLido"), cacheEscrito: s("cacheEscrito"), saida: s("saida"), total: s("total"), partes };
}

// ── O registro do harry e a calibração ───────────────────────────────────────────────────────────────────────────────

/** Uma ida como o registro guarda: as ferramentas, a entrada fora do cache, o cache lido e escrito, e a saída. */
export interface IdaRegistro {
  ferramentas: Chamada[];
  entrada: number;
  cacheLido: number;
  cacheEscrito: number;
  saida: number;
}
export interface Registro {
  pedidos: { pedidoChars: number; idas: IdaRegistro[] }[];
}

/**
 * O roteiro de um registro: as mesmas idas e ferramentas, com os mesmos tamanhos. O registro não guarda a hora: a
 * pausa sai do cache (a 1ª ida de um pedido sem nada lido do cache foi uma retomada a frio).
 */
export function roteiroDoRegistro(r: Registro): PedidoRoteiro[] {
  return r.pedidos.map((p, n) => ({
    pedidoChars: p.pedidoChars,
    pausaMin: n > 0 && p.idas[0]!.cacheLido === 0 ? 61 : 5,
    idas: p.idas.map((i) => ({ ferramentas: i.ferramentas, saida: i.saida })),
  }));
}

/**
 * A calibração, tirada do registro (só os números dele):
 * - `fator` e `porItem`: o melhor ajuste (mínimos quadrados) do que cada ida quente escreveu, contra o contador local
 *   sobre os textos novos dela (o pedido ou os resultados) e quantos itens novos ela teve;
 * - `fixo`: o que a 1ª ida escreveu, menos o pedido;
 * - `aFrio`: a média do que as retomadas a frio escreveram além da sessão.
 */
export function calibrar(r: Registro): Calibracao {
  const P = r.pedidos;
  // Cada ida quente: escrito − a saída anterior = fator × (contador sobre o novo) + porItem × (itens novos).
  const xs: { t: number; k: number; y: number }[] = [];
  let anterior = 0;
  P.forEach((p, n) => {
    p.idas.forEach((ida, i) => {
      const frio = i === 0 && ida.cacheLido === 0;
      if (!frio && !(n === 0 && i === 0)) {
        const textos = i === 0 ? [textoFalso(p.pedidoChars)] : p.idas[i - 1]!.ferramentas.map((c) => resultadoFalso(c.resultadoChars));
        xs.push({ t: textos.reduce((s, x) => s + countTokens(x), 0), k: textos.length, y: ida.cacheEscrito + ida.entrada - anterior });
      }
      anterior = ida.saida;
    });
  });
  // Mínimos quadrados de y = a·t + b·k.
  const S = (f: (x: (typeof xs)[number]) => number) => xs.reduce((s, x) => s + f(x), 0);
  const tt = S((x) => x.t * x.t), tk = S((x) => x.t * x.k), kk = S((x) => x.k * x.k), ty = S((x) => x.t * x.y), ky = S((x) => x.k * x.y);
  const det = tt * kk - tk * tk;
  const fator = (ty * kk - ky * tk) / det;
  const porItem = Math.max(0, Math.round((tt * ky - tk * ty) / det));
  const cal0: Calibracao = { fixo: 0, fator, porItem, aFrio: 0 };
  const primeira = P[0]!.idas[0]!;
  const fixo = Math.round(primeira.cacheEscrito + primeira.entrada - tokensPedido({ pedidoChars: P[0]!.pedidoChars, pausaMin: 0, idas: [] }, cal0));
  // A frio: o escrito menos o que a sessão tinha (o prefixo anterior, a saída anterior e o pedido novo).
  const extras: number[] = [];
  let prefixo = 0;
  let saida = 0;
  P.forEach((p, n) => {
    p.idas.forEach((ida, i) => {
      if (n > 0 && i === 0 && ida.cacheLido === 0) {
        extras.push(ida.cacheEscrito + ida.entrada - prefixo - saida - tokensPedido({ pedidoChars: p.pedidoChars, pausaMin: 0, idas: [] }, cal0));
      }
      prefixo = ida.cacheLido + ida.cacheEscrito + ida.entrada;
      saida = ida.saida;
    });
  });
  const aFrio = extras.length ? Math.round(extras.reduce((a, b) => a + b, 0) / extras.length) : 0;
  return { fixo, fator: Number(fator.toFixed(4)), porItem, aFrio };
}

/** A soma de um registro de verdade, para comparar com a simulação. */
export function somaDoRegistro(r: Registro): { idas: number; cacheLido: number; cacheEscrito: number; saida: number; total: number } {
  let idas = 0, cacheLido = 0, cacheEscrito = 0, saida = 0;
  for (const p of r.pedidos)
    for (const i of p.idas) {
      idas++;
      cacheLido += i.cacheLido;
      cacheEscrito += i.cacheEscrito + i.entrada;
      saida += i.saida;
    }
  return { idas, cacheLido, cacheEscrito, saida, total: cacheLido + cacheEscrito + saida };
}
