// O id do parágrafo do docx entre o agente e a tela (T21231, spec #21155). O agente fala pelo `w14:paraId` (o
// `getParagraphId` do motor sem tela); a tela, pelo id do nó na árvore (`/word/document.xml#0.0.2.2.0.0`). A sessão da
// superfície traduz um no outro, mas fica fora dos tipos públicos do @docx-editor.dev/core (fixo em 2.39.0): este é o
// único lugar que a usa, e o `scripts/docx-ids.test.ts` quebra se uma versão nova a tirar ou mudar.

import type { PaginatedSurface } from "@docx-editor.dev/core/editor";

interface ParaIdSession {
  paraIdOf(nodeId: string): string | null;
  nodeIdOf(paraId: string): string | null;
}

/** A tradução da superfície, ou `null` se esta versão do motor não a tem. */
export function paraIds(surface: PaginatedSurface): ParaIdSession | null {
  const s = (surface as PaginatedSurface & { session?: Partial<ParaIdSession> }).session;
  if (!s || typeof s.paraIdOf !== "function" || typeof s.nodeIdOf !== "function") return null;
  return { paraIdOf: (id) => s.paraIdOf!(id), nodeIdOf: (id) => s.nodeIdOf!(id) };
}
