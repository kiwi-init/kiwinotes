// O `.drawio` das Notas (T7112, spec #7079), a parte pura: antes de entregar o arquivo ao viewer do draw.io, conferir
// que é mesmo um diagrama e que ele não abre grande demais. Um `.drawio` é XML (`<mxfile>` com uma `<diagram>` por
// página); cada página vem em XML ou comprimida (deflate em base64). Comprimida, ela pode ser uma bomba, como o docx
// (revisão do T7110): cada página é descompactada aqui em pedaços, contando os bytes, e a conta para no teto.

import { inflateRaw } from "pako/lib/inflate.js";

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

// ---------------------------------------------------------------- o texto do diagrama (T22217)

/** Um rótulo do diagrama: o texto de uma forma ou de uma seta, com o id da célula (o ⌘F seleciona por ele). */
export interface DrawioLabel {
  id: string;
  text: string;
}

/** Uma página do diagrama, com o nome e os rótulos, na ordem do arquivo. */
export interface DrawioPage {
  /** O nome da aba no arquivo; vazio quando ela não tem (T30631: nada inventado em português, quem mostra põe o rótulo). */
  name: string;
  labels: DrawioLabel[];
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Os atributos de uma tag, já sem as entidades do XML. */
function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out.set(m[1]!, decodeEntities(m[2] ?? m[3] ?? ""));
  return out;
}

/** O rótulo como texto: o HTML do rótulo (`html=1`) sem as tags, com as quebras de linha. */
function labelText(value: string, html: boolean): string {
  const t = html
    ? decodeEntities(
        value
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/?(div|p|li|tr|h[1-6])\b[^>]*>/gi, "\n")
          .replace(/<[^>]*>/g, ""),
      )
    : value;
  return t.replace(/[ \t\u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
}

/** Os rótulos de um `<mxGraphModel>`: as células com `value` e os objetos com `label` (o `<UserObject>` e o `<object>`). */
function modelLabels(xml: string): DrawioLabel[] {
  const out: DrawioLabel[] = [];
  for (const m of xml.matchAll(/<(mxCell|UserObject|object)\b([^>]*)>/g)) {
    const a = attributes(m[2]!);
    const raw = m[1] === "mxCell" ? a.get("value") : a.get("label");
    if (!raw) continue;
    // Num objeto, o estilo (com o `html=1`) fica na célula de dentro: o rótulo dele quase sempre é HTML.
    const html = m[1] === "mxCell" ? /(?:^|;)html=1(?:;|$)/.test(a.get("style") ?? "") : true;
    const text = labelText(raw, html);
    if (text) out.push({ id: a.get("id") ?? "", text });
  }
  return out;
}

/** A página comprimida aberta: base64, deflate cru e o `encodeURIComponent`, como o draw.io grava. */
function unpack(inner: string): string | null {
  try {
    const bin = atob(inner.replace(/\s+/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const out = inflateRaw(bytes) as Uint8Array | undefined;
    if (!out) return null;
    return decodeURIComponent(new TextDecoder().decode(out));
  } catch {
    return null;
  }
}

/**
 * O texto do diagrama, por página: o que o ⌘F procura, o que a busca das Notas indexa e o que o Kiwi Cat lê. Passa
 * antes pelo `checkDrawio`: um arquivo que não é diagrama, ou que abre grande demais, dá null, sem descompactar nada.
 */
export function drawioPages(text: string, limits: { bytes: number; pages: number } = DRAWIO_LIMITS): DrawioPage[] | null {
  if (!checkDrawio(text, limits).ok) return null;
  const body = text.replace(/^\uFEFF/, "");
  const diagrams = [...body.matchAll(/<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/g)];
  if (!diagrams.length) return [{ name: "", labels: modelLabels(body) }];
  return diagrams.map(([, attrs, content]) => {
    const inner = content!.trim();
    const xml = inner.startsWith("<") ? inner : inner ? (unpack(inner) ?? "") : "";
    return { name: attributes(attrs!).get("name") ?? "", labels: modelLabels(xml) };
  });
}
