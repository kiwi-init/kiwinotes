// O registro de entrega (ADR 0013, peça 4; T14682): o Kiwi nunca manda duas vezes o mesmo texto à mesma sessão.
//
// - **O Kiwi anota o que entregou à sessão:** a nota, a versão e a seção (ou a nota inteira), com o texto como o agente
//   viu (depois do filtro de segredos). Só na memória: o texto nunca vai para o disco.
// - **Pediu de novo, sem mudança:** a resposta é "já está com você, do pedido N", em uns 20 tokens.
// - **A nota mudou:** vai só a diferença, quando ela é menor que o texto; senão, o texto inteiro, de novo.
// - **A escrita do agente atualiza o registro:** ele não relê o que acabou de escrever.
// - **O registro vale enquanto o texto está na sessão:** quando a janela curta fecha (peça 5), ele zera. Quem fecha a
//   janela é o Kiwi, então o Kiwi sabe quando o agente esqueceu.

import { lineDiff } from "../../ui/notes/diff.ts";

/** O que foi entregue: a versão da nota inteira, o texto como o agente viu e o pedido da janela em que foi. */
interface Entregue {
  version: string;
  texto: string;
  pedido: number;
}

/** O que fazer com uma leitura: mandar o texto, dizer que já está lá, ou mandar só a diferença. */
export type Entrega =
  | { kind: "novo" }
  | { kind: "igual"; pedido: number }
  | { kind: "diferenca"; pedido: number; diff: string };

/** A diferença tem de ser bem menor que o texto para valer: senão, vai o texto de novo, inteiro e mais fácil de ler. */
export const DIFF_MAX_RATIO = 0.6;
/** As linhas iguais em volta de cada trecho mudado, para o agente achar onde ele fica. */
const CONTEXT_LINES = 1;

/** A chave: a nota inteira, ou uma seção dela. */
const key = (path: string, section?: string) => `${path}\u0000${section ?? ""}`;

/**
 * A diferença entre dois textos, como o agente lê: só os trechos mudados, com o número da linha (do texto novo) e uma
 * linha igual em volta. "-" saiu, "+" entrou.
 */
export function textDiff(before: string, after: string): string {
  const lines = lineDiff(before, after);
  const out: string[] = [];
  let newLine = 0;
  const changed = lines.map((l) => l.kind !== "same");
  const near = (i: number) => {
    for (let k = Math.max(0, i - CONTEXT_LINES); k <= Math.min(lines.length - 1, i + CONTEXT_LINES); k++) if (changed[k]) return true;
    return false;
  };
  let gap = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.kind !== "del") newLine++;
    if (!near(i)) {
      gap = true;
      continue;
    }
    if (gap || !out.length) out.push(`@@ linha ${l.kind === "del" ? newLine + 1 : newLine}`);
    gap = false;
    out.push(`${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "} ${l.text}`);
  }
  return out.join("\n");
}

export class RegistroEntrega {
  private readonly entregues = new Map<string, Entregue>();
  /** As leituras que já ouviram "já está com você" neste pedido: a segunda vez, o texto vai (revisão do T14682). */
  private readonly avisadas = new Set<string>();
  private n = 0;

  /** O pedido de agora, na janela (1 é o primeiro). */
  get pedido(): number {
    return this.n;
  }

  /** Um pedido novo na mesma janela. */
  novoPedido(): void {
    this.n++;
    this.avisadas.clear();
  }

  /** A janela fechou: a sessão nova não tem nada. */
  zerar(): void {
    this.entregues.clear();
    this.avisadas.clear();
    this.n = 0;
  }

  /** Quantos textos estão anotados (para os testes e o log). */
  get tamanho(): number {
    return this.entregues.size;
  }

  /**
   * Uma leitura que vai sair: o que fazer com ela. `texto` é o que o agente veria agora (a nota inteira, ou a seção).
   * Decide o texto que o agente viu, não só a versão: o mesmo arquivo pode sair diferente pelo filtro de segredos (a
   * pessoa liberou um trecho depois). A nota inteira entregue cobre uma seção dela que esteja lá, igual.
   */
  conferir(path: string, _version: string | undefined, texto: string, section?: string): Entrega {
    const inteira = this.entregues.get(key(path));
    if (section !== undefined && inteira && inteira.texto.includes(texto)) return { kind: "igual", pedido: inteira.pedido };
    const e = this.entregues.get(key(path, section));
    if (!e) return { kind: "novo" };
    if (e.texto === texto) return { kind: "igual", pedido: e.pedido };
    const diff = textDiff(e.texto, texto);
    if (diff.length > texto.length * DIFF_MAX_RATIO) return { kind: "novo" };
    return { kind: "diferenca", pedido: e.pedido, diff };
  }

  /**
   * A saída do "já está com você": o agente que não tem mais o texto (um pedido que falhou, a conversa compactada) lê
   * de novo, e a segunda leitura igual no mesmo pedido leva o texto. Devolve true se esta leitura já ouviu o aviso.
   */
  avisou(path: string, section?: string): boolean {
    const k = key(path, section);
    if (this.avisadas.has(k)) return true;
    this.avisadas.add(k);
    return false;
  }

  /** O texto foi entregue (inteiro, ou a diferença até ele): o agente tem agora esta versão. */
  entregou(path: string, version: string | undefined, texto: string, section?: string): void {
    this.entregues.set(key(path, section), { version: version ?? "", texto, pedido: this.n });
  }

  /**
   * O agente escreveu na nota. Com a nota inteira anotada, ele sabe o texto novo (o de antes e a mudança que ele mesmo
   * mandou): o registro passa para a versão nova. As seções anotadas saem: a escrita pode ter mudado qualquer uma.
   */
  escreveu(path: string, version: string, texto: string | null): void {
    const tinha = this.entregues.has(key(path));
    for (const k of [...this.entregues.keys()]) if (k.startsWith(`${path}\u0000`)) this.entregues.delete(k);
    if (tinha && texto !== null) this.entregues.set(key(path), { version, texto, pedido: this.n });
  }

  /** A nota saiu do cofre ou mudou de nome: o registro dela sai. */
  esquecer(path: string): void {
    for (const k of [...this.entregues.keys()]) if (k.startsWith(`${path}\u0000`)) this.entregues.delete(k);
  }
}

/** A frase de "já está com você", nas leituras e no pacote. */
export function jaEntregue(pedido: number, agora: number): string {
  return pedido === agora ? "Já está com você, deste pedido: não mudou." : `Já está com você, do pedido ${pedido} desta conversa: não mudou.`;
}

/** A frase da diferença. */
export function soDiferenca(pedido: number): string {
  return `Mudou desde o pedido ${pedido} desta conversa: vai só a diferença (- saiu, + entrou; o número é a linha no texto novo).`;
}
