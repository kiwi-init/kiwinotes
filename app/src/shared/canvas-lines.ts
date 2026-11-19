// O quadro branco em linhas para o diff das Versões (T22432, issue #182): o JSON Canvas muda posição e id a cada
// arrasto, e o diff dele não diz nada à pessoa. Aqui, cada cartão vira o texto dele, cada nó de arquivo, de link e de
// grupo, uma linha, e cada seta, "de → para". Na ordem de leitura (de cima para baixo, da esquerda para a direita),
// sem posição nem tamanho: mover um cartão não aparece no diff, trocar o texto aparece.

import { isDrawableEdge, isDrawableNode, parseCanvas, type CanvasNode } from "./json-canvas.ts";

const short = (s: string) => {
  const line = s.split("\n").find((l) => l.trim())?.trim() ?? "";
  return line.length > 40 ? `${line.slice(0, 39)}…` : line;
};

/** O nome do nó numa seta: o começo do texto, o arquivo, o link ou o grupo. */
function nameOf(n: CanvasNode): string {
  if (n.type === "text") return short(n.text ?? "") || "cartão vazio";
  if (n.type === "file") return (n.file ?? "").split("/").pop() || "arquivo";
  if (n.type === "link") return n.url ?? "link";
  if (n.type === "group") return n.label ? `grupo ${n.label}` : "grupo";
  return n.type;
}

/** As linhas de um nó. O texto do cartão vai inteiro, uma linha por linha, recuado sob "Cartão:". */
function linesOf(n: CanvasNode): string[] {
  if (n.type === "text") {
    const [first = "", ...rest] = (n.text ?? "").split("\n");
    return [`Cartão: ${first}`, ...rest.map((l) => `  ${l}`)];
  }
  if (n.type === "file") return [`Arquivo: ${n.file ?? ""}${n.subpath ?? ""}`];
  if (n.type === "link") return [`Link: ${n.url ?? ""}`];
  if (n.type === "group") return [`Grupo: ${n.label ?? ""}`];
  return [`${n.type}`];
}

/** O texto legível do quadro. Um JSON que não abre volta como está (o diff ainda mostra algo). */
export function canvasLines(json: string): string {
  let doc;
  try {
    doc = parseCanvas(json);
  } catch {
    return json;
  }
  const nodes = doc.nodes.filter(isDrawableNode).sort((a, b) => a.y - b.y || a.x - b.x);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ids = new Set(byId.keys());
  const out = nodes.flatMap(linesOf);
  const edges = doc.edges
    .filter((e) => isDrawableEdge(e, ids))
    .map((e) => `Seta: ${nameOf(byId.get(e.fromNode)!)} → ${nameOf(byId.get(e.toNode)!)}${e.label ? ` (${e.label})` : ""}`)
    .sort();
  return [...out, ...edges].join("\n") + "\n";
}
