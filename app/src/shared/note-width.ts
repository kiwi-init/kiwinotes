// A largura da coluna da nota (T5299, issue #212): os limites e o padrão, do engine e da UI.

/** Em px. Numa janela mais estreita que o máximo, a coluna cabe na janela: nunca há scroll de lado. */
export const NOTE_WIDTH = { min: 480, max: 1400, default: 760 } as const;

/** Uma largura que vale: número, arredondado e dentro dos limites; o resto volta ao padrão. */
export function sanitizeNoteWidth(input: unknown): number {
  if (typeof input !== "number" || !Number.isFinite(input)) return NOTE_WIDTH.default;
  return Math.min(NOTE_WIDTH.max, Math.max(NOTE_WIDTH.min, Math.round(input)));
}
