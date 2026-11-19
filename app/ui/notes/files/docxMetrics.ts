// A altura da linha do docx como a do Word (T21151, spec #21080). O Word põe as linhas pela métrica "win" da fonte (o
// winAscent + o winDescent da tabela OS/2); o canvas do WebKit mede pela outra (a hhea), e um texto em Helvetica ou
// Georgia sai com a linha mais baixa: as páginas quebram em outro lugar. Aqui só a altura da linha muda: a largura das
// letras segue a do canvas. Os números são das próprias fontes (o OS/2 de cada uma, dividido pelas unidades do em); a
// Calibri e a Cambria vêm das fontes livres de métrica igual (Carlito e Caladea), porque o Mac não as tem.

import type { TextMeasurer } from "@docx-editor.dev/core/layout";

/** A altura da linha do Word, em em, pela família em minúsculas. */
export const WORD_LINE_EM: Readonly<Record<string, number>> = {
  arial: 2288 / 2048,
  calibri: 2500 / 2048,
  cambria: 1.3,
  "courier new": 2320 / 2048,
  georgia: 2327 / 2048,
  helvetica: 2407 / 2048,
  "helvetica neue": 1.165,
  tahoma: 2472 / 2048,
  "times new roman": 2268 / 2048,
  "trebuchet ms": 2378 / 2048,
  verdana: 2489 / 2048,
  // As livres de métrica igual: o mesmo número da fonte que copiam.
  carlito: 2500 / 2048,
  caladea: 1.3,
  "liberation sans": 2288 / 2048,
  "liberation serif": 2268 / 2048,
  "liberation mono": 2320 / 2048,
};

interface LineStyle {
  fontFamily?: string | null;
  fontSizePt: number;
}

/**
 * A linha de uma fonte da tabela, a partir da que o canvas mediu. Só cresce (uma fonte que o canvas já mede mais alta
 * fica como está), e a linha de base desce na mesma proporção, para a letra não colar no topo.
 */
export function wordLineMetrics(measured: { height: number; baseline: number }, style: LineStyle): { height: number; baseline: number } {
  const em = WORD_LINE_EM[(style.fontFamily ?? "").trim().toLowerCase()];
  if (!em || !(style.fontSizePt > 0) || !(measured.height > 0)) return measured;
  const height = Math.max(measured.height, style.fontSizePt * em);
  if (height === measured.height) return measured;
  return { height, baseline: measured.baseline + (height - measured.height) * (measured.baseline / measured.height) };
}

/** O medidor do canvas com a altura da linha do Word. O resto (larguras, contorno, cobertura) é o do canvas. */
export function wordMeasurer(base: TextMeasurer): TextMeasurer {
  return new Proxy(base, {
    get(target, key) {
      if (key === "lineMetrics") return (style: Parameters<TextMeasurer["lineMetrics"]>[0], text?: string) => wordLineMetrics(target.lineMetrics(style, text), style);
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
