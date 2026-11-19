// O id do parágrafo do docx entre o agente e a tela (T21231, spec #21155). O agente fala pelo `w14:paraId` (o
// `getParagraphId` do motor sem tela); a tela, pelo id do nó na árvore (`/word/document.xml#0.0.2.2.0.0`). A sessão da
// superfície traduz um no outro, e dá a ordem dos parágrafos (os vazios também, que o layout não lista), mas fica fora
// dos tipos públicos do @docx-editor.dev/core (fixo em 2.39.0): este é o único lugar que a usa, e o
// `scripts/docx-ids.test.ts` quebra se uma versão nova a tirar ou mudar.

import type { PaginatedSurface } from "@docx-editor.dev/core/editor";

export interface ParaIdSession {
  paraIdOf(nodeId: string): string | null;
  nodeIdOf(paraId: string): string | null;
  /** Os nós dos parágrafos do corpo (`word/document.xml`), na ordem do documento. */
  order(): string[];
}

interface Raw {
  paraIdOf?: (nodeId: string) => string | null;
  nodeIdOf?: (paraId: string) => string | null;
  paragraphAnchors?: () => { ordinalByNode?: ReadonlyMap<string, number> };
}

const BODY = "/word/document.xml#";

/** A tradução da superfície, ou `null` se esta versão do motor não a tem. */
export function paraIds(surface: PaginatedSurface): ParaIdSession | null {
  const s = (surface as PaginatedSurface & { session?: Raw }).session;
  if (!s || typeof s.paraIdOf !== "function" || typeof s.nodeIdOf !== "function" || typeof s.paragraphAnchors !== "function") return null;
  return {
    paraIdOf: (id) => s.paraIdOf!(id),
    nodeIdOf: (id) => s.nodeIdOf!(id),
    order() {
      const byNode = s.paragraphAnchors!().ordinalByNode;
      if (!byNode || typeof byNode.entries !== "function") return [];
      return [...byNode.entries()]
        .filter(([n]) => n.startsWith(BODY))
        .sort((a, b) => a[1] - b[1])
        .map(([n]) => n);
    },
  };
}
