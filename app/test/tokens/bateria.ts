// A bateria da Bússola (ADR 0013, T13702): a pasta falsa grande, os 30 pedidos com a política de hoje e o simulador
// de idas calibrado com o registro do harry. O resultado é o "antes" de todos os PRs da Bússola, e o "depois" de cada
// peça que já entrou: a janela curta e a cápsula (peça 5, T13835) usam os mesmos pedidos e as mesmas idas.
//
//   bun test/tokens/bateria.ts [--notas 20000] [--json saida.json]
//
// Pesado (escreve 20 mil notas num tmp e indexa): pegue `kiwi lock bench` antes. No CI roda só uma pasta pequena
// (`bateria.test.ts`).

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { tempDir } from "../tmp.ts";
import { buildCapsule, type CapsuleMap, type CapsuleTurn, folderCounts, modelTokens, WINDOW_IDLE_MS, WINDOW_MAX_TOKENS, type WindowCloseReason } from "../../src/agent/window.ts";
import { calibrar, PARTES, type Calibracao, type PedidoSimulado, type Registro, simular, somar, textoFalso } from "./idas.ts";
import { abrirPasta, gerarPasta } from "./pasta-grande.ts";
import { PEDIDOS, type Pedido } from "./pedidos.ts";
import { type Execucao, politicaComFind, politicaComPacote, politicaDeHoje } from "./politica.ts";
import { buildIndex } from "../../src/agent/faro.ts";
import { RegistroEntrega } from "../../src/agent/entrega.ts";
import { listaAntes, toolMeasures } from "./measure.ts";
import { countTokens } from "../../src/agent/token-count.ts";
import { kiwiCallFor } from "../../src/agent/tools/kiwi-tool.ts";

/** A sessão da bateria: um dia de uso, com o cache vencendo 4 vezes (como no registro do harry). */
export const pausaDe = (i: number) => (i % 8 === 0 ? 70 : 5);

/**
 * Depois de quais pedidos o Kiwi lê o `/usage` (ADR 0013, #13853): no máximo um a cada 10 min de sessão. Na bateria não
 * há conversa com o gato na tela, então só o intervalo conta.
 */
export function usageDepoisDe(pausas: readonly number[]): boolean[] {
  let relogio = 0;
  let ultimo = -Infinity;
  return pausas.map((pausa) => {
    relogio += pausa;
    if (relogio - ultimo < 10) return false;
    ultimo = relogio;
    return true;
  });
}

export interface Linha {
  pedido: Pedido;
  achou: boolean;
  sim: PedidoSimulado;
}

export interface Resultado {
  notas: number;
  falado: boolean;
  cal: Calibracao;
  linhas: Linha[];
  /** O `/usage` de depois dos pedidos (ADR 0013): quantas leituras, e quanto ele soma na conta (está no total). */
  usage: { leituras: number; tokens: number };
  /** O faro (T14359): quantos pedidos foram certo, provável e nada, e quantos certos erraram o alvo. */
  faro: { certo: number; provavel: number; nada: number; certoErrado: number };
  /** As chamadas de ferramenta dos 30 pedidos, quantas deram erro (T14133) e quantas, com a `kiwi`, pela forma (T14563). */
  chamadas: { total: number; erros: number; erroChamada: number; idasPorErroChamada: number };
  /** O depois da janela curta (T13835): os mesmos pedidos e idas, com a sessão curta e a cápsula. */
  depois: { sim: PedidoSimulado[]; capsulas: number[]; maxTokens: number };
  /**
   * As releituras sem mudança (T14682), na janela curta: um texto inteiro (a nota ou a seção) que chegou ao agente igual
   * a um que já tinha chegado na mesma janela. E os tokens que elas somam ao pedido em que entraram.
   */
  relidas: { vezes: number; chars: number };
  /** Com o registro (T14682): o depois com as janelas recalculadas pela regra do app (o `depois` usa as dadas). */
  livre?: PedidoSimulado[];
}

/**
 * As releituras sem mudança: as entregas de cada pedido, contadas por janela (a janela que abre antes de um pedido
 * esquece o que veio antes dela).
 */
export function relidasDe(entregas: readonly (readonly { key: string; texto: string }[])[], abre: (i: number) => boolean): { vezes: number; chars: number } {
  let vistas = new Map<string, string>();
  let vezes = 0;
  let chars = 0;
  for (const [i, es] of entregas.entries()) {
    if (abre(i)) vistas = new Map();
    for (const e of es) {
      if (vistas.get(e.key) === e.texto) {
        vezes++;
        chars += e.texto.length;
      }
      vistas.set(e.key, e.texto);
    }
  }
  return { vezes, chars };
}

const ESCREVE = new Set(["acrescentar", "trocar trecho", "organizar"]);

/**
 * As cápsulas da bateria (T13835): a do app (`buildCapsule`), com os 3 pedidos de antes de cada um, uma resposta do
 * tamanho que o roteiro deu, a nota que ele tocou (o alvo, quando achou) e o mapa da pasta de verdade.
 */
async function capsulasDa(execs: readonly Execucao[], pedidos: readonly Pedido[], falado: boolean, map: CapsuleMap): Promise<number[]> {
  const turnos: CapsuleTurn[] = execs.map((e, i) => {
    const p = pedidos[i]!;
    const nota = e.achou && /\.(md|txt)$/i.test(p.alvo) ? [p.alvo] : [];
    return {
      request: falado ? p.falado : p.texto,
      // A resposta: o texto da última ida do roteiro, do tamanho dela (uns 4 caracteres por token).
      answer: textoFalso(Math.min(600, e.roteiro.idas.at(-1)!.saida * 4)),
      read: ESCREVE.has(p.tipo) ? [] : nota,
      changed: ESCREVE.has(p.tipo) ? nota : [],
    };
  });
  return execs.map((_, n) => {
    const c = buildCapsule(turnos.slice(Math.max(0, n - 3), n), map);
    return c ? modelTokens(c) : 0;
  });
}

export function calibracaoDoHarry(): Calibracao {
  const r = JSON.parse(readFileSync(path.join(import.meta.dir, "registro-forma.json"), "utf8")) as Registro;
  return calibrar(r);
}

/**
 * O peso da lista de antes no modelo (ADR 0013, peça 6): as 21 ferramentas pesavam uns 5,3 mil tokens em toda ida, no
 * registro do harry. O fator da calibração (`cal.fator`) é de texto, e no JSON das ferramentas o contador local conta
 * cada aspa e chave: ele daria mais que o fixo inteiro. Por isso o depois é a proporção medida, sobre os 5,3 mil.
 */
export const LISTA_ANTES_MODELO = 5300;

/** O fixo por ida com a ferramenta única (T14563): o de antes, menos a lista de antes, mais a `kiwi`, na proporção. */
export async function fixoUnica(cal: Calibracao): Promise<{ antes: number; depois: number; lista: { antes: number; depois: number } }> {
  const [, lista] = await toolMeasures();
  const antes = listaAntes();
  const depois = Math.round(LISTA_ANTES_MODELO * (lista!.tokens / antes));
  return { antes: cal.fixo, depois: cal.fixo - LISTA_ANTES_MODELO + depois, lista: { antes: LISTA_ANTES_MODELO, depois } };
}

export async function calibracaoUnica(): Promise<Calibracao> {
  const cal = calibracaoDoHarry();
  return { ...cal, fixo: (await fixoUnica(cal)).depois };
}

/** Roda os pedidos numa pasta nova (uma por variante: as escritas mudam a pasta). */
export async function rodarBateria(o: {
  notas: number;
  falado: boolean;
  pedidos?: Pedido[];
  maxTokens?: number;
  find?: boolean;
  pacote?: boolean;
  unica?: boolean;
  diferenca?: boolean;
  /**
   * O registro de entrega (T14682), zerado antes dos pedidos em que a janela abre. As janelas saem de uma rodada sem o
   * registro (`janelasDe`): com ele os pedidos encolhem, e uma janela pode abrir mais tarde. Zerar antes é o lado seguro.
   */
  registro?: { janelas: ReadonlyMap<number, WindowCloseReason> };
}): Promise<Resultado> {
  const base = tempDir("kiwi-bussola-");
  try {
    const root = path.join(base, "KiwiNotes");
    const notas = gerarPasta(root, { notas: o.notas });
    const { vault, reader, writer } = await abrirPasta(root);
    try {
      const pedidos = o.pedidos ?? PEDIDOS;
      const execs: Execucao[] = [];
      const politica = o.find ? politicaComFind : politicaDeHoje;
      const faro = { certo: 0, provavel: 0, nada: 0, certoErrado: 0 };
      const registro = o.registro ? new RegistroEntrega() : undefined;
      if (o.pacote) {
        // O índice do faro (T14359), uma vez: a bateria não renomeia nada.
        const [list, projects, meetings] = await Promise.all([reader.list(), reader.projects(), reader.meetings()]);
        const idx = buildIndex({ notes: list.notes, folders: list.folders, projects, meetings });
        for (const [i, p] of pedidos.entries()) {
          if (registro && o.registro!.janelas.has(i)) registro.zerar();
          registro?.novoPedido();
          const e = await politicaComPacote({ reader, writer, registro }, p, { falado: o.falado, pausaMin: pausaDe(i), unica: o.unica, diferenca: o.diferenca }, idx);
          faro[e.faro]++;
          if (e.certoErrado) faro.certoErrado++;
          execs.push(e);
        }
      } else
        for (const [i, p] of pedidos.entries()) {
          if (registro && o.registro!.janelas.has(i)) registro.zerar();
          registro?.novoPedido();
          execs.push(await politica({ reader, writer, registro }, p, { falado: o.falado, pausaMin: pausaDe(i), unica: o.unica, diferenca: o.diferenca }));
        }
      const cal = o.unica ? await calibracaoUnica() : calibracaoDoHarry();
      const usage = usageDepoisDe(execs.map((e) => e.roteiro.pausaMin));
      const sim = simular(execs.map((e, i) => ({ ...e.roteiro, usageDepois: usage[i] })), cal);
      const semUsage = somar(simular(execs.map((e) => e.roteiro), cal)).total;
      // O depois da janela curta: o mapa da pasta é o da pasta falsa, lido como o app lê.
      const [list, projects] = await Promise.all([reader.list(), reader.projects()]);
      const map: CapsuleMap = { projects: projects.map((p) => ({ name: p.name, folder: p.folder, notes: p.notes })), folders: folderCounts(list.notes) };
      const capsulas = await capsulasDa(execs, pedidos, o.falado, map);
      const maxTokens = o.maxTokens ?? WINDOW_MAX_TOKENS;
      const janela = { maxTokens, idleMin: WINDOW_IDLE_MS / 60_000, capsula: (n: number) => capsulas[n]! };
      const roteiros = execs.map((e, i) => ({ ...e.roteiro, usageDepois: usage[i] }));
      const depois = simular(roteiros, cal, { janela: { ...janela, ...(o.registro ? { dadas: o.registro.janelas } : {}) } });
      return {
        notas,
        falado: o.falado,
        cal,
        linhas: pedidos.map((p, i) => ({ pedido: p, achou: execs[i]!.achou, sim: sim[i]! })),
        usage: { leituras: usage.filter(Boolean).length, tokens: somar(sim).total - semUsage },
        depois: { sim: depois, capsulas, maxTokens },
        relidas: relidasDe(
          execs.map((e) => e.entregas),
          (i) => !!depois[i]!.janela,
        ),
        ...(o.registro ? { livre: simular(roteiros, cal, { janela }) } : {}),
        faro,
        chamadas: (() => {
          const cs = execs.flatMap((e) => e.roteiro.idas.flatMap((i) => i.ferramentas));
          // Uma ida por erro de chamada: a ida que teve uma chamada de forma errada e só existiu para tentar de novo.
          const idas = execs.flatMap((e) => e.roteiro.idas);
          return {
            total: cs.length,
            erros: cs.filter((c) => c.erro).length,
            erroChamada: cs.filter((c) => c.erroChamada).length,
            idasPorErroChamada: idas.filter((i) => i.ferramentas.some((c) => c.erroChamada)).length,
          };
        })(),
      };
    } finally {
      vault.close();
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

const mil = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1).replace(".", ",")} mil` : String(n));
const pct = (a: number, b: number) => `${b ? ((100 * a) / b).toFixed(1).replace(".", ",") : "0"} %`;

/** A tabela do "antes": por pedido, as idas e as cinco partes, e a soma com as metas do ADR. */
export function tabela(r: Resultado): string {
  const linhas = [
    `| # | Tipo | Achou | Idas | Pedido | Achar | Ler | Bagagem | Fixo | Total |`,
    `|---:|---|:---:|---:|---:|---:|---:|---:|---:|---:|`,
    ...r.linhas.map(({ pedido: p, achou, sim: s }) =>
      `| ${p.id} | ${p.tipo} | ${achou ? "sim" : "não"} | ${s.idas.length} | ${PARTES.map((k) => mil(s.partes[k])).join(" | ")} | ${mil(s.total)} |`,
    ),
  ];
  const t = somar(r.linhas.map((l) => l.sim));
  linhas.push(`| | **soma** | ${r.linhas.filter((l) => l.achou).length}/${r.linhas.length} | ${t.idas} | ${PARTES.map((k) => mil(t.partes[k])).join(" | ")} | **${mil(t.total)}** |`);
  return linhas.join("\n");
}

/** Os números do ADR 0013 para o "antes": idas por pedido, o que vai em achar e errar, a bagagem e o fixo. */
export function resumo(r: Resultado): Record<string, string> {
  const t = somar(r.linhas.map((l) => l.sim));
  const leitura = r.linhas.filter((l) => !["acrescentar", "trocar trecho", "organizar"].includes(l.pedido.tipo));
  const idasAMais = r.linhas.flatMap((l) => l.sim.idas).filter((i) => i.motivo === "achar" || i.motivo === "erro");
  const tokensAMais = idasAMais.reduce((s, i) => s + i.cacheLido + i.cacheEscrito + i.saida, 0);
  return {
    pasta: `${r.notas} notas`,
    versao: r.falado ? "falada" : "digitada",
    "idas por pedido": (t.idas / r.linhas.length).toFixed(2).replace(".", ","),
    "pedidos de leitura em 1 ida": `${leitura.filter((l) => l.sim.idas.length === 1).length}/${leitura.length}`,
    "achou o alvo": `${r.linhas.filter((l) => l.achou).length}/${r.linhas.length}`,
    "tokens em idas só para achar ou errar": pct(tokensAMais, t.total),
    "bagagem no começo do último pedido": mil(r.linhas.at(-1)!.sim.idas[0]!.partes.bagagem),
    "fixo por ida": mil(r.cal.fixo),
    total: mil(t.total),
    "leitura de cache / escrita / saída": `${mil(t.cacheLido)} / ${mil(t.cacheEscrito)} / ${mil(t.saida)}`,
    "o /usage na conversa": `${r.usage.leituras} leituras, +${mil(r.usage.tokens)} (${pct(r.usage.tokens, t.total)} do total)`,
  };
}

/** A bagagem no começo de cada pedido (a 1ª ida dele): o que veio de pedidos de antes. */
export const bagagens = (sim: readonly PedidoSimulado[]) => sim.map((p) => p.idas[0]!.partes.bagagem);

/** O antes e o depois da janela curta (T13835), lado a lado, com as metas do ADR 0013. */
export function resumoJanela(r: Resultado): Record<string, string> {
  const antes = somar(r.linhas.map((l) => l.sim));
  const depois = somar(r.depois.sim);
  const bA = bagagens(r.linhas.map((l) => l.sim));
  const bD = bagagens(r.depois.sim);
  const longas = r.linhas.map((l, i) => (l.sim.frio && i > 0 ? i : -1)).filter((i) => i >= 0);
  const janelas = r.depois.sim.map((p) => p.janela).filter(Boolean) as string[];
  const conta = (k: string) => janelas.filter((j) => j === k).length;
  return {
    pasta: `${r.notas} notas`,
    versao: r.falado ? "falada" : "digitada",
    "teto da janela": `${r.depois.maxTokens} tokens`,
    "janelas abertas": `${janelas.length} (1ª: ${conta("start")}, pausa: ${conta("idle")}, tamanho: ${conta("size")})`,
    "cápsula (mín–máx)": `${Math.min(...r.depois.capsulas)}–${Math.max(...r.depois.capsulas)} tokens`,
    "bagagem máx. no começo de um pedido": `${mil(Math.max(...bA))} → ${mil(Math.max(...bD))}`,
    "bagagem no começo do último pedido": `${mil(bA.at(-1)!)} → ${mil(bD.at(-1)!)}`,
    "bagagem depois de pausa longa (máx.)": `${mil(Math.max(...longas.map((i) => bA[i]!)))} → ${mil(Math.max(...longas.map((i) => bD[i]!)))}`,
    "bagagem somada": `${mil(antes.partes.bagagem)} → ${mil(depois.partes.bagagem)}`,
    total: `${mil(antes.total)} → ${mil(depois.total)} (${pct(depois.total - antes.total, antes.total)})`,
    "leitura de cache / escrita / saída": `${mil(antes.cacheLido)} / ${mil(antes.cacheEscrito)} / ${mil(antes.saida)} → ${mil(depois.cacheLido)} / ${mil(depois.cacheEscrito)} / ${mil(depois.saida)}`,
  };
}

/** A tabela do depois: por pedido, a janela que abriu, a bagagem no começo e o total, antes e depois. */
export function tabelaJanela(r: Resultado): string {
  const linhas = [
    `| # | Pausa | Janela | Cápsula | Bagagem antes | Bagagem depois | Total antes | Total depois |`,
    `|---:|---:|---|---:|---:|---:|---:|---:|`,
    ...r.linhas.map((l, i) => {
      const d = r.depois.sim[i]!;
      return `| ${l.pedido.id} | ${pausaDe(i)} min | ${d.janela ?? ""} | ${d.janela ? r.depois.capsulas[i] : ""} | ${mil(l.sim.idas[0]!.partes.bagagem)} | ${mil(d.idas[0]!.partes.bagagem)} | ${mil(l.sim.total)} | ${mil(d.total)} |`;
    }),
  ];
  return linhas.join("\n");
}

/**
 * O `find` e o erro que ensina (T14133), sobre a janela curta: a mesma bateria com a política de hoje e com o `find`,
 * as duas com a janela. As idas por pedido, as idas que só acharam ou erraram, a parte "achar" e o total.
 */
export function resumoFind(hoje: Resultado, comFind: Resultado): Record<string, string> {
  const conta = (r: Resultado) => {
    const t = somar(r.depois.sim);
    const idas = r.depois.sim.flatMap((p) => p.idas);
    const aMais = idas.filter((i) => i.motivo === "achar" || i.motivo === "erro");
    return { t, idas: t.idas, aMais: aMais.length, aMaisTokens: aMais.reduce((s, i) => s + i.cacheLido + i.cacheEscrito + i.saida, 0) };
  };
  const a = conta(hoje);
  const b = conta(comFind);
  return {
    pasta: `${hoje.notas} notas`,
    versao: hoje.falado ? "falada" : "digitada",
    "achou o alvo": `${hoje.linhas.filter((l) => l.achou).length}/${hoje.linhas.length} → ${comFind.linhas.filter((l) => l.achou).length}/${comFind.linhas.length}`,
    "idas por pedido": `${(a.idas / hoje.linhas.length).toFixed(2).replace(".", ",")} → ${(b.idas / comFind.linhas.length).toFixed(2).replace(".", ",")}`,
    "idas só para achar ou errar": `${a.aMais} → ${b.aMais}`,
    "tokens nessas idas": `${pct(a.aMaisTokens, a.t.total)} → ${pct(b.aMaisTokens, b.t.total)} do total`,
    // O risco do ADR: com a ferramenta nova, o erro de chamada não pode passar de 5 %.
    "chamadas com erro": `${hoje.chamadas.erros}/${hoje.chamadas.total} (${pct(hoje.chamadas.erros, hoje.chamadas.total)}) → ${comFind.chamadas.erros}/${comFind.chamadas.total} (${pct(comFind.chamadas.erros, comFind.chamadas.total)})`,
    "parte achar": `${mil(a.t.partes.achar)} → ${mil(b.t.partes.achar)}`,
    total: `${mil(a.t.total)} → ${mil(b.t.total)} (${pct(b.t.total - a.t.total, a.t.total)})`,
  };
}

/**
 * O faro e o pacote (T14359), sobre o find e a janela: os pedidos em 1 ida (a meta do ADR), as idas por pedido, os
 * certos que erraram o alvo, e o total.
 */
export function resumoPacote(comFind: Resultado, comPacote: Resultado): Record<string, string> {
  const umaIda = (r: Resultado) => r.depois.sim.filter((p) => p.idas.length === 1).length;
  const t = (r: Resultado) => somar(r.depois.sim);
  const f = comPacote.faro;
  return {
    pasta: `${comFind.notas} notas`,
    versao: comFind.falado ? "falada" : "digitada",
    "o faro": `${f.certo} certos (${f.certoErrado} com o alvo errado), ${f.provavel} prováveis, ${f.nada} nada`,
    "achou o alvo": `${comFind.linhas.filter((l) => l.achou).length}/${comFind.linhas.length} → ${comPacote.linhas.filter((l) => l.achou).length}/${comPacote.linhas.length}`,
    "pedidos em 1 ida": `${umaIda(comFind)}/${comFind.linhas.length} → ${umaIda(comPacote)}/${comPacote.linhas.length}`,
    "idas por pedido": `${(t(comFind).idas / comFind.linhas.length).toFixed(2).replace(".", ",")} → ${(t(comPacote).idas / comPacote.linhas.length).toFixed(2).replace(".", ",")}`,
    "parte achar": `${mil(t(comFind).partes.achar)} → ${mil(t(comPacote).partes.achar)}`,
    "parte pedido (com o pacote)": `${mil(t(comFind).partes.pedido)} → ${mil(t(comPacote).partes.pedido)}`,
    total: `${mil(t(comFind).total)} → ${mil(t(comPacote).total)} (${pct(t(comPacote).total - t(comFind).total, t(comFind).total)})`,
  };
}

/**
 * A ferramenta única e o cartão (T14563), sobre o faro, o pacote e a janela: o fixo por ida, as idas por pedido, as
 * chamadas com erro de forma (o limite do ADR: 5 %), o que os cartões somam ao pedido, e o total.
 */
export async function resumoUnica(comPacote: Resultado, unica: Resultado): Promise<Record<string, string>> {
  const t = (r: Resultado) => somar(r.depois.sim);
  const f = await fixoUnica(comPacote.cal);
  const c = unica.chamadas;
  return {
    pasta: `${comPacote.notas} notas`,
    versao: comPacote.falado ? "falada" : "digitada",
    "lista de ferramentas": `${mil(f.lista.antes)} → ${mil(f.lista.depois)}`,
    "fixo por ida": `${mil(f.antes)} → ${mil(f.depois)}`,
    "idas por pedido": `${(t(comPacote).idas / comPacote.linhas.length).toFixed(2).replace(".", ",")} → ${(t(unica).idas / unica.linhas.length).toFixed(2).replace(".", ",")}`,
    "chamadas com erro de forma": `${c.erroChamada}/${c.total} (${pct(c.erroChamada, c.total)}); idas por erro de chamada: ${c.idasPorErroChamada}`,
    "parte pedido (com os cartões)": `${mil(t(comPacote).partes.pedido)} → ${mil(t(unica).partes.pedido)}`,
    "parte fixo": `${mil(t(comPacote).partes.fixo)} → ${mil(t(unica).partes.fixo)}`,
    total: `${mil(t(comPacote).total)} → ${mil(t(unica).total)} (${pct(t(unica).total - t(comPacote).total, t(comPacote).total)})`,
  };
}

/**
 * A mesma escrita numa nota grande (T14650): a pasta falsa só tem notas pequenas, e a diferença aparece onde a nota
 * cresce. Uma nota de 12 seções com ~1 mil caracteres cada; o que o agente manda (a saída, o contador local vezes o
 * fator) para trocar uma frase, acrescentar uma linha e organizar (mover, renomear e juntar), antes e depois.
 */
export function escritaNotaGrande(fator = calibracaoDoHarry().fator): { caso: string; antes: number; depois: number }[] {
  const frase = (s: number, i: number) => `- Item ${i + 1} da seção ${s + 1}: a Ana combinou com o time do Projeto X o que falta e quando entrega.`;
  const secoes = Array.from({ length: 12 }, (_, s) => `## Seção ${s + 1}\n\n${Array.from({ length: 11 }, (_, i) => frase(s, i)).join("\n")}\n`);
  const nota = `# Projeto X\n\n${secoes.join("\n")}`;
  const path = "Projetos/Projeto X.md";
  const v = "0123456789abcdef";
  const t = (tool: string, args: Record<string, unknown>) => Math.round(countTokens(JSON.stringify(kiwiCallFor(tool, args))) * fator);
  const alvo = frase(4, 6);
  const novo = alvo.replace("quando entrega", "entrega na sexta");
  const secao5 = secoes[4]!;
  // O número conta o título da nota: a "Seção 5" é a 6. Organizar: a seção 9 sobe para antes da 2, a 3 ganha outro nome e a 12 entra na 11.
  const reorganizada = [secoes[0], secoes[8], ...secoes.slice(1, 8), ...secoes.slice(9, 11), secoes[11]].join("\n");
  return [
    { caso: "trocar uma frase", antes: t("notes_write", { path, section: "Seção 5", text: secao5.replace(alvo, novo), version: v }), depois: t("notes_edit", { path, old: "quando entrega", text: "entrega na sexta", section: 6, version: v }) },
    { caso: "acrescentar uma linha", antes: t("notes_write", { path, text: `${nota}- mais uma linha\n`, version: v }), depois: t("notes_append", { path, text: "- mais uma linha" }) },
    {
      caso: "organizar (mover, renomear, juntar)",
      antes: t("notes_write", { path, text: `# Projeto X\n\n${reorganizada}`, version: v }),
      depois: t("notes_section_move", { path, section: 10, before: 3, version: v }) + t("notes_section_rename", { path, section: 4, title: "Prazos", version: v }) + t("notes_section_merge", { path, section: 12, with: 13, version: v }),
    },
  ];
}

/** Os pedidos que escrevem. */
export const ESCRITAS = ["acrescentar", "trocar trecho", "organizar"] as const;

/** Só as escritas de um resultado: as idas, a saída, o que as chamadas mandaram e o total, depois da janela. */
export function escritas(r: Resultado) {
  const ps = r.depois.sim.filter((_, i) => (ESCRITAS as readonly string[]).includes(r.linhas[i]!.pedido.tipo));
  const t = somar(ps);
  return { pedidos: ps.length, idas: t.idas, saida: t.saida, total: t.total };
}

/**
 * Escrever só a diferença (T14650), sobre a ferramenta única, o faro, o pacote e a janela: nas escritas, as idas (a
 * leitura antes some), a saída (o texto que o agente manda) e o total; e o total dos 30 pedidos.
 */
export function resumoDiferenca(unica: Resultado, dif: Resultado): Record<string, string> {
  const a = escritas(unica);
  const b = escritas(dif);
  const t = (r: Resultado) => somar(r.depois.sim);
  return {
    pasta: `${unica.notas} notas`,
    versao: unica.falado ? "falada" : "digitada",
    "escritas": `${a.pedidos} pedidos`,
    "idas nas escritas": `${a.idas} → ${b.idas}`,
    "saída nas escritas": `${mil(a.saida)} → ${mil(b.saida)} (${pct(b.saida - a.saida, a.saida)})`,
    "total nas escritas": `${mil(a.total)} → ${mil(b.total)} (${pct(b.total - a.total, a.total)})`,
    "chamadas com erro": `${unica.chamadas.erros}/${unica.chamadas.total} → ${dif.chamadas.erros}/${dif.chamadas.total}`,
    total: `${mil(t(unica).total)} → ${mil(t(dif).total)} (${pct(t(dif).total - t(unica).total, t(unica).total)})`,
  };
}

/** Os pedidos em que a janela curta abriu (T14682): o registro de entrega zera antes deles. */
export const janelasDe = (r: Resultado): Map<number, WindowCloseReason> => new Map(r.depois.sim.flatMap((p, i) => (p.janela ? [[i, p.janela] as const] : [])));

/**
 * O registro de entrega (T14682), sobre a diferença, a ferramenta única, o faro, o pacote e a janela: as releituras sem
 * mudança (a meta: nenhuma), a parte "ler", achar e ler juntos (a meta do ADR: até 10 %) e o total.
 */
export function resumoRegistro(dif: Resultado, reg: Resultado): Record<string, string> {
  const t = (r: Resultado) => somar(r.depois.sim);
  const al = (r: Resultado) => t(r).partes.achar + t(r).partes.ler;
  const metaAL = (100 * al(reg)) / t(reg).total <= 10;
  return {
    pasta: `${dif.notas} notas`,
    versao: dif.falado ? "falada" : "digitada",
    "notas sem mudança relidas por inteiro": `${dif.relidas.vezes} (${mil(dif.relidas.chars)} caracteres) → ${reg.relidas.vezes} (meta: nenhuma, ${reg.relidas.vezes === 0 ? "atingida" : "não atingida"})`,
    "parte ler": `${mil(t(dif).partes.ler)} → ${mil(t(reg).partes.ler)}`,
    "parte pedido (com o pacote)": `${mil(t(dif).partes.pedido)} → ${mil(t(reg).partes.pedido)}`,
    "achar e ler": `${pct(al(dif), t(dif).total)} → ${pct(al(reg), t(reg).total)} (meta: até 10 %, ${metaAL ? "atingida" : "não atingida"})`,
    "total, com as mesmas janelas": `${mil(t(dif).total)} → ${mil(t(reg).total)} (${pct(t(reg).total - t(dif).total, t(dif).total)})`,
    ...(reg.livre
      ? (() => {
          const l = somar(reg.livre);
          const ja = (s: readonly PedidoSimulado[]) => s.flatMap((p, i) => (p.janela ? [`${i + 1}`] : [])).join(", ");
          return {
            "total, com a janela recalculada": `${mil(t(dif).total)} → ${mil(l.total)} (${pct(l.total - t(dif).total, t(dif).total)}); a janela abre antes dos pedidos ${ja(dif.depois.sim)} → ${ja(reg.livre)}`,
          };
        })()
      : {}),
  };
}

if (import.meta.main) {
  const arg = (n: string, d: string) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1]! : d;
  };
  const notas = Number(arg("notas", "20000"));
  const teto = arg("teto", "");
  const json = arg("json", "");
  const out: Record<string, unknown> = {};
  for (const falado of [false, true]) {
    const t0 = performance.now();
    const r = await rodarBateria({ notas, falado, ...(teto ? { maxTokens: Number(teto) } : {}) });
    console.log(`\n## ${falado ? "Falada" : "Digitada"} (${r.notas} notas, ${((performance.now() - t0) / 1000).toFixed(1)} s)\n`);
    console.log(tabela(r));
    console.log("");
    for (const [k, v] of Object.entries(resumo(r))) console.log(`- ${k}: ${v}`);
    console.log(`\n### A janela curta (T13835)\n`);
    console.log(tabelaJanela(r));
    console.log("");
    for (const [k, v] of Object.entries(resumoJanela(r))) console.log(`- ${k}: ${v}`);
    const comFind = await rodarBateria({ notas, falado, find: true, ...(teto ? { maxTokens: Number(teto) } : {}) });
    const comPacote = await rodarBateria({ notas, falado, pacote: true, ...(teto ? { maxTokens: Number(teto) } : {}) });
    console.log(`\n### O faro e o pacote (T14359), com o find e a janela\n`);
    for (const [k, v] of Object.entries(resumoPacote(comFind, comPacote))) console.log(`- ${k}: ${v}`);
    out[`${falado ? "falada" : "digitada"}-pacote`] = { resumo: resumoPacote(comFind, comPacote), pedidos: comPacote.depois.sim.map((d, i) => ({ id: comPacote.linhas[i]!.pedido.id, achou: comPacote.linhas[i]!.achou, idas: d.idas.length, total: d.total })) };
    const unica = await rodarBateria({ notas, falado, pacote: true, unica: true, ...(teto ? { maxTokens: Number(teto) } : {}) });
    const rU = await resumoUnica(comPacote, unica);
    console.log(`\n### A ferramenta única e o cartão (T14563), com o faro, o pacote e a janela\n`);
    for (const [k, v] of Object.entries(rU)) console.log(`- ${k}: ${v}`);
    const dif = await rodarBateria({ notas, falado, pacote: true, unica: true, diferenca: true, ...(teto ? { maxTokens: Number(teto) } : {}) });
    const rD = resumoDiferenca(unica, dif);
    console.log(`\n### Escrever só a diferença (T14650), com a ferramenta única, o faro, o pacote e a janela\n`);
    for (const [k, v] of Object.entries(rD)) console.log(`- ${k}: ${v}`);
    if (!falado) {
      console.log(`\n### A mesma escrita numa nota grande (12 seções, ~13 mil caracteres), o que o agente manda\n`);
      console.log("| caso | antes | depois |\n|---|---|---|");
      for (const c of escritaNotaGrande()) console.log(`| ${c.caso} | ${c.antes} | ${c.depois} (${pct(c.depois - c.antes, c.antes)}) |`);
    }
    const reg = await rodarBateria({ notas, falado, pacote: true, unica: true, diferenca: true, registro: { janelas: janelasDe(dif) }, ...(teto ? { maxTokens: Number(teto) } : {}) });
    const rR = resumoRegistro(dif, reg);
    console.log(`\n### O registro de entrega (T14682), com a diferença, a ferramenta única, o faro, o pacote e a janela\n`);
    for (const [k, v] of Object.entries(rR)) console.log(`- ${k}: ${v}`);
    out[`${falado ? "falada" : "digitada"}-registro`] = { resumo: rR, pedidos: reg.depois.sim.map((d, i) => ({ id: reg.linhas[i]!.pedido.id, tipo: reg.linhas[i]!.pedido.tipo, idas: d.idas.length, ler: d.partes.ler, total: d.total })) };
    out[`${falado ? "falada" : "digitada"}-diferenca`] = { resumo: rD, pedidos: dif.depois.sim.map((d, i) => ({ id: dif.linhas[i]!.pedido.id, tipo: dif.linhas[i]!.pedido.tipo, idas: d.idas.length, saida: d.saida, total: d.total })) };
    out[`${falado ? "falada" : "digitada"}-unica`] = { resumo: rU, pedidos: unica.depois.sim.map((d, i) => ({ id: unica.linhas[i]!.pedido.id, achou: unica.linhas[i]!.achou, idas: d.idas.length, total: d.total })) };
    console.log(`\n### O find e o erro que ensina (T14133), com a janela\n`);
    for (const [k, v] of Object.entries(resumoFind(r, comFind))) console.log(`- ${k}: ${v}`);
    out[`${falado ? "falada" : "digitada"}-find`] = { resumo: resumoFind(r, comFind), janela: resumoJanela(comFind), pedidos: comFind.depois.sim.map((d, i) => ({ id: comFind.linhas[i]!.pedido.id, achou: comFind.linhas[i]!.achou, idas: d.idas.length, motivos: d.idas.map((x) => x.motivo), total: d.total })) };
    out[falado ? "falada" : "digitada"] = { resumo: resumo(r), janela: { resumo: resumoJanela(r), capsulas: r.depois.capsulas, pedidos: r.depois.sim.map((d, i) => ({ id: r.linhas[i]!.pedido.id, janela: d.janela ?? null, bagagem: d.idas[0]!.partes.bagagem, total: d.total })) }, calibracao: r.cal, pedidos: r.linhas.map((l) => ({ id: l.pedido.id, tipo: l.pedido.tipo, achou: l.achou, idas: l.sim.idas.length, motivos: l.sim.idas.map((i) => i.motivo), partes: l.sim.partes, cacheLido: l.sim.cacheLido, cacheEscrito: l.sim.cacheEscrito, saida: l.sim.saida, total: l.sim.total })) };
  }
  if (json) writeFileSync(json, `${JSON.stringify(out, null, 1)}\n`);
}
