// As trilhas (ADR 0013, decisão 4 = A; T14682): quando o faro erra e o agente chega à nota certa por outro caminho, o
// Kiwi guarda a ligação entre as palavras do pedido e a nota, e da próxima vez ela sobe sozinha.
//
// - **É contagem, não modelo.** Uma trilha são algumas palavras do pedido, a nota e quantas vezes ela já levou lá.
// - **Ficam só no Mac**, em `<dados>/agent/trilhas.json` (0600). Visíveis e apagáveis, uma a uma, em Ajustes › Agente.
// - **Aprende:** no fim de um pedido em que o agente leu uma nota que o faro não deu como certa (no nada, no provável, ou
//   no certo de outro alvo). As palavras vêm do pedido já pelo filtro de segredos.
// - **Quais palavras** (spec #21283, T21325): a do pedido que está no nome da pasta ou da nota vale na hora, mesmo
//   comum; entre pastas irmãs, o pedaço único do nome é o forte. Fora do nome, só a palavra rara (fora das 3 mil comuns
//   do português e das que aparecem em muitas notas), e só na segunda vez: a trilha fica "aprendendo" até as mesmas
//   palavras levarem à mesma nota de novo, e guarda só as que vieram nas duas. O enchimento da fala cai sozinho.
// - **Casa:** quando o pedido traz pelo menos metade das palavras de uma trilha e pelo menos duas; uma só basta quando
//   ela é forte (o pedaço único do nome, um nome próprio, uma sigla, um código). Vale um pouco menos que o nome exato
//   da nota, e sobe com as vezes.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PALAVRAS_COMUNS } from "./palavras-comuns.ts";
import { nameKey } from "./tools/find.ts";

/** Uma trilha guardada. */
export interface Trilha {
  id: string;
  /** As palavras do pedido, como a pessoa disse (para a tela). */
  palavras: string[];
  /** As mesmas palavras pela chave (sem acento, maiúscula nem plural), para casar. */
  chaves: string[];
  /** As chaves que bastam sozinhas: o pedaço único do nome da pasta, ou um nome próprio, uma sigla, um código. */
  fortes?: string[];
  /**
   * As palavras raras de fora do nome que ainda esperam a segunda vez (T21325). Uma trilha sem `chaves` e só com elas
   * está "aprendendo": não casa com nada até elas se repetirem.
   */
  candidatas?: { palavras: string[]; chaves: string[] };
  /** A nota a que elas levaram. */
  path: string;
  /**
   * A pasta de notas da nota (a chave dela, o `ref.key`, T16650): o caminho só vale nela. Sem ela, um app de uma pasta só, ou uma
   * trilha de antes do T16650, que nenhuma pasta move nem tira.
   */
  pasta?: string;
  /** Quantas vezes elas levaram lá. */
  vezes: number;
  /** A última vez, em ms. */
  em: number;
}

/** As palavras de um pedido que viram trilha, no máximo. */
export const TRILHA_PALAVRAS = 6;
/** Quantas trilhas o Mac guarda: a mais antiga sai. */
export const TRILHAS_MAX = 200;
/** A parte das palavras da trilha que o pedido tem de trazer para ela casar. */
export const TRILHA_CASA = 0.5;

/** As palavras que não dizem o assunto (já sem acento): ficam fora da trilha. */
const VAZIAS = new Set(
  (
    "qual quais sobre como para pelo pela pelos pelas esse essa esses essas este esta estes estas isso isto aquele aquela " +
    "aquilo nota notas minha minhas meus onde quando porque fala falar falou diga dizer mostra mostre mostrar quero queria " +
    "saber tudo algo coisa coisas tambem ainda mais menos muito muita pode poderia voce preciso precisa achar acha ache " +
    "encontre encontrar procure procurar busque buscar leia ler resuma resumir resumo lista listar depois antes agora hoje " +
    "ontem dessa desse deste desta dessas desses nessa nesse nesta neste estou estao foram seria tenho temos eles elas " +
    "nosso nossa dele dela deles delas aqui umas favor obrigado entao tipo cade sera fazer feito fiz anotei anotado escrevi " +
    "escrito tinha tenha qualquer alguma algum nada nenhum nenhuma quanto quanta quantos quantas ficou ficar fica"
  ).split(" "),
);

/** A chave de uma palavra: sem acento e maiúscula, e sem o plural ("relatórios" casa "relatório"). */
export const chaveDaPalavra = (w: string): string => nameKey(w).replace(/(?<=..)s$/, "");

/** As palavras comuns (T21325), pela chave e pela grafia sem acento: "verdade", "beleza", "realmente". */
const COMUNS = (() => {
  const out = new Set<string>();
  for (const w of PALAVRAS_COMUNS.split(/\s+/)) if (w) out.add(nameKey(w)).add(chaveDaPalavra(w));
  return out;
})();

/** A palavra é comum no português, ou não diz o assunto. */
export const palavraComum = (w: string): boolean => {
  const n = nameKey(w);
  const k = chaveDaPalavra(w);
  return COMUNS.has(n) || COMUNS.has(k) || VAZIAS.has(n) || VAZIAS.has(k);
};

/** As palavras de um texto, na ordem, com a posição (para saber a primeira da frase). */
const palavrasDe = (t: string): string[] => t.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Rara de verdade (T21325): basta sozinha. Um código (letras e números: "Q3", "AB12"), uma sigla ("GCP", "ONG") ou um
 * nome próprio (maiúscula fora do começo do pedido). `primeira`: é a primeira palavra do pedido.
 */
export const raraDeVerdade = (w: string, primeira: boolean): boolean =>
  (/\p{L}/u.test(w) && /\p{N}/u.test(w)) || /^\p{Lu}{2,}$/u.test(w) || (!primeira && /^\p{Lu}\p{Ll}/u.test(w) && !palavraComum(w));

/**
 * As palavras de um pedido que dizem o assunto: as raras (fora das comuns e das vazias), as mais longas, na ordem em
 * que vieram. `fortes`: as que são raras de verdade.
 */
export function palavrasDoPedido(pedido: string): { palavras: string[]; chaves: string[]; fortes: string[] } {
  const vistas = new Map<string, string>();
  const fortes = new Set<string>();
  palavrasDe(pedido).forEach((w, i) => {
    const codigo = /\p{L}/u.test(w) && /\p{N}/u.test(w);
    if ((w.length < 4 && !codigo && !/^\p{Lu}{2,}$/u.test(w)) || /^\d+$/.test(w)) return;
    const k = chaveDaPalavra(w);
    if (palavraComum(w) || vistas.has(k)) return;
    vistas.set(k, w);
    if (raraDeVerdade(w, i === 0)) fortes.add(k);
  });
  const longas = new Set([...vistas.keys()].sort((a, b) => b.length - a.length).slice(0, TRILHA_PALAVRAS));
  const chaves = [...vistas.keys()].filter((k) => longas.has(k));
  return { palavras: chaves.map((k) => vistas.get(k)!), chaves, fortes: chaves.filter((k) => fortes.has(k)) };
}

/** Onde está a nota que o agente leu (T21325): o nome que vale na hora e os vizinhos que dividem pedaços dele. */
export interface LugarDaNota {
  /** O nome da pasta da nota e o título dela. As palavras do pedido que estão neles viram palavra-chave na hora. */
  nomes: string[];
  /** Os nomes que disputam com eles: as pastas irmãs e as outras notas da pasta. O pedaço que está num deles é fraco. */
  vizinhos: string[];
  /** As chaves que aparecem em muitas notas: não viram palavra-chave fora do nome. */
  muitas?: ReadonlySet<string>;
}

/** As chaves de um nome, e a sigla das iniciais ("Horta Norte" → horta, norte e "hn"). */
function chavesDoNome(nome: string): { chaves: Set<string>; sigla: string | null } {
  const ws = palavrasDe(nome).filter((w) => w.length >= 3 || /\p{N}/u.test(w) || /^\p{Lu}{2,}$/u.test(w));
  const iniciais = palavrasDe(nome).filter((w) => w.length >= 3 || /^\p{Lu}/u.test(w));
  return {
    chaves: new Set(ws.map(chaveDaPalavra)),
    sigla: iniciais.length >= 2 ? iniciais.map((w) => nameKey(w)[0]).join("") : null,
  };
}

/**
 * As palavras do pedido que estão no nome da pasta ou da nota (T21325), mesmo comuns: sem acento, no plural ou pela
 * sigla das iniciais. `fortes`: as que nenhum vizinho tem (o pedaço único do nome).
 */
export function palavrasDoNome(pedido: string, lugar: LugarDaNota): { palavras: string[]; chaves: string[]; fortes: string[] } {
  const nomes = lugar.nomes.filter(Boolean).map(chavesDoNome);
  const vizinhos = lugar.vizinhos.map(chavesDoNome);
  const vistas = new Map<string, string>();
  const fortes: string[] = [];
  for (const w of palavrasDe(pedido)) {
    const k = chaveDaPalavra(w);
    const n = nameKey(w);
    // A sigla das iniciais só vale escrita em maiúsculas ("HN"): em minúsculas, "em" e "da" seriam a sigla de
    // "Ensaio Mensal" e de "Diário Antigo" (revisão do T21325).
    const sigla = siglaEscrita(w);
    const doNome = nomes.find((x) => x.chaves.has(k) || (sigla && x.sigla === n));
    if (!doNome || vistas.has(k) || (w.length < 3 && !(sigla && doNome.sigla === n))) continue;
    if (VAZIAS.has(n) || VAZIAS.has(k)) continue;
    vistas.set(k, w);
    if (!vizinhos.some((v) => v.chaves.has(k) || v.sigla === n)) fortes.push(k);
  }
  const chaves = [...vistas.keys()].slice(0, TRILHA_PALAVRAS);
  return { palavras: chaves.map((k) => vistas.get(k)!), chaves, fortes: fortes.filter((k) => chaves.includes(k)) };
}

/** Uma sigla escrita como sigla: só maiúsculas, duas letras ou mais ("HN", "ONG"). */
const siglaEscrita = (w: string): boolean => /^\p{Lu}{2,}$/u.test(w);

/**
 * Uma chave curta e comum ("em", "da", "que") só casa escrita em maiúsculas no pedido: veio de uma sigla, e em
 * minúsculas ela está em quase todo pedido.
 */
const soEmMaiusculas = (k: string): boolean => /^\p{L}{1,3}$/u.test(k) && (palavraComum(k) || VAZIAS.has(k));

/** O que uma trilha casou num pedido. */
export interface TrilhaCasada {
  trilha: Trilha;
  /** As palavras da trilha que vieram no pedido. */
  palavras: string[];
}

/**
 * As trilhas que o pedido segue: pelo menos duas palavras dela e pelo menos metade, ou uma forte. A que ainda está
 * aprendendo (sem `chaves`) não casa.
 */
export function trilhasDoPedido(pedido: string, trilhas: readonly Trilha[]): TrilhaCasada[] {
  if (!trilhas.length) return [];
  // Todas as palavras do pedido, mesmo as comuns: a trilha pode ter uma palavra comum que veio do nome da pasta.
  const tem = new Set<string>();
  for (const w of palavrasDe(pedido)) {
    const curta = [chaveDaPalavra(w), nameKey(w)];
    for (const k of curta) if (!soEmMaiusculas(k) || siglaEscrita(w)) tem.add(k);
  }
  const out: TrilhaCasada[] = [];
  for (const t of trilhas) {
    if (!t.chaves.length) continue;
    const i = t.chaves.flatMap((k, j) => (tem.has(k) ? [j] : []));
    const forte = i.some((j) => t.fortes?.includes(t.chaves[j]!));
    if (!forte && (i.length < 2 || i.length / t.chaves.length < TRILHA_CASA)) continue;
    out.push({ trilha: t, palavras: i.map((j) => t.palavras[j]!) });
  }
  return out;
}

/**
 * A nota que conta quando o agente leu várias (T21325): a primeira lida na pasta que tem a maioria delas (no empate, a
 * da primeira lida). Null: não leu nenhuma.
 */
export function notaDaMaioria(lidas: readonly string[]): string | null {
  if (!lidas.length) return null;
  const pastaDe = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const conta = new Map<string, number>();
  for (const p of lidas) conta.set(pastaDe(p), (conta.get(pastaDe(p)) ?? 0) + 1);
  let melhor = pastaDe(lidas[0]!);
  for (const [d, n] of conta) if (n > conta.get(melhor)!) melhor = d;
  return lidas.find((p) => pastaDe(p) === melhor)!;
}

/** A trilha ainda espera a segunda vez: não casa com nada. */
export const aprendendo = (t: Trilha): boolean => t.chaves.length === 0;

/**
 * Limpa uma trilha de antes do T21325: saem as palavras comuns e as vazias, e as que sobram e são raras de verdade
 * ficam fortes. Null: não sobrou nada.
 */
export function limparTrilha(t: Trilha): Trilha | null {
  const j = t.chaves.flatMap((k, i) => (palavraComum(t.palavras[i] ?? k) || palavraComum(k) ? [] : [i]));
  if (!j.length) return null;
  const chaves = j.map((i) => t.chaves[i]!);
  const palavras = j.map((i) => t.palavras[i] ?? t.chaves[i]!);
  // A trilha antiga não guarda a posição da palavra no pedido: a maiúscula do começo da frase não faz nome próprio,
  // e só o código e a sigla ficam fortes (revisão do T21325).
  const fortes = j.filter((i) => raraDeVerdade(t.palavras[i] ?? "", true)).map((i) => t.chaves[i]!);
  // Uma palavra sozinha que não é forte nunca mais casa: a trilha sai, em vez de ficar na tela como se valesse.
  if (chaves.length < 2 && !fortes.length) return null;
  const { candidatas: _c, fortes: _f, ...rest } = t;
  return { ...rest, chaves, palavras, ...(fortes.length ? { fortes } : {}) };
}

/** A trilha é desta pasta de notas (null: o app sem pastas). */
const daPasta = (t: Trilha, pasta: string | null) => (t.pasta ?? null) === pasta;

/** As trilhas que o faro pode seguir na pasta aberta: as dela, e as de antes do T16650, que não dizem a pasta. */
export const trilhasDaPasta = (ts: readonly Trilha[], pasta: string | null): Trilha[] => ts.filter((t) => !t.pasta || t.pasta === pasta);

/** O placar de uma trilha casada no faro: abaixo do nome exato, e sobe com as vezes e com as palavras que casaram. */
export const placarDaTrilha = (c: TrilhaCasada): number => 0.88 + 0.04 * Math.min(c.trilha.vezes, 3) + 0.02 * c.palavras.length;

/** A versão do arquivo: a 2 é a das palavras limpas (T21325); a 1 é limpa uma vez ao abrir. */
const VERSAO = 2;

/** As trilhas no disco. */
export class TrilhaStore {
  private readonly file: string;
  private cache: Trilha[] | null = null;

  constructor(
    dir: string,
    private readonly now: () => number = Date.now,
  ) {
    this.file = path.join(dir, "trilhas.json");
  }

  list(): Trilha[] {
    if (this.cache) return this.cache;
    let ts: Trilha[] = [];
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, "utf8")) as { version?: number; trilhas?: Trilha[] };
        if ((raw.version !== 1 && raw.version !== VERSAO) || !Array.isArray(raw.trilhas)) throw new Error("bad");
        ts = raw.trilhas.filter((t) => t && typeof t.path === "string" && Array.isArray(t.chaves) && Array.isArray(t.palavras));
        // As de antes do T21325 são limpas uma vez, pelas regras novas: a que fica vazia sai.
        if (raw.version === 1) {
          ts = ts.flatMap((t) => limparTrilha(t) ?? []);
          this.save(ts);
        }
      } catch {
        // Um arquivo estragado vai para o lado: as trilhas começam de novo, sem quebrar o pedido.
        try {
          renameSync(this.file, `${this.file}.bad`);
        } catch {
          // nada
        }
      }
    }
    this.cache = ts;
    return ts;
  }

  private save(ts: Trilha[]): void {
    this.cache = ts;
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: VERSAO, trilhas: ts }), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.file);
  }

  /**
   * O agente chegou a `notePath` por outro caminho: as palavras do pedido levam lá (T21325).
   * - As do nome da pasta ou da nota (`lugar`) entram na hora.
   * - As raras de fora do nome esperam: entram na segunda vez em que vierem para a mesma nota.
   * Uma trilha da mesma nota com alguma das mesmas palavras conta mais uma vez; senão, entra uma nova. Devolve a
   * trilha, ou null (o pedido não tinha palavra de assunto).
   */
  aprender(pedido: string, notePath: string, pasta: string | null = null, lugar?: LugarDaNota): Trilha | null {
    const nome = lugar ? palavrasDoNome(pedido, lugar) : { palavras: [], chaves: [], fortes: [] };
    const raras = palavrasDoPedido(pedido);
    // Fora do nome, e fora das que aparecem em muitas notas.
    const fora = raras.chaves.flatMap((k, i) => (nome.chaves.includes(k) || lugar?.muitas?.has(k) ? [] : [{ k, w: raras.palavras[i]! }]));
    if (!nome.chaves.length && !fora.length) return null;
    const ts = [...this.list()];
    const now = this.now();
    const novas = new Set([...nome.chaves, ...fora.map((x) => x.k)]);
    const mesma = ts.find((t) => t.path === notePath && daPasta(t, pasta) && [...t.chaves, ...(t.candidatas?.chaves ?? [])].some((k) => novas.has(k)));
    // As palavras confirmadas: as que já eram, as do nome, e as candidatas que vieram de novo.
    const palavras = new Map<string, string>();
    const fortes = new Set<string>([...(mesma?.fortes ?? []), ...nome.fortes]);
    mesma?.chaves.forEach((k, i) => palavras.set(k, mesma.palavras[i]!));
    nome.chaves.forEach((k, i) => palavras.has(k) || palavras.set(k, nome.palavras[i]!));
    const antes = new Set(mesma?.candidatas?.chaves ?? []);
    for (const { k, w } of fora) {
      if (!antes.has(k) || palavras.has(k)) continue;
      palavras.set(k, w);
      if (raras.fortes.includes(k)) fortes.add(k);
    }
    let chaves = [...palavras.keys()].slice(0, TRILHA_PALAVRAS);
    const espera = fora.filter((x) => !palavras.has(x.k));
    // Uma palavra sozinha que não é forte (o pedaço do nome que um vizinho também tem) não casa: ela fica em
    // "Aprendendo", à espera de outra, em vez de aparecer como trilha que vale (revisão do T21325).
    if (chaves.length === 1 && !fortes.has(chaves[0]!)) {
      if (!espera.some((x) => x.k === chaves[0])) espera.unshift({ k: chaves[0]!, w: palavras.get(chaves[0]!)! });
      chaves = [];
    }
    const t: Trilha = {
      id: mesma?.id ?? `t${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      palavras: chaves.map((k) => palavras.get(k)!),
      chaves,
      ...(chaves.some((k) => fortes.has(k)) ? { fortes: chaves.filter((k) => fortes.has(k)) } : {}),
      ...(espera.length ? { candidatas: { palavras: espera.map((x) => x.w), chaves: espera.map((x) => x.k) } } : {}),
      path: notePath,
      ...(pasta ? { pasta } : {}),
      vezes: (mesma?.vezes ?? 0) + 1,
      em: now,
    };
    if (mesma) ts.splice(ts.indexOf(mesma), 1, t);
    else ts.push(t);
    ts.sort((a, b) => b.em - a.em);
    this.save(ts.slice(0, TRILHAS_MAX));
    return t;
  }

  /**
   * A nota mudou de lugar ou saiu (T16650): `map` diz para onde foi cada caminho, ou null quando ela saiu (apagada,
   * ou sumida por fora sem aparecer em outro lugar). A trilha vai junto com a nota, ou sai da lista: uma trilha morta
   * não leva a nada. Só as trilhas de `pasta` (null: o app sem pastas): o mesmo caminho em outra pasta é outra nota.
   * Devolve quantas mudaram.
   */
  seguir(pasta: string | null, map: (p: string) => string | null): number {
    let mudaram = 0;
    const next: Trilha[] = [];
    for (const t of this.list()) {
      const to = daPasta(t, pasta) ? map(t.path) : t.path;
      if (to === t.path) {
        next.push(t);
        continue;
      }
      mudaram++;
      if (to !== null) next.push({ ...t, path: to });
    }
    if (mudaram) this.save(next);
    return mudaram;
  }

  /** Apaga uma trilha. */
  apagar(id: string): boolean {
    const ts = this.list();
    const rest = ts.filter((t) => t.id !== id);
    if (rest.length === ts.length) return false;
    this.save(rest);
    return true;
  }
}
