// O núcleo do diretor do Kiwi-cat (T3065, spec #3058): ler e reescrever o `animation:` das regras do <style> de um SVG.
//
// Roda nos dois lados, com o mesmo código: no navegador, para a prévia (o que o harry vê enquanto arrasta), e no
// `aplicar.ts`, que grava no arquivo. Assim o que ele viu é exatamente o que vai para o repo.
//
// Só mexe no tempo de cada animação: duração, atraso e curva. Os @keyframes, os ids e o resto do SVG ficam como estão.

/** Uma mudança pedida no diretor: a animação `animacao` da regra `seletor`, com os valores novos (em segundos). */
export interface Mudanca {
  seletor: string;
  animacao: string;
  duracao?: number;
  atraso?: number;
  curva?: string;
  /** Os valores de quando o harry mexeu: se o arquivo mudou depois, o `aplicar` avisa em vez de sobrescrever. */
  de?: { duracao: number; atraso: number; curva: string };
}

/** Um ponto marcado num frame: "esta orelha, aqui, neste instante". As coordenadas são as do viewBox do SVG. */
export interface Nota {
  t: number;
  x: number;
  y: number;
  /** O id do elemento clicado e os dos pais com id, do mais perto para o mais longe ("#ear-left < #ear-left-pop"). */
  alvo: string;
  texto: string;
  criada: string;
}

export interface Direcao {
  svg: string;
  mudancas: Mudanca[];
  notas: Nota[];
}

/** Uma animação da lista do `animation:`, já separada. */
export interface Item {
  nome: string;
  duracao: number;
  atraso: number;
  curva: string;
  /** Os pedaços na ordem em que estavam, para reescrever sem mudar o resto (both, infinite…). */
  partes: string[];
}

/** Uma regra do <style> com `animation:`, onde ela está no texto do SVG. */
export interface Regra {
  seletor: string;
  itens: Item[];
  /** Onde fica o valor do `animation:` (sem o `;`), no texto inteiro. */
  inicio: number;
  fim: number;
}

const CURVAS = new Set(["linear", "ease", "ease-in", "ease-out", "ease-in-out", "step-start", "step-end"]);
const TEMPO = /^(-?\d*\.?\d+)(m?s)$/;

/** Divide nas vírgulas de fora dos parênteses: `a 1s cubic-bezier(.2,.8,.2,1), b 2s` → dois. */
export function dividir(texto: string, sep: "," | " "): string[] {
  const out: string[] = [];
  let nivel = 0;
  let atual = "";
  for (const c of texto) {
    if (c === "(") nivel++;
    else if (c === ")") nivel--;
    if (nivel === 0 && (sep === " " ? /\s/.test(c) : c === sep)) {
      if (atual.trim()) out.push(atual.trim());
      atual = "";
    } else atual += c;
  }
  if (atual.trim()) out.push(atual.trim());
  return out;
}

const segundos = (t: string) => {
  const m = TEMPO.exec(t)!;
  return m[2] === "ms" ? Number(m[1]) / 1000 : Number(m[1]);
};

const ehCurva = (p: string) => CURVAS.has(p) || /^(cubic-bezier|steps|linear)\(/.test(p);

/** Um item do `animation:` (a ordem do CSS: o 1º tempo é a duração, o 2º o atraso). */
export function lerItem(texto: string): Item {
  const partes = dividir(texto, " ");
  const tempos = partes.filter((p) => TEMPO.test(p));
  const curva = partes.find(ehCurva) ?? "ease";
  const PALAVRAS = /^(infinite|normal|reverse|alternate|alternate-reverse|none|forwards|backwards|both|running|paused|\d*\.?\d+)$/;
  const nome = partes.find((p) => !TEMPO.test(p) && !ehCurva(p) && !PALAVRAS.test(p)) ?? "";
  return { nome, duracao: tempos[0] ? segundos(tempos[0]) : 0, atraso: tempos[1] ? segundos(tempos[1]) : 0, curva, partes };
}

/** `2.3` → `2.3s`, `0.9` → `.9s` (o estilo do arquivo), em milissegundos inteiros. */
export function tempo(s: number): string {
  const n = Math.round(s * 1000) / 1000;
  return `${String(n).replace(/^0\./, ".").replace(/^-0\./, "-.")}s`;
}

/** Um número de curva no estilo do arquivo: até 3 casas, sem o zero da frente (`.34`, `1.56`, `1`). */
const num = (n: number) => String(Math.round(n * 1000) / 1000).replace(/^0\./, ".").replace(/^-0\./, "-.");

export function bezier(p: [number, number, number, number]): string {
  return `cubic-bezier(${p.map(num).join(",")})`;
}

/** As curvas com nome viram os 4 números, para o editor de curva. `null` para steps() e linear(…). */
export function pontos(curva: string): [number, number, number, number] | null {
  const nomes: Record<string, [number, number, number, number]> = {
    linear: [0, 0, 1, 1],
    ease: [0.25, 0.1, 0.25, 1],
    "ease-in": [0.42, 0, 1, 1],
    "ease-out": [0, 0, 0.58, 1],
    "ease-in-out": [0.42, 0, 0.58, 1],
  };
  if (nomes[curva]) return [...nomes[curva]!];
  const m = /^cubic-bezier\(([^)]*)\)$/.exec(curva.replace(/\s+/g, ""));
  if (!m) return null;
  const v = m[1]!.split(",").map(Number);
  return v.length === 4 && v.every(Number.isFinite) ? (v as [number, number, number, number]) : null;
}

/** As duas curvas são a mesma? (`ease` e `cubic-bezier(.25,.1,.25,1)` são.) */
export function mesmaCurva(a: string, b: string): boolean {
  if (a.replace(/\s+/g, "") === b.replace(/\s+/g, "")) return true;
  const pa = pontos(a);
  const pb = pontos(b);
  return !!pa && !!pb && pa.every((v, i) => Math.abs(v - pb[i]!) < 1e-6);
}

/** O item reescrito com os valores novos, mexendo só nos pedaços que mudaram. */
export function escreverItem(item: Item, novo: { duracao?: number; atraso?: number; curva?: string }): string {
  const partes = [...item.partes];
  const iTempos = partes.flatMap((p, i) => (TEMPO.test(p) ? [i] : []));
  let iCurva = partes.findIndex(ehCurva);
  if (novo.curva !== undefined && !mesmaCurva(novo.curva, item.curva)) {
    if (iCurva >= 0) partes[iCurva] = novo.curva;
    else {
      // Sem curva escrita (era o `ease` padrão): entra logo depois da duração.
      iCurva = (iTempos[0] ?? partes.indexOf(item.nome)) + 1;
      partes.splice(iCurva, 0, novo.curva);
      for (let k = 0; k < iTempos.length; k++) if (iTempos[k]! >= iCurva) iTempos[k]!++;
    }
  }
  if (novo.duracao !== undefined && Math.abs(novo.duracao - item.duracao) > 1e-9) {
    if (iTempos[0] !== undefined) partes[iTempos[0]] = tempo(novo.duracao);
    else partes.splice(partes.indexOf(item.nome) + 1, 0, tempo(novo.duracao));
  }
  if (novo.atraso !== undefined && Math.abs(novo.atraso - item.atraso) > 1e-9) {
    const tempos = partes.flatMap((p, i) => (TEMPO.test(p) ? [i] : []));
    if (tempos[1] !== undefined) partes[tempos[1]] = tempo(novo.atraso);
    else {
      // Sem atraso escrito: entra depois da curva (ou da duração), onde o arquivo costuma pôr.
      const depois = Math.max(tempos[0] ?? -1, partes.findIndex(ehCurva));
      if (tempos[0] === undefined) partes.splice(partes.indexOf(item.nome) + 1, 0, tempo(item.duracao));
      partes.splice(Math.max(depois, partes.indexOf(item.nome) + 1) + 1, 0, tempo(novo.atraso));
    }
  }
  return partes.join(" ");
}

const normalizar = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s*,\s*/g, ",")
    .replace(/\s+/g, " ")
    .trim();

/** As regras do <style> do SVG que têm `animation:` (fora das @media: lá só há o "reduzir movimento"). */
export function regras(svg: string): Regra[] {
  const estilo = /<style[^>]*>([\s\S]*?)<\/style>/.exec(svg);
  if (!estilo) return [];
  const base = estilo.index + estilo[0].indexOf(estilo[1]!);
  const css = estilo[1]!;
  const out: Regra[] = [];
  let nivel = 0;
  let inicioSel = 0;
  let dentroDeAt = 0; // o nível em que abriu uma @media/@keyframes, para pular o que tem dentro
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "{") {
      const seletor = css.slice(inicioSel, i);
      if (nivel === 0 && seletor.trim().startsWith("@")) dentroDeAt = 1;
      else if (nivel === 0 && !dentroDeAt) {
        const fecha = css.indexOf("}", i);
        const corpo = css.slice(i + 1, fecha);
        const m = /(^|[;\s])animation\s*:\s*([^;]*)/.exec(corpo);
        if (m) {
          const ini = i + 1 + m.index + m[0].length - m[2]!.length;
          const valor = m[2]!.replace(/\s+$/, "");
          out.push({ seletor: normalizar(seletor), itens: dividir(valor, ",").map(lerItem), inicio: base + ini, fim: base + ini + valor.length });
        }
      }
      nivel++;
      inicioSel = i + 1;
    } else if (c === "}") {
      nivel--;
      if (nivel === 0) dentroDeAt = 0;
      inicioSel = i + 1;
    }
  }
  return out;
}

export interface Resultado {
  svg: string;
  aplicadas: Mudanca[];
  /** As que não entraram, com o motivo (seletor ou animação que não existe, ou o arquivo mudou depois). */
  recusadas: { mudanca: Mudanca; motivo: string }[];
}

/** Aplica as mudanças no texto do SVG. Com `forcar`, ignora a conferência do `de`. */
export function aplicar(svg: string, mudancas: readonly Mudanca[], forcar = false): Resultado {
  const aplicadas: Mudanca[] = [];
  const recusadas: Resultado["recusadas"] = [];
  // Por regra, as trocas; depois reescreve do fim para o começo, para as posições não andarem.
  const trocas = new Map<Regra, Map<number, string>>();
  const lista = regras(svg);
  for (const m of mudancas) {
    const regra = lista.find((r) => r.seletor === normalizar(m.seletor) && r.itens.some((i) => i.nome === m.animacao));
    if (!regra) {
      recusadas.push({ mudanca: m, motivo: `não achei a animação ${m.animacao} em ${m.seletor}` });
      continue;
    }
    const k = regra.itens.findIndex((i) => i.nome === m.animacao);
    const item = regra.itens[k]!;
    if (m.de && !forcar) {
      const igual = Math.abs(m.de.duracao - item.duracao) < 1e-6 && Math.abs(m.de.atraso - item.atraso) < 1e-6 && mesmaCurva(m.de.curva, item.curva);
      if (!igual) {
        recusadas.push({
          mudanca: m,
          motivo: `o arquivo mudou desde a marcação (era ${tempo(m.de.duracao)} ${m.de.curva} ${tempo(m.de.atraso)}, agora ${tempo(item.duracao)} ${item.curva} ${tempo(item.atraso)})`,
        });
        continue;
      }
    }
    if (!trocas.has(regra)) trocas.set(regra, new Map());
    trocas.get(regra)!.set(k, escreverItem(item, m));
    aplicadas.push(m);
  }
  let out = svg;
  for (const regra of [...trocas.keys()].sort((a, b) => b.inicio - a.inicio)) {
    const novos = regra.itens.map((item, k) => trocas.get(regra)!.get(k) ?? item.partes.join(" "));
    out = out.slice(0, regra.inicio) + novos.join(", ") + out.slice(regra.fim);
  }
  return { svg: out, aplicadas, recusadas };
}
