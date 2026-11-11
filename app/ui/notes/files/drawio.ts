// O `.drawio` das Notas (T7112, spec #7079), a parte pura: antes de entregar o arquivo ao viewer do draw.io, conferir
// que é mesmo um diagrama e que ele não abre grande demais. Um `.drawio` é XML (`<mxfile>` com uma `<diagram>` por
// página); cada página vem em XML ou comprimida (deflate em base64). Comprimida, ela pode ser uma bomba, como o docx
// (revisão do T7110): cada página é descompactada aqui em pedaços, contando os bytes, e a conta para no teto.

import { inflatedSize } from "./zipSize.ts";

/** O maior diagrama aberto (todas as páginas juntas), e o maior número de páginas. */
export const DRAWIO_LIMITS = { bytes: 20 * 1024 * 1024, pages: 200 } as const;

export type DrawioCheck = { ok: true; pages: number } | { ok: false; reason: "not-drawio" | "too-large" };

function base64Bytes(text: string): Uint8Array | null {
  const clean = text.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  try {
    const binary = atob(clean);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Se o texto é um diagrama do draw.io que cabe nos limites. */
export function checkDrawio(text: string, limits: { bytes: number; pages: number } = DRAWIO_LIMITS): DrawioCheck {
  const body = text.replace(/^﻿/, "").trimStart();
  // Um `<mxfile>` (o formato de hoje) ou um `<mxGraphModel>` solto (o antigo).
  if (!/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(mxfile|mxGraphModel)[\s>]/.test(body)) return { ok: false, reason: "not-drawio" };
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<mxGraphModel[\s>]/.test(body)) {
    return text.length > limits.bytes ? { ok: false, reason: "too-large" } : { ok: true, pages: 1 };
  }
  const pages = [...body.matchAll(/<diagram\b[^>]*>([\s\S]*?)<\/diagram>/g)];
  if (pages.length > limits.pages) return { ok: false, reason: "too-large" };
  let total = 0;
  for (const [, content] of pages) {
    const inner = content!.trim();
    if (inner.startsWith("<")) {
      total += inner.length;
    } else if (inner) {
      // Comprimida: deflate cru, em base64.
      const bytes = base64Bytes(inner);
      if (!bytes) return { ok: false, reason: "not-drawio" };
      const size = inflatedSize(bytes, 8, limits.bytes - total);
      if (size < 0) return { ok: false, reason: "not-drawio" };
      total += size;
    }
    if (total > limits.bytes) return { ok: false, reason: "too-large" };
  }
  return { ok: true, pages: Math.max(pages.length, 1) };
}
