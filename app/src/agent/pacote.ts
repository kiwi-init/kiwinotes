// O pacote (ADR 0013, peça 2; T14359): o que o faro achou vai junto com o pedido, e o agente não precisa procurar.
//
// - **No certo, o texto vai junto.** A nota de até 6 mil caracteres vai inteira; a maior, o sumário (com o tamanho de
//   cada seção, e o número dela) e a seção que o pedido cita. Com a versão: uma escrita pode ir direto, sem ler de novo.
// - **No provável, só os cartões** (até 5): o agente escolhe e lê uma vez.
// - **Uma pasta vira um resumo:** quantas notas, as subpastas e algumas notas. Nunca a lista inteira.
// - **Pelo guardrail:** o texto passa pelo mesmo filtro de uma leitura (`seen`), e o que vai é o que o agente veria.
// - O bloco tem começo e fim explícitos (`[O Kiwi achou…` e `[/O Kiwi achou]`): o texto de uma nota pode ter qualquer
//   linha, até um "]" sozinho.

import { markdownStructure } from "../shared/markdown-structure.ts";
import type { FaroHit, FaroResult } from "./faro.ts";
import { matchScore } from "./tools/find.ts";
import type { VaultReader } from "./tools/reader.ts";
import { jaEntregue, type RegistroEntrega, soDiferenca } from "./entrega.ts";

/** A nota que vai inteira no certo; acima disto, o sumário e a seção citada. */
export const PACKAGE_FULL_CHARS = 6_000;
/** A seção citada de uma nota grande, no máximo. */
export const PACKAGE_SECTION_CHARS = 6_000;
/** Quantas seções o sumário mostra. */
export const PACKAGE_OUTLINE_MAX = 30;
export const PACKAGE_HEAD = "[O Kiwi achou nas suas notas o que o pedido cita. Use isto direto, sem procurar de novo:";
/** No provável: os cartões, para o agente escolher. Começa igual ("[O Kiwi achou"), e termina na mesma marca. */
export const PACKAGE_HEAD_MAYBE = "[O Kiwi achou nas suas notas mais de um alvo parecido com o que o pedido cita. Escolha pelo pedido e leia só o certo:";
export const PACKAGE_END = "[/O Kiwi achou]";

/** O que foi entregue, para a Atividade ("o Kiwi entregou"). */
export interface Delivered {
  path: string;
  kind: FaroHit["target"]["kind"];
  /** Com o texto (o certo), ou só o cartão. */
  text: boolean;
}

export interface PackageDeps {
  reader: VaultReader;
  /** O texto como o agente vê, pelo filtro de segredos. */
  seen: (path: string, content: string) => Promise<string>;
  /** O registro de entrega da janela (ADR 0013 peça 4, T14682): o texto que o agente já tem não vai de novo. */
  registro?: RegistroEntrega;
}

const KIND_LABEL = { nota: "nota", pasta: "pasta", projeto: "projeto", reuniao: "reunião" } as const;

/** O sumário de um texto: os títulos, com o nível e o tamanho de cada seção. */
function outline(content: string): { titulo: string; nivel: number; from: number; to: number }[] {
  const hs = markdownStructure(content).headings;
  return hs.map((h, i) => {
    const next = hs.slice(i + 1).find((x) => x.level <= h.level);
    return { titulo: h.title, nivel: h.level, from: h.from, to: next ? next.from : content.length };
  });
}

/** A seção que o pedido cita, pelo título: a que mais se parece com alguma janela do pedido. */
function citedSection(content: string, request: string): { titulo: string; texto: string } | null {
  const words = request.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let best: { titulo: string; from: number; to: number; score: number } | null = null;
  for (const s of outline(content)) {
    for (let size = 1; size <= 4; size++)
      for (let i = 0; i + size <= words.length; i++) {
        const score = matchScore(words.slice(i, i + size).join(" "), [s.titulo]);
        if (score >= 0.8 && (!best || score > best.score)) best = { ...s, score };
      }
  }
  return best ? { titulo: best.titulo, texto: content.slice(best.from, Math.min(best.to, best.from + PACKAGE_SECTION_CHARS)) } : null;
}

/** Uma nota, uma reunião ou a nota principal de um projeto, com o texto (no certo) ou só o cartão. */
async function noteBlock(d: PackageDeps, path: string, label: string, request: string, withText: boolean): Promise<string | null> {
  const n = await d.reader.get(path).catch(() => null);
  if (!n) return null;
  const content = await d.seen(n.path, n.content);
  const version = n.version ? `, versão ${n.version}` : "";
  const card = `${label}: ${n.path} ("${n.title}", ${content.length} caracteres${version})`;
  if (!withText) return card;
  /** O texto, ou "já está com você", ou só a diferença, pelo registro da janela. */
  const texto = (t: string, section?: string): string => {
    const reg = d.registro;
    const e = reg ? reg.conferir(n.path, n.version, t, section) : { kind: "novo" as const };
    reg?.entregou(n.path, n.version, t, section);
    if (e.kind === "igual") return jaEntregue(e.pedido, reg!.pedido);
    if (e.kind === "diferenca") return `${soDiferenca(e.pedido)}\n<<<\n${e.diff}\n>>>`;
    return `<<<\n${t}\n>>>`;
  };
  if (content.length <= PACKAGE_FULL_CHARS) return `${card}\n${texto(content)}`;
  const sections = outline(content).slice(0, PACKAGE_OUTLINE_MAX);
  // O número de cada seção (ADR 0013 peça 7): mover, renomear e juntar vão por ele, sem ler a nota.
  const summary = sections.map((s, i) => `${"  ".repeat(Math.max(0, s.nivel - 1))}- ${i + 1}. ${s.titulo} (${s.to - s.from} caracteres)`).join("\n");
  const cited = citedSection(content, request);
  return [
    `${card}. É grande: vai o sumário${cited ? ` e a seção "${cited.titulo}"` : ""}; o resto, leia por seção com kiwi ler/nota e a opção secao.`,
    `Sumário:\n${summary}`,
    ...(cited ? [texto(cited.texto, cited.titulo)] : []),
  ].join("\n");
}

/** Uma pasta em resumo: quantas notas, as subpastas e algumas notas. */
async function folderBlock(d: PackageDeps, path: string): Promise<string> {
  const all = await d.reader.list();
  const inside = all.notes.filter((n) => n.folder === path || n.folder.startsWith(`${path}/`));
  const subs = all.folders.filter((f) => f.startsWith(`${path}/`) && !f.slice(path.length + 1).includes("/"));
  const direct = all.notes.filter((n) => n.folder === path).slice(0, 10);
  return [
    `pasta: ${path} (${inside.length} notas${subs.length ? `, ${subs.length} subpastas` : ""})`,
    ...(subs.length ? [`subpastas: ${subs.slice(0, 10).map((s) => s.split("/").pop()).join("; ")}${subs.length > 10 ? `; e mais ${subs.length - 10}` : ""}`] : []),
    ...(direct.length ? [`notas: ${direct.map((n) => n.path).join("; ")}`] : []),
  ].join("\n");
}

/** Um alvo do faro no pacote. */
async function targetBlock(d: PackageDeps, h: FaroHit, request: string, withText: boolean): Promise<string | null> {
  const t = h.target;
  if (t.kind === "pasta") return folderBlock(d, t.path);
  if (t.kind === "projeto") {
    const head = `projeto: ${t.title} (pasta ${t.path})`;
    if (!t.main) return `${head}, sem nota principal`;
    const main = await noteBlock(d, t.main, "nota principal", request, withText);
    return main ? `${head}\n${main}` : head;
  }
  return noteBlock(d, t.path, KIND_LABEL[t.kind], request, withText);
}

/**
 * O pacote do pedido, ou null no "nada". No certo, o alvo com o texto; no provável, os cartões, para o agente
 * escolher. Devolve também o que foi entregue, para a Atividade.
 */
export async function buildPackage(d: PackageDeps, r: FaroResult, request: string): Promise<{ text: string; delivered: Delivered[] } | null> {
  if (r.kind === "nada") return null;
  const hits = r.kind === "certo" ? [r.hit] : r.hits;
  const withText = r.kind === "certo";
  const blocks: string[] = [];
  const delivered: Delivered[] = [];
  for (const h of hits) {
    const b = await targetBlock(d, h, request, withText).catch(() => null);
    if (!b) continue;
    blocks.push(b);
    delivered.push({ path: h.target.kind === "projeto" && h.target.main ? h.target.main : h.target.path, kind: h.target.kind, text: withText });
  }
  if (!blocks.length) return null;
  return { text: `${withText ? PACKAGE_HEAD : PACKAGE_HEAD_MAYBE}\n${blocks.join(withText ? "\n\n" : "\n")}\n${PACKAGE_END}`, delivered };
}
