// O Modelo de nota (spec #11102): o tipo, o padrão e o saneamento, puros e sem Node, para o agente, a tela de Ajustes e
// a nota da reunião (spec #8360, T11478) usarem o mesmo modelo. A leitura e a gravação do arquivo ficam em
// `src/agent/note-model.ts`.

export const NOTE_BLOCKS = ["titulo", "propriedades", "introducao", "sumario", "corpo", "fechamento"] as const;
export type NoteBlock = (typeof NOTE_BLOCKS)[number];
export const BODY_STYLES = ["topicos", "curtos", "longos", "misto"] as const;
export type BodyStyle = (typeof BODY_STYLES)[number];

export interface NoteModel {
  /** Os blocos na ordem da nota, cada um ligado ou desligado. Sempre os seis, sem repetição. */
  blocks: { block: NoteBlock; on: boolean }[];
  body: BodyStyle;
  /** Os títulos com numeração (1., 1.1.). */
  numbered: boolean;
  /** Até que nível de título o sumário desce (1 a 3). */
  tocDepth: 1 | 2 | 3;
}

/** O padrão do spec: título, propriedades no alto, introdução curta, sumário, corpo misto e fechamento. */
export const DEFAULT_NOTE_MODEL: NoteModel = {
  blocks: NOTE_BLOCKS.map((block) => ({ block, on: true })),
  body: "misto",
  numbered: false,
  tocDepth: 2,
};

/** Um modelo válido a partir de qualquer entrada (a tela, o arquivo): o que não fecha cai no padrão. */
export function sanitizeNoteModel(input: unknown): NoteModel {
  const m = (input && typeof input === "object" ? input : {}) as Partial<NoteModel>;
  const seen = new Set<NoteBlock>();
  const blocks: NoteModel["blocks"] = [];
  for (const b of Array.isArray(m.blocks) ? m.blocks : []) {
    if (!b || typeof b !== "object") continue;
    const block = (b as { block?: unknown }).block;
    if (!NOTE_BLOCKS.includes(block as NoteBlock) || seen.has(block as NoteBlock)) continue;
    seen.add(block as NoteBlock);
    blocks.push({ block: block as NoteBlock, on: (b as { on?: unknown }).on !== false });
  }
  // Um bloco que faltou entra no fim, ligado: o modelo sempre tem os seis.
  for (const block of NOTE_BLOCKS) if (!seen.has(block)) blocks.push({ block, on: true });
  return {
    blocks,
    body: BODY_STYLES.includes(m.body as BodyStyle) ? (m.body as BodyStyle) : DEFAULT_NOTE_MODEL.body,
    numbered: m.numbered === true,
    tocDepth: m.tocDepth === 1 || m.tocDepth === 2 || m.tocDepth === 3 ? m.tocDepth : DEFAULT_NOTE_MODEL.tocDepth,
  };
}
