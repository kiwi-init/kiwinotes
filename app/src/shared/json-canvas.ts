// O quadro branco no formato JSON Canvas 1.0 (T6600, E16), o `.canvas` do Obsidian (https://jsoncanvas.org, MIT). Ler,
// mudar e gravar sem perder nada: cada nó e cada aresta continuam sendo o objeto que veio do arquivo, com os campos que
// o Kiwi não conhece e na mesma ordem. Uma mudança troca só o campo mudado (`{ ...nó, x, y }`), e gravar escreve no
// formato do próprio Obsidian (um nó por linha, com tabs), para o diff ficar pequeno quando o vault vai para o Git.

export type CanvasSide = "top" | "right" | "bottom" | "left";
export type CanvasEnd = "none" | "arrow";

/** Um nó como está no arquivo: os campos do formato e o que mais vier junto (preservado). */
export interface CanvasNode {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  /** `text`: o Markdown. */
  text?: string;
  /** `file`: o caminho no vault, e o `#título` ou `#^bloco`. */
  file?: string;
  subpath?: string;
  /** `link`: o endereço. */
  url?: string;
  /** `group`: o rótulo e a imagem de fundo. */
  label?: string;
  background?: string;
  backgroundStyle?: string;
  [key: string]: unknown;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: CanvasSide;
  toSide?: CanvasSide;
  fromEnd?: CanvasEnd;
  toEnd?: CanvasEnd;
  color?: string;
  label?: string;
  [key: string]: unknown;
}

/** O arquivo inteiro: `nodes` e `edges`, e o que mais houver no topo (preservado). */
export interface CanvasDoc {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  [key: string]: unknown;
}

export class CanvasParseError extends Error {}

const SIDES: readonly string[] = ["top", "right", "bottom", "left"];
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** O nó dá para desenhar: tem id, tipo e a caixa. Os outros ficam no arquivo como estão, sem aparecer. */
export function isDrawableNode(n: unknown): n is CanvasNode {
  return isObject(n) && typeof n.id === "string" && typeof n.type === "string" && isNum(n.x) && isNum(n.y) && isNum(n.width) && isNum(n.height);
}

/** A aresta liga dois nós que existem. */
export function isDrawableEdge(e: unknown, ids: ReadonlySet<string>): e is CanvasEdge {
  return isObject(e) && typeof e.id === "string" && typeof e.fromNode === "string" && typeof e.toNode === "string" && ids.has(e.fromNode) && ids.has(e.toNode);
}

/**
 * Lê o `.canvas`. O arquivo vazio (o Obsidian cria assim) é um quadro vazio. JSON quebrado, ou um topo que não é
 * objeto, dá `CanvasParseError`: o quadro não abre, e nada é gravado por cima.
 */
export function parseCanvas(text: string): CanvasDoc {
  if (!text.trim()) return { nodes: [], edges: [] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new CanvasParseError(`o .canvas não é JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isObject(data)) throw new CanvasParseError("o .canvas não é um objeto JSON");
  if (data.nodes !== undefined && !Array.isArray(data.nodes)) throw new CanvasParseError("`nodes` não é uma lista");
  if (data.edges !== undefined && !Array.isArray(data.edges)) throw new CanvasParseError("`edges` não é uma lista");
  return { ...data, nodes: (data.nodes as CanvasNode[] | undefined) ?? [], edges: (data.edges as CanvasEdge[] | undefined) ?? [] };
}

/**
 * Escreve como o Obsidian: o topo com tab, e cada nó e cada aresta numa linha só. Os campos ficam na ordem em que
 * estão no objeto, e os do topo que o Kiwi não conhece vão junto.
 */
export function stringifyCanvas(doc: CanvasDoc): string {
  const keys = Object.keys(doc);
  const lines = ["{"];
  keys.forEach((k, i) => {
    const comma = i < keys.length - 1 ? "," : "";
    const v = doc[k];
    if ((k === "nodes" || k === "edges") && Array.isArray(v)) {
      if (!v.length) {
        lines.push(`\t${JSON.stringify(k)}:[]${comma}`);
        return;
      }
      lines.push(`\t${JSON.stringify(k)}:[`);
      v.forEach((item, j) => lines.push(`\t\t${JSON.stringify(item)}${j < v.length - 1 ? "," : ""}`));
      lines.push(`\t]${comma}`);
      return;
    }
    lines.push(`\t${JSON.stringify(k)}:${JSON.stringify(v)}${comma}`);
  });
  lines.push("}");
  return lines.join("\n");
}

/** Um id novo como os do Obsidian: 16 dígitos hex, diferente dos que já estão no quadro. */
export function newCanvasId(doc: CanvasDoc, random: () => number = Math.random): string {
  const used = new Set<string>([...doc.nodes.map((n) => String(n.id)), ...doc.edges.map((e) => String(e.id))]);
  for (;;) {
    let id = "";
    for (let i = 0; i < 16; i++) id += Math.floor(random() * 16).toString(16);
    if (!used.has(id)) return id;
  }
}

// ---------------------------------------------------------------- as mudanças (sempre um quadro novo)

/** Troca campos de um nó, mantendo os outros (e a ordem deles). As coordenadas ficam inteiras, como o formato pede. */
export function updateNode(doc: CanvasDoc, id: string, patch: Partial<CanvasNode>): CanvasDoc {
  const fixed: Partial<CanvasNode> = { ...patch };
  for (const k of ["x", "y", "width", "height"] as const) if (isNum(fixed[k])) fixed[k] = Math.round(fixed[k]);
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === id ? clean({ ...n, ...fixed }) : n)) };
}

export function updateEdge(doc: CanvasDoc, id: string, patch: Partial<CanvasEdge>): CanvasDoc {
  return { ...doc, edges: doc.edges.map((e) => (e.id === id ? clean({ ...e, ...patch }) : e)) };
}

/** Um campo `undefined` sai do objeto (no JSON ele sumiria de qualquer jeito, e assim o `eq` dos testes bate). */
function clean<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

/** Põe um nó no fim da lista: o último fica por cima, como no formato. */
export function addNode(doc: CanvasDoc, node: CanvasNode): CanvasDoc {
  return { ...doc, nodes: [...doc.nodes, clean({ ...node, x: Math.round(node.x), y: Math.round(node.y), width: Math.round(node.width), height: Math.round(node.height) })] };
}

export function addEdge(doc: CanvasDoc, edge: CanvasEdge): CanvasDoc {
  return { ...doc, edges: [...doc.edges, clean({ ...edge })] };
}

/** Tira nós e arestas; as arestas que tocavam num nó tirado saem junto. */
export function removeItems(doc: CanvasDoc, ids: ReadonlySet<string>): CanvasDoc {
  const gone = new Set(doc.nodes.filter((n) => ids.has(n.id)).map((n) => n.id));
  const nodes = doc.nodes.filter((n) => !gone.has(n.id));
  const edges = doc.edges.filter((e) => !ids.has(e.id) && !gone.has(e.fromNode) && !gone.has(e.toNode));
  return { ...doc, nodes, edges };
}

/** Leva o nó para o topo da pilha (o fim da lista), menos os grupos, que ficam atrás do que está dentro deles. */
export function bringToFront(doc: CanvasDoc, id: string): CanvasDoc {
  const node = doc.nodes.find((n) => n.id === id);
  if (!node || node.type === "group" || doc.nodes.at(-1)?.id === id) return doc;
  return { ...doc, nodes: [...doc.nodes.filter((n) => n.id !== id), node] };
}

// ---------------------------------------------------------------- a geometria

export interface Point {
  x: number;
  y: number;
}
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** O meio de um lado da caixa: onde a aresta encosta. */
export function sidePoint(b: Box, side: CanvasSide): Point {
  switch (side) {
    case "top":
      return { x: b.x + b.width / 2, y: b.y };
    case "bottom":
      return { x: b.x + b.width / 2, y: b.y + b.height };
    case "left":
      return { x: b.x, y: b.y + b.height / 2 };
    case "right":
      return { x: b.x + b.width, y: b.y + b.height / 2 };
  }
}

const center = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** O lado de `b` que olha para `other`, quando a aresta não diz qual (o formato deixa sem). */
export function facingSide(b: Box, other: Box): CanvasSide {
  const a = center(b);
  const o = center(other);
  const dx = o.x - a.x;
  const dy = o.y - a.y;
  // Normaliza pelo tamanho da caixa: numa caixa larga, o lado de cima ganha mais cedo.
  if (Math.abs(dx) / Math.max(b.width, 1) >= Math.abs(dy) / Math.max(b.height, 1)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

const NORMAL: Record<CanvasSide, Point> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

export interface EdgeGeometry {
  from: Point;
  to: Point;
  fromSide: CanvasSide;
  toSide: CanvasSide;
  /** O caminho SVG (uma curva cúbica que sai e chega na perpendicular do lado). */
  path: string;
  /** O meio da curva, para o rótulo. */
  middle: Point;
}

/** A curva de uma aresta entre duas caixas, como a do Obsidian: sai do lado na perpendicular e chega do mesmo jeito. */
export function edgeGeometry(fromBox: Box, toBox: Box, fromSide?: CanvasSide, toSide?: CanvasSide): EdgeGeometry {
  const fs = fromSide && SIDES.includes(fromSide) ? fromSide : facingSide(fromBox, toBox);
  const ts = toSide && SIDES.includes(toSide) ? toSide : facingSide(toBox, fromBox);
  const from = sidePoint(fromBox, fs);
  const to = sidePoint(toBox, ts);
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const reach = Math.min(Math.max(dist / 2, 40), 250);
  const c1 = { x: from.x + NORMAL[fs].x * reach, y: from.y + NORMAL[fs].y * reach };
  const c2 = { x: to.x + NORMAL[ts].x * reach, y: to.y + NORMAL[ts].y * reach };
  // O ponto da curva em t = 0,5.
  const middle = { x: (from.x + 3 * c1.x + 3 * c2.x + to.x) / 8, y: (from.y + 3 * c1.y + 3 * c2.y + to.y) / 8 };
  const r = (n: number) => Math.round(n * 10) / 10;
  return { from, to, fromSide: fs, toSide: ts, middle, path: `M ${r(from.x)} ${r(from.y)} C ${r(c1.x)} ${r(c1.y)}, ${r(c2.x)} ${r(c2.y)}, ${r(to.x)} ${r(to.y)}` };
}

/** A ponta da seta em `tip`, chegando pelo lado `side` (aponta para dentro da caixa): os 3 pontos do triângulo. */
export function arrowHead(tip: Point, side: CanvasSide, size = 10): string {
  const n = NORMAL[side];
  // A base fica para fora da caixa, ao longo da normal do lado.
  const bx = tip.x + n.x * size;
  const by = tip.y + n.y * size;
  const px = -n.y * (size / 2);
  const py = n.x * (size / 2);
  const r = (v: number) => Math.round(v * 10) / 10;
  return `${r(tip.x)},${r(tip.y)} ${r(bx + px)},${r(by + py)} ${r(bx - px)},${r(by - py)}`;
}

/** A caixa que cabe todos os nós (para enquadrar o quadro ao abrir). `null` sem nós. */
export function boundsOf(nodes: readonly Box[]): Box | null {
  if (!nodes.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const n of nodes) {
    x1 = Math.min(x1, n.x);
    y1 = Math.min(y1, n.y);
    x2 = Math.max(x2, n.x + n.width);
    y2 = Math.max(y2, n.y + n.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** O nó (de cima para baixo na pilha) que está sob o ponto, sem contar os grupos; o grupo só quando não há outro. */
export function nodeAt(nodes: readonly CanvasNode[], p: Point): CanvasNode | null {
  let group: CanvasNode | null = null;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    if (!isDrawableNode(n)) continue;
    if (p.x < n.x || p.y < n.y || p.x > n.x + n.width || p.y > n.y + n.height) continue;
    if (n.type !== "group") return n;
    group ??= n;
  }
  return group;
}

/** O lado da caixa mais perto do ponto (para ligar uma aresta solta no nó). */
export function nearestSide(b: Box, p: Point): CanvasSide {
  const d: [CanvasSide, number][] = [
    ["top", Math.abs(p.y - b.y)],
    ["bottom", Math.abs(p.y - (b.y + b.height))],
    ["left", Math.abs(p.x - b.x)],
    ["right", Math.abs(p.x - (b.x + b.width))],
  ];
  return d.sort((a, b2) => a[1] - b2[1])[0]![0];
}

/** Os nós dentro de um grupo (a caixa inteira dentro da dele): andam junto quando o grupo anda. */
export function insideGroup(nodes: readonly CanvasNode[], group: Box & { id?: string }): CanvasNode[] {
  return nodes.filter(
    (n) => isDrawableNode(n) && n.id !== group.id && n.x >= group.x && n.y >= group.y && n.x + n.width <= group.x + group.width && n.y + n.height <= group.y + group.height,
  );
}

// ---------------------------------------------------------------- as cores

/** As 6 cores do formato ("1" a "6"): vermelho, laranja, amarelo, verde, ciano e roxo. */
export const CANVAS_PRESETS = ["1", "2", "3", "4", "5", "6"] as const;
export const CANVAS_PRESET_NAMES: Readonly<Record<string, string>> = { "1": "Vermelho", "2": "Laranja", "3": "Amarelo", "4": "Verde", "5": "Ciano", "6": "Roxo" };

/** A cor de um nó ou aresta como CSS: o token do preset, o hex do arquivo, ou `null` (a cor padrão). Nada além disso. */
export function canvasColor(color: unknown): string | null {
  if (typeof color !== "string") return null;
  if ((CANVAS_PRESETS as readonly string[]).includes(color)) return `var(--canvas-${color})`;
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) return color;
  return null;
}
