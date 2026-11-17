// As trilhas (ADR 0013, decisão 4 = A; T14682): quando o faro erra e o agente chega à nota certa por outro caminho, o
// Kiwi guarda a ligação entre as palavras do pedido e a nota, e da próxima vez ela sobe sozinha.
//
// - **É contagem, não modelo.** Uma trilha são algumas palavras do pedido, a nota e quantas vezes ela já levou lá.
// - **Ficam só no Mac**, em `<dados>/agent/trilhas.json` (0600). Visíveis e apagáveis, uma a uma, em Ajustes › Agente.
// - **Aprende:** no fim de um pedido em que o agente leu uma nota que o faro não deu como certa (no nada, no provável, ou
//   no certo de outro alvo). As palavras vêm do pedido já pelo filtro de segredos.
// - **Casa:** quando o pedido traz pelo menos metade das palavras de uma trilha (pelo menos duas, ou a única que ela tem).
//   Vale um pouco menos que o nome exato da nota, e sobe com as vezes.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { nameKey } from "./tools/find.ts";

/** Uma trilha guardada. */
export interface Trilha {
  id: string;
  /** As palavras do pedido, como a pessoa disse (para a tela). */
  palavras: string[];
  /** As mesmas palavras pela chave (sem acento, maiúscula nem plural), para casar. */
  chaves: string[];
  /** A nota a que elas levaram. */
  path: string;
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

/** As palavras de um pedido que dizem o assunto: as mais longas, na ordem em que vieram. */
export function palavrasDoPedido(pedido: string): { palavras: string[]; chaves: string[] } {
  const vistas = new Map<string, string>();
  for (const w of pedido.split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 4 || /^\d+$/.test(w)) continue;
    const k = chaveDaPalavra(w);
    if (VAZIAS.has(nameKey(w)) || VAZIAS.has(k) || vistas.has(k)) continue;
    vistas.set(k, w);
  }
  const longas = new Set([...vistas.keys()].sort((a, b) => b.length - a.length).slice(0, TRILHA_PALAVRAS));
  const chaves = [...vistas.keys()].filter((k) => longas.has(k));
  return { palavras: chaves.map((k) => vistas.get(k)!), chaves };
}

/** O que uma trilha casou num pedido. */
export interface TrilhaCasada {
  trilha: Trilha;
  /** As palavras da trilha que vieram no pedido. */
  palavras: string[];
}

/** As trilhas que o pedido segue: pelo menos metade das palavras dela (no mínimo duas, ou a única) está nele. */
export function trilhasDoPedido(pedido: string, trilhas: readonly Trilha[]): TrilhaCasada[] {
  if (!trilhas.length) return [];
  const tem = new Set(palavrasDoPedido(pedido).chaves);
  const out: TrilhaCasada[] = [];
  for (const t of trilhas) {
    const i = t.chaves.flatMap((k, j) => (tem.has(k) ? [j] : []));
    if (i.length < Math.min(2, t.chaves.length) || i.length / t.chaves.length < TRILHA_CASA) continue;
    out.push({ trilha: t, palavras: i.map((j) => t.palavras[j]!) });
  }
  return out;
}

/** O placar de uma trilha casada no faro: abaixo do nome exato, e sobe com as vezes e com as palavras que casaram. */
export const placarDaTrilha = (c: TrilhaCasada): number => 0.88 + 0.04 * Math.min(c.trilha.vezes, 3) + 0.02 * c.palavras.length;

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
        if (raw.version !== 1 || !Array.isArray(raw.trilhas)) throw new Error("bad");
        ts = raw.trilhas.filter((t) => t && typeof t.path === "string" && Array.isArray(t.chaves) && Array.isArray(t.palavras));
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
    writeFileSync(tmp, JSON.stringify({ version: 1, trilhas: ts }), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.file);
  }

  /**
   * O agente chegou a `notePath` por outro caminho: as palavras do pedido levam lá. Uma trilha da mesma nota com a
   * maior parte das mesmas palavras conta mais uma vez; senão, entra uma nova. Devolve a trilha, ou null (o pedido não
   * tinha palavra de assunto).
   */
  aprender(pedido: string, notePath: string): Trilha | null {
    const { palavras, chaves } = palavrasDoPedido(pedido);
    if (!chaves.length) return null;
    const ts = [...this.list()];
    const now = this.now();
    const mesma = ts.find((t) => t.path === notePath && t.chaves.filter((k) => chaves.includes(k)).length >= Math.min(chaves.length, t.chaves.length) * TRILHA_CASA);
    let t: Trilha;
    if (mesma) {
      t = { ...mesma, vezes: mesma.vezes + 1, em: now };
      ts.splice(ts.indexOf(mesma), 1, t);
    } else {
      t = { id: `t${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, palavras, chaves, path: notePath, vezes: 1, em: now };
      ts.push(t);
    }
    ts.sort((a, b) => b.em - a.em);
    this.save(ts.slice(0, TRILHAS_MAX));
    return t;
  }

  /**
   * A nota mudou de lugar ou saiu (T16650): `map` diz para onde foi cada caminho, ou null quando ela saiu (apagada,
   * ou sumida por fora sem aparecer em outro lugar). A trilha vai junto com a nota, ou sai da lista: uma trilha morta
   * não leva a nada. Devolve quantas mudaram.
   */
  seguir(map: (p: string) => string | null): number {
    let mudaram = 0;
    const next: Trilha[] = [];
    for (const t of this.list()) {
      const to = map(t.path);
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
