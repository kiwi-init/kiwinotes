import { describe, expect, test } from "bun:test";

import {
  addEdge,
  addNode,
  arrowHead,
  boundsOf,
  bringToFront,
  canvasColor,
  CanvasParseError,
  edgeGeometry,
  facingSide,
  insideGroup,
  isDrawableEdge,
  isDrawableNode,
  nearestSide,
  newCanvasId,
  nodeAt,
  parseCanvas,
  removeItems,
  stringifyCanvas,
  updateEdge,
  updateNode,
} from "./json-canvas.ts";

/** Um `.canvas` como o Obsidian grava: um nó por linha, com campos que o Kiwi não conhece. */
const OBSIDIAN = `{
\t"nodes":[
\t\t{"id":"a1b2c3d4e5f60718","type":"group","x":-400,"y":-300,"width":900,"height":600,"label":"Mudança","color":"5"},
\t\t{"id":"0f1e2d3c4b5a6978","type":"text","text":"# Plano\\n\\n- medir as salas","x":-360,"y":-240,"width":300,"height":160,"styleAttributes":{"textAlign":"center"}},
\t\t{"id":"1122334455667788","type":"file","file":"Projetos/Mudança.md","subpath":"#Custos","x":40,"y":-240,"width":400,"height":300},
\t\t{"id":"99aabbccddeeff00","type":"link","url":"https://example.com/plano","x":40,"y":100,"width":400,"height":120,"color":"#3a7bd5"}
\t],
\t"edges":[
\t\t{"id":"e000000000000001","fromNode":"0f1e2d3c4b5a6978","fromSide":"right","toNode":"1122334455667788","toSide":"left","label":"detalhe"},
\t\t{"id":"e000000000000002","fromNode":"1122334455667788","fromSide":"bottom","fromEnd":"arrow","toNode":"99aabbccddeeff00","toSide":"top","toEnd":"none","color":"1"}
\t],
\t"metadata":{"version":"1.0-1.0","frontmatter":{}}
}`;

describe("ler e gravar o .canvas (T6600)", () => {
  test("sem mudança, grava byte a byte o que o Obsidian gravou, com os campos que o Kiwi não conhece", () => {
    const doc = parseCanvas(OBSIDIAN);
    expect(doc.nodes).toHaveLength(4);
    expect(doc.edges).toHaveLength(2);
    expect(stringifyCanvas(doc)).toBe(OBSIDIAN);
  });

  test("mover um nó troca só o x e o y dele, na mesma posição do objeto; o resto fica igual", () => {
    const moved = updateNode(parseCanvas(OBSIDIAN), "0f1e2d3c4b5a6978", { x: -350.6, y: -230.2 });
    const out = stringifyCanvas(moved);
    expect(out).toContain(`{"id":"0f1e2d3c4b5a6978","type":"text","text":"# Plano\\n\\n- medir as salas","x":-351,"y":-230,"width":300,"height":160,"styleAttributes":{"textAlign":"center"}}`);
    const before = OBSIDIAN.split("\n");
    const after = out.split("\n");
    expect(after.filter((l, i) => l !== before[i])).toHaveLength(1);
  });

  test("o arquivo vazio é um quadro vazio; o topo sem nodes/edges ganha as listas", () => {
    expect(parseCanvas("")).toEqual({ nodes: [], edges: [] });
    expect(parseCanvas("  \n")).toEqual({ nodes: [], edges: [] });
    expect(parseCanvas("{}")).toEqual({ nodes: [], edges: [] });
    expect(stringifyCanvas(parseCanvas("{}"))).toBe('{\n\t"nodes":[],\n\t"edges":[]\n}');
  });

  test("JSON quebrado ou topo errado não abre (e assim nada grava por cima)", () => {
    expect(() => parseCanvas("{ nodes: [")).toThrow(CanvasParseError);
    expect(() => parseCanvas("[]")).toThrow(CanvasParseError);
    expect(() => parseCanvas('{"nodes":{}}')).toThrow(CanvasParseError);
    expect(() => parseCanvas('{"edges":"x"}')).toThrow(CanvasParseError);
  });

  test("o nó que não dá para desenhar fica no arquivo como está, e a aresta solta também", () => {
    const text = '{"nodes":[{"id":"a","type":"text","text":"ok","x":0,"y":0,"width":10,"height":10},{"id":"b","type":"futuro","x":"?"}],"edges":[{"id":"e","fromNode":"a","toNode":"zz"}]}';
    const doc = parseCanvas(text);
    expect(doc.nodes.filter(isDrawableNode).map((n) => n.id)).toEqual(["a"]);
    const ids = new Set(doc.nodes.filter(isDrawableNode).map((n) => n.id));
    expect(doc.edges.filter((e) => isDrawableEdge(e, ids))).toEqual([]);
    const again = parseCanvas(stringifyCanvas(updateNode(doc, "a", { text: "mudou" })));
    expect(again.nodes[1]).toEqual({ id: "b", type: "futuro", x: "?" } as never);
    expect(again.edges[0]).toEqual({ id: "e", fromNode: "a", toNode: "zz" });
  });

  test("apagar um nó leva as arestas dele; apagar uma aresta não mexe nos nós", () => {
    const doc = parseCanvas(OBSIDIAN);
    const noFile = removeItems(doc, new Set(["1122334455667788"]));
    expect(noFile.nodes.map((n) => n.id)).toEqual(["a1b2c3d4e5f60718", "0f1e2d3c4b5a6978", "99aabbccddeeff00"]);
    expect(noFile.edges).toEqual([]);
    const noEdge = removeItems(doc, new Set(["e000000000000001"]));
    expect(noEdge.nodes).toHaveLength(4);
    expect(noEdge.edges.map((e) => e.id)).toEqual(["e000000000000002"]);
    expect(noEdge.metadata).toEqual(doc.metadata);
  });

  test("criar nó e aresta: inteiros, no fim da lista, com id novo de 16 hex", () => {
    let doc = parseCanvas(OBSIDIAN);
    const id = newCanvasId(doc);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    doc = addNode(doc, { id, type: "text", text: "", x: 10.4, y: 20.6, width: 250, height: 60 });
    expect(doc.nodes.at(-1)).toEqual({ id, type: "text", text: "", x: 10, y: 21, width: 250, height: 60 });
    doc = addEdge(doc, { id: "e3", fromNode: id, toNode: "0f1e2d3c4b5a6978", fromSide: "left", toSide: "right", label: undefined });
    expect(doc.edges.at(-1)).toEqual({ id: "e3", fromNode: id, toNode: "0f1e2d3c4b5a6978", fromSide: "left", toSide: "right" });
    expect(updateEdge(doc, "e3", { label: "por quê" }).edges.at(-1)!.label).toBe("por quê");
    expect(updateEdge(doc, "e000000000000001", { label: undefined }).edges[0]).not.toHaveProperty("label");
  });

  test("um id que já existe não volta", () => {
    let calls = 0;
    // Primeiro sorteia "0f1e2d3c4b5a6978" (já existe) e depois zeros.
    const digits = "0f1e2d3c4b5a6978".split("").map((c) => parseInt(c, 16) / 16 + 0.001);
    const random = () => (calls < 16 ? digits[calls++]! : (calls++, 0));
    expect(newCanvasId(parseCanvas(OBSIDIAN), random)).toBe("0000000000000000");
  });

  test("trazer para a frente vai para o fim da lista; o grupo fica atrás", () => {
    const doc = parseCanvas(OBSIDIAN);
    expect(bringToFront(doc, "0f1e2d3c4b5a6978").nodes.at(-1)!.id).toBe("0f1e2d3c4b5a6978");
    expect(bringToFront(doc, "a1b2c3d4e5f60718")).toBe(doc);
  });
});

describe("a geometria do quadro (T6600)", () => {
  const a = { x: 0, y: 0, width: 100, height: 50 };
  const b = { x: 300, y: 0, width: 100, height: 50 };
  const below = { x: 0, y: 300, width: 100, height: 50 };

  test("sem lado no arquivo, a aresta sai do lado que olha para o outro nó", () => {
    expect(facingSide(a, b)).toBe("right");
    expect(facingSide(b, a)).toBe("left");
    expect(facingSide(a, below)).toBe("bottom");
    expect(facingSide(below, a)).toBe("top");
  });

  test("a curva sai do meio do lado e chega no meio do outro, na perpendicular", () => {
    const g = edgeGeometry(a, b, "right", "left");
    expect(g.from).toEqual({ x: 100, y: 25 });
    expect(g.to).toEqual({ x: 300, y: 25 });
    expect(g.path).toBe("M 100 25 C 200 25, 200 25, 300 25");
    expect(g.middle).toEqual({ x: 200, y: 25 });
    expect(edgeGeometry(a, below).fromSide).toBe("bottom");
    expect(edgeGeometry(a, b, "sideways" as never).fromSide).toBe("right");
  });

  test("a seta aponta para dentro do lado em que chega", () => {
    expect(arrowHead({ x: 300, y: 25 }, "left", 10)).toBe("300,25 290,20 290,30");
    expect(arrowHead({ x: 50, y: 0 }, "top", 10)).toBe("50,0 55,-10 45,-10");
  });

  test("enquadrar, achar o nó sob o ponto e o lado mais perto", () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([a, b, below])).toEqual({ x: 0, y: 0, width: 400, height: 350 });
    const doc = parseCanvas(OBSIDIAN);
    expect(nodeAt(doc.nodes, { x: -300, y: -200 })!.id).toBe("0f1e2d3c4b5a6978");
    expect(nodeAt(doc.nodes, { x: -390, y: 250 })!.id).toBe("a1b2c3d4e5f60718");
    expect(nodeAt(doc.nodes, { x: 9999, y: 0 })).toBeNull();
    expect(nearestSide(a, { x: 98, y: 30 })).toBe("right");
    expect(nearestSide(a, { x: 50, y: 2 })).toBe("top");
    const group = doc.nodes[0]!;
    expect(insideGroup(doc.nodes, group).map((n) => n.id)).toEqual(["0f1e2d3c4b5a6978", "1122334455667788", "99aabbccddeeff00"]);
  });

  test("a cor: os 6 do formato viram token, o hex passa, o resto é a cor padrão", () => {
    expect(canvasColor("4")).toBe("var(--canvas-4)");
    expect(canvasColor("#3a7bd5")).toBe("#3a7bd5");
    expect(canvasColor("#abc")).toBe("#abc");
    expect(canvasColor("red; background: url(x)")).toBeNull();
    expect(canvasColor("7")).toBeNull();
    expect(canvasColor(3)).toBeNull();
  });
});
