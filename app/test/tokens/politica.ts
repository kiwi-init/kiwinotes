// A política de hoje, roteirizada (ADR 0013, T13702): para cada pedido, a sequência de ferramentas que o agente de
// verdade faz hoje (buscar, listar, ler, escrever), rodando as ferramentas do Kiwi de verdade na pasta falsa. O que
// cada uma devolve é o texto de verdade, e o simulador de idas (`idas.ts`) conta o resto. É o "antes" dos PRs da Bússola.
//
// O roteiro é otimista com o agente de hoje, para o "antes" não exagerar:
// - ele reconhece o alvo assim que o caminho aparece em qualquer resultado, mesmo com o nome errado do ditado;
// - quando a busca falha, ele tenta uma vez a palavra mais longa do nome; depois anda pelas pastas a partir da raiz,
//   escolhendo de primeira a pasta certa em cada nível;
// - "essa nota" ele não sabe qual é (hoje o Kiwi não manda a nota aberta): pergunta de volta, e o pedido não acaba.

import { countTokens } from "../../src/agent/token-count.ts";
import type { VaultReader } from "../../src/agent/tools/reader.ts";
import { runKiwiTool, sectionOf, ToolError } from "../../src/agent/tools/tools.ts";
import { buildPackage } from "../../src/agent/pacote.ts";
import { cardsBlock, cardsFor, KIWI_TOOL, kiwiCallFor, resolveKiwiCall, runKiwiCall } from "../../src/agent/tools/kiwi-tool.ts";
import { type FaroIndex, sniff } from "../../src/agent/faro.ts";
import type { VaultWriter } from "../../src/agent/tools/writer.ts";
import type { RegistroEntrega } from "../../src/agent/entrega.ts";
import type { Chamada, IdaRoteiro, PedidoRoteiro } from "./idas.ts";
import type { Pedido } from "./pedidos.ts";

/** O que o modelo escreve além das chamadas: um pouco de raciocínio por ida, e a resposta final. */
const PENSAR = 40;
const RESPOSTA = { ler: 150, resumo: 220, escrever: 40, perguntar: 60 } as const;

export interface Execucao {
  roteiro: PedidoRoteiro;
  /** O agente chegou ao alvo (e, numa escrita, escreveu). */
  achou: boolean;
  /**
   * Os textos inteiros que chegaram ao agente (T14682), por leitura ou pelo pacote: a nota (ou a seção) e o texto. A
   * bateria conta, depois, os que já tinham chegado iguais na mesma janela (a releitura sem mudança).
   */
  entregas: { key: string; texto: string }[];
}

interface Ctx {
  reader: VaultReader;
  writer: VaultWriter;
  /** O registro de entrega (ADR 0013 peça 4, T14682): sem ele, o agente recebe a nota inteira a cada leitura. */
  registro?: RegistroEntrega;
}

/**
 * Roda um pedido com a política de hoje. `falado`: o pedido como o ditado entrega. `find` (ADR 0013 peça 3, T14133): o
 * agente acha o alvo pelo `find` numa chamada, e só cai no caminho de hoje se ele não achar.
 */
export async function politicaDeHoje(
  ctx: Ctx,
  p: Pedido,
  o: {
    falado: boolean;
    pausaMin: number;
    find?: boolean;
    pacote?: { kind: "certo" | "provavel"; texto: string };
    unica?: boolean;
    diferenca?: boolean;
    /** O que o pacote já entregou inteiro (T14682). */
    entregas?: Execucao["entregas"];
  },
): Promise<Execucao> {
  const texto = o.falado ? p.falado : p.texto;
  /** Os cartões de instrução (T14563), com a ferramenta única: só os que o pedido pede. */
  const cartoes = o.unica ? cardsBlock(cardsFor(texto)) : "";
  /** O que vai ao agente: o pacote do faro (T14359), quando há, os cartões e o pedido. */
  const enviado = [o.pacote?.texto ?? "", cartoes, texto].filter(Boolean).join("\n\n");
  const nome = o.falado ? p.nomeFalado : p.nome;
  const idas: IdaRoteiro[] = [];
  const entregas: Execucao["entregas"] = [...(o.entregas ?? [])];
  let atual: Chamada[] = [];
  let saidaAtual = PENSAR;

  /** Uma chamada de ferramenta na ida de agora: o resultado é o texto que o agente recebe. */
  const chamar = async (nome: string, args: Record<string, unknown>): Promise<{ texto: string; valor: Record<string, unknown> | null }> => {
    let texto: string;
    let valor: Record<string, unknown> | null = null;
    let erro = false;
    let erroChamada = false;
    const tctx = { reader: ctx.reader, writer: ctx.writer, journal: { keep: async () => "", drop: async () => {} }, registro: ctx.registro };
    // Com a ferramenta única (T14563), a chamada é a da `kiwi`, como o agente a escreve. Um erro de chamada é a forma
    // errada: a `kiwi` não entendeu (E_BAD_ARGS ao resolver) ou entendeu outra ação, com outros argumentos.
    const kiwi = o.unica ? kiwiCallFor(nome, args) : null;
    if (kiwi) {
      try {
        const r = resolveKiwiCall(kiwi);
        erroChamada = r.tool !== nome || JSON.stringify(r.args) !== JSON.stringify(args);
      } catch {
        erroChamada = true;
      }
    }
    try {
      valor = kiwi
        ? (await runKiwiCall(tctx, kiwi, { writes: true, proposes: true, memory: true })).value
        : (await runKiwiTool(tctx, nome, args)).value;
      texto = JSON.stringify(valor);
      // Um texto inteiro que chegou (sem o registro, ou na primeira vez): a bateria conta as releituras sem mudança.
      const v = valor as { path?: string; texto?: unknown; offset?: number; proximoOffset?: number };
      if (nome === "notes_read" && typeof v.texto === "string" && !v.offset && v.proximoOffset === undefined)
        entregas.push({ key: `${v.path}\u0000${typeof args.section === "string" ? args.section : ""}`, texto: v.texto });
    } catch (e) {
      erro = true;
      texto = `${e instanceof ToolError ? e.code : "E_FAILED"}: ${e instanceof Error ? e.message : String(e)}`;
    }
    const argumentos = JSON.stringify(kiwi ? { name: KIWI_TOOL, arguments: kiwi } : args);
    atual.push({ nome, argumentosChars: argumentos.length, resultadoChars: texto.length, erro, erroChamada, resultado: texto });
    saidaAtual += countTokens(argumentos) + 10;
    return { texto, valor };
  };
  /** Fecha a ida de agora (o agente esperou os resultados) e abre a próxima. */
  const proxima = () => {
    idas.push({ ferramentas: atual, saida: saidaAtual });
    atual = [];
    saidaAtual = PENSAR;
  };
  /** A última ida: a resposta, sem ferramenta. */
  const responder = (tokens: number) => {
    idas.push({ ferramentas: [], saida: tokens });
  };
  const fim = (achou: boolean): Execucao => ({ roteiro: { pedidoChars: enviado.length, pedido: enviado, pausaMin: o.pausaMin, idas }, achou, entregas });
  const tem = (t: string, alvo: string) => t.includes(`"${alvo}"`) || t.includes(`"${alvo}/`);

  /** Anda da raiz até onde o alvo (uma nota ou uma pasta) aparece, uma listagem por ida. */
  const andarAte = async (alvo: string): Promise<boolean> => {
    const pastas = alvo.split("/").slice(0, -1);
    for (let i = 0; i <= pastas.length; i++) {
      const r = await chamar("notes_list", { folder: pastas.slice(0, i).join("/") });
      proxima();
      if (tem(r.texto, alvo)) return true;
    }
    return false;
  };

  /** Acha uma nota pelo nome: a busca, a palavra mais longa, e a caminhada pelas pastas. */
  const acharNota = async (): Promise<boolean> => {
    if (nome && o.find) {
      const r = await chamar("find", { nome });
      proxima();
      if (tem(r.texto, p.alvo)) return true;
    }
    if (nome) {
      const r = await chamar("notes_search", { query: nome });
      proxima();
      if (tem(r.texto, p.alvo)) return true;
      const palavra = nome.split(/\s+/).sort((a, b) => b.length - a.length)[0]!;
      if (palavra !== nome) {
        const r2 = await chamar("notes_search", { query: palavra });
        proxima();
        if (tem(r2.texto, p.alvo)) return true;
      }
    }
    return andarAte(p.alvo);
  };

  // O pacote do faro (T14359): no certo, o alvo e o texto já vieram com o pedido; no provável, os cartões.
  if (o.pacote?.kind === "certo" && !["acrescentar", "trocar trecho", "organizar"].includes(p.tipo)) {
    responder(["pasta", "projeto", "última reunião"].includes(p.tipo) ? RESPOSTA.resumo : RESPOSTA.ler);
    return fim(true);
  }
  if (o.pacote?.kind === "provavel" && !["acrescentar", "trocar trecho", "organizar"].includes(p.tipo)) {
    const lido = await chamar(p.tipo === "pasta" ? "notes_list" : p.tipo === "última reunião" ? "meetings_get" : "notes_read", p.tipo === "pasta" ? { folder: p.alvo } : { path: p.alvo });
    proxima();
    responder(lido.valor ? RESPOSTA.ler : RESPOSTA.perguntar);
    return fim(!!lido.valor);
  }

  switch (p.tipo) {
    case "essa nota":
      // Hoje o pedido não diz qual nota está aberta: o agente pergunta.
      responder(RESPOSTA.perguntar);
      return fim(false);
    case "última reunião": {
      const lista = await chamar("meetings_list", {});
      proxima();
      if (!tem(lista.texto, p.alvo)) {
        responder(RESPOSTA.perguntar);
        return fim(false);
      }
      await chamar("meetings_get", { path: p.alvo });
      proxima();
      responder(RESPOSTA.resumo);
      return fim(true);
    }
    case "pasta": {
      const r = await chamar("notes_list", { folder: nome });
      proxima();
      let achou = tem(r.texto, p.alvo);
      // Com o find: o erro da pasta que não existe leva ao find, que acha a pasta pelo nome mal escrito.
      if (!achou && o.find) {
        const f = await chamar("find", { nome, tipo: "pasta" });
        proxima();
        if (tem(f.texto, p.alvo)) {
          await chamar("notes_list", { folder: p.alvo });
          proxima();
          achou = true;
        }
      }
      // O nome do ditado não acha a pasta: anda até ela aparecer, e lista o que tem dentro.
      if (!achou && (await andarAte(p.alvo))) {
        await chamar("notes_list", { folder: p.alvo });
        proxima();
        achou = true;
      }
      responder(achou ? RESPOSTA.resumo : RESPOSTA.perguntar);
      return fim(achou);
    }
    case "projeto": {
      // Com o find: o projeto e a nota principal numa chamada; depois, a nota principal.
      if (o.find) {
        const f = await chamar("find", { nome, tipo: "projeto" });
        proxima();
        const alvo = (f.valor?.alvos as { path: string; principal?: string | null }[] | undefined)?.find((x) => x.path === p.alvo);
        if (alvo?.principal) {
          await chamar("notes_read", { path: alvo.principal });
          proxima();
          responder(RESPOSTA.resumo);
          return fim(true);
        }
      }
      const lista = await chamar("projects_list", {});
      proxima();
      // O agente reconhece o projeto na lista, mesmo com o nome do ditado.
      const projeto = p.alvo.split("/").pop()!;
      if (!tem(lista.texto, p.alvo) && !lista.texto.includes(projeto)) {
        responder(RESPOSTA.perguntar);
        return fim(false);
      }
      await chamar("project_status", { projeto });
      proxima();
      await chamar("notes_read", { path: `${p.alvo}/${projeto}.md` });
      proxima();
      responder(RESPOSTA.resumo);
      return fim(true);
    }
    default: {
      // Com o pacote, o alvo já veio: no certo também o texto e a versão (a escrita vai direto); no provável, o cartão
      // (lê o escolhido uma vez).
      if (!o.pacote && !(await acharNota())) {
        responder(RESPOSTA.perguntar);
        return fim(false);
      }
      // Escrever só a diferença (ADR 0013 peça 7, T14650): acrescentar não precisa do texto, e a versão veio no cartão
      // (do pacote ou do find): a ida da leitura some.
      if (o.diferenca && p.tipo === "acrescentar") {
        await chamar("notes_append", { path: p.alvo, text: `- ${texto.split(":").pop()!.trim()}`, ...(p.secao ? { section: p.secao } : {}) });
        proxima();
        responder(RESPOSTA.escrever);
        return fim(true);
      }
      const lido =
        o.pacote?.kind === "certo"
          ? await (async () => {
              const n = await ctx.reader.get(p.alvo);
              const secao = p.secao ? sectionText(n.content, p.secao) : null;
              return { texto: "", valor: { versao: n.version ?? "", texto: secao ?? n.content } as Record<string, unknown> };
            })()
          : await chamar("notes_read", { path: p.alvo, ...(p.secao ? { section: p.secao } : {}) });
      if (o.pacote?.kind !== "certo") proxima();
      const versao = typeof lido.valor?.versao === "string" ? lido.valor.versao : "";
      let conteudo = typeof lido.valor?.texto === "string" ? lido.valor.texto : typeof lido.valor?.conteudo === "string" ? lido.valor.conteudo : "";
      // O registro de entrega (T14682): "já está com você" ou só a diferença. O agente tem o texto na conversa.
      if (!conteudo && lido.valor && (lido.valor.jaEntregue || lido.valor.diferenca)) {
        const n = await ctx.reader.get(p.alvo);
        conteudo = (p.secao ? sectionText(n.content, p.secao) : null) ?? n.content;
      }
      if (p.tipo === "acrescentar") {
        await chamar("notes_append", { path: p.alvo, text: `- ${texto.split(":").pop()!.trim()}`, ...(p.secao ? { section: p.secao } : {}), version: versao });
        proxima();
        responder(RESPOSTA.escrever);
      } else if (p.tipo === "trocar trecho") {
        if (o.diferenca) {
          // Só o trecho (T14650): a última linha, com a mesma troca de hoje. O mesmo resultado, sem a seção de volta.
          const linha = conteudo.split("\n").filter((l) => l.trim() && !/^#/.test(l)).at(-1)!;
          await chamar("notes_edit", { path: p.alvo, old: linha, text: `${linha}\n(atualizado)`, version: versao, ...(p.secao ? { section: p.secao } : {}) });
        } else {
          // Hoje o trecho é a seção inteira (ou a nota), reescrita com a troca.
          await chamar("notes_write", { path: p.alvo, text: `${conteudo}\n(atualizado)`, version: versao, ...(p.secao ? { section: p.secao } : {}) });
        }
        proxima();
        responder(RESPOSTA.escrever);
      } else if (p.tipo === "organizar") {
        const organizado = `## Organizado\n\n${conteudo.split("\n").filter(Boolean).map((l) => `- ${l.replace(/^[#-]+\s*/, "")}`).join("\n")}`;
        // Organizar devolve a nota inteira, reescrita. Com a diferença (T14650), vai só o que entra: a nota fica igual.
        if (o.diferenca) await chamar("notes_append", { path: p.alvo, text: `\n${organizado}`, version: versao });
        else await chamar("notes_write", { path: p.alvo, text: `${conteudo}\n\n${organizado}`, version: versao });
        proxima();
        responder(RESPOSTA.escrever);
      } else responder(RESPOSTA.ler);
      return fim(true);
    }
  }
}

/** A política com o `find` (ADR 0013 peça 3, T14133): a de hoje, achando o alvo pelo nome numa chamada. */
export const politicaComFind = (ctx: Ctx, p: Pedido, o: { falado: boolean; pausaMin: number; unica?: boolean; diferenca?: boolean }): Promise<Execucao> =>
  politicaDeHoje(ctx, p, { ...o, find: true });

/** O texto de uma seção, como o notes_read devolve. */
function sectionText(content: string, title: string): string | null {
  return sectionOf(content, title)?.texto ?? null;
}

/**
 * A política com o faro e o pacote (ADR 0013 peças 1 e 2, T14359): o Kiwi acha o alvo antes e manda junto. No certo,
 * o agente responde (ou escreve) direto; no provável, lê o escolhido; no nada, cai na política com o find.
 */
export async function politicaComPacote(
  ctx: Ctx,
  p: Pedido,
  o: { falado: boolean; pausaMin: number; unica?: boolean; diferenca?: boolean },
  idx: FaroIndex,
): Promise<Execucao & { faro: "certo" | "provavel" | "nada"; certoErrado: boolean }> {
  const texto = o.falado ? p.falado : p.texto;
  const r = sniff(texto, idx, { openNote: p.aberta ?? null });
  const alvo = (path: string, main?: string | null) => path === p.alvo || main === p.alvo || p.alvo === path.replace(/\/[^/]+$/, "");
  if (r.kind === "nada") return { ...(await politicaDeHoje(ctx, p, { ...o, find: true })), faro: "nada", certoErrado: false };
  const pkg = await buildPackage({ reader: ctx.reader, seen: async (_path, content) => content, registro: ctx.registro }, r, texto);
  if (!pkg) return { ...(await politicaDeHoje(ctx, p, { ...o, find: true })), faro: "nada", certoErrado: false };
  // Um certo errado: o agente recebeu a nota errada. Na bateria, ele percebe e procura pelo find (o pior caso).
  const certoErrado = r.kind === "certo" && !alvo(r.hit.target.path, r.hit.target.main);
  if (certoErrado) return { ...(await politicaDeHoje(ctx, p, { ...o, find: true })), faro: "certo", certoErrado: true };
  // A nota que foi inteira no pacote (T14682): conta como entregue, para a releitura de depois.
  const entregas: Execucao["entregas"] = [];
  for (const d of pkg.delivered.filter((x) => x.text)) {
    const n = await ctx.reader.get(d.path).catch(() => null);
    if (n && pkg.text.includes(`<<<\n${n.content}\n>>>`)) entregas.push({ key: `${n.path}\u0000`, texto: n.content });
  }
  const exec = await politicaDeHoje(ctx, p, { ...o, pacote: { kind: r.kind === "certo" ? "certo" : "provavel", texto: pkg.text }, entregas });
  return { ...exec, faro: r.kind === "certo" ? "certo" : "provavel", certoErrado: false };
}
