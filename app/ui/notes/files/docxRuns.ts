// Juntar os trechos iguais antes de gravar o docx (T21152, spec #21080). O motor às vezes grava o texto digitado com
// uma letra por trecho (`<w:r><w:t>L</w:t></w:r><w:r><w:t>i</w:t></w:r>…`): o Word lê, mas o arquivo incha, e reabrir e
// gravar não junta. Aqui, só os trechos vizinhos de forma simples (um `<w:t>` e nada mais) com os mesmos atributos e a
// mesma formatação viram um só. Qualquer outra coisa entre eles (uma inserção, um comentário, um campo) separa. As
// partes do zip que não mudam saem com os mesmos bytes.

import { partText, readZip, writeZip } from "../../../src/shared/sheet/zip.ts";

/** Um trecho simples: atributos, a formatação (ou nenhuma) e um `<w:t>` só. */
const RUN = /<w:r((?:\s[^>]*[^/>])?)>(<w:rPr\/>|<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*<\/w:rPr>)?<w:t(\s+xml:space="preserve")?>([^<]*)<\/w:t><\/w:r>/g;

/** As partes de texto do docx em que a pessoa digita. */
const STORY = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;

/** Junta os trechos vizinhos iguais de um XML do Word. Sem nada para juntar, devolve o mesmo texto. */
export function mergeRuns(xml: string): string {
  let out = "";
  let last = 0;
  let group: { start: number; end: number; attrs: string; rpr: string; text: string; preserve: boolean; count: number } | null = null;
  const close = () => {
    if (!group) return;
    if (group.count === 1) out += xml.slice(group.start, group.end);
    else {
      const preserve = group.preserve || /^\s|\s$/.test(group.text);
      out += `<w:r${group.attrs}>${group.rpr}<w:t${preserve ? ' xml:space="preserve"' : ""}>${group.text}</w:t></w:r>`;
    }
    last = group.end;
    group = null;
  };
  for (const m of xml.matchAll(RUN)) {
    const start = m.index;
    const end = start + m[0].length;
    const attrs = m[1] ?? "";
    const rpr = m[2] ?? "";
    const text = m[4] ?? "";
    const preserve = !!m[3];
    if (group && group.end === start && group.attrs === attrs && group.rpr === rpr) {
      group.end = end;
      group.text += text;
      group.preserve ||= preserve;
      group.count++;
      continue;
    }
    close();
    out += xml.slice(last, start);
    last = start;
    group = { start, end, attrs, rpr, text, preserve, count: 1 };
  }
  close();
  if (!out) return xml;
  return out + xml.slice(last);
}

/** O docx que o motor gravou, com os trechos iguais juntos. Se não der para ler o zip, volta como veio. */
export function tidyDocx(bytes: Uint8Array): Uint8Array {
  try {
    const parts = readZip(bytes);
    const changed = new Map<string, Uint8Array>();
    for (const part of parts) {
      if (!STORY.test(part.name)) continue;
      const xml = partText(bytes, part);
      const merged = mergeRuns(xml);
      if (merged !== xml) changed.set(part.name, new TextEncoder().encode(merged));
    }
    return changed.size ? writeZip(bytes, parts, changed) : bytes;
  } catch {
    return bytes;
  }
}
