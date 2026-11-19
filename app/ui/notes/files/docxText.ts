// O texto dos parágrafos do corpo de um docx, direto do `word/document.xml` (T21231, spec #21155). Depois de a tela
// tocar as mudanças do Kiwi Cat, o docx da tela e o do disco (o que o agente gravou) passam por aqui: se o texto não é
// o mesmo, a tela abre o do disco. A tela nunca mostra um texto que não está no arquivo. Sem React e sem DOM.

import { partText, readZip } from "../../../src/shared/sheet/zip.ts";

export interface DocxTextParagraph {
  /** O `w14:paraId`, se o parágrafo tem. */
  id: string | null;
  text: string;
}

const TOKEN = /<(\/?)(w:p|w:t|w:tab|w:br|w:cr|w:delText)\b([^>]*?)(\/?)>|([^<]+)/g;
const PARA_ID = /\bw14:paraId\s*=\s*["']([0-9A-Fa-f]+)["']/;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });

/**
 * Os parágrafos do `word/document.xml`, na ordem em que abrem (os das tabelas também). O texto é o dos `w:t`, com o
 * `w:tab` como tab e a quebra de linha como `\n`; o que está riscado numa revisão (`w:delText`) não conta.
 */
export function docxBodyParagraphs(bytes: Uint8Array): DocxTextParagraph[] {
  const part = readZip(bytes).find((p) => p.name === "word/document.xml");
  if (!part) throw new Error("docx sem word/document.xml");
  const xml = partText(bytes, part);
  const out: DocxTextParagraph[] = [];
  const open: DocxTextParagraph[] = [];
  let inText = false;
  for (const m of xml.matchAll(TOKEN)) {
    const [, close, name, attrs, empty, text] = m;
    if (text !== undefined) {
      if (inText && open.length) open[open.length - 1]!.text += decode(text);
      continue;
    }
    const top = open[open.length - 1];
    switch (name) {
      case "w:p":
        if (close) open.pop();
        else {
          const p = { id: PARA_ID.exec(attrs ?? "")?.[1]?.toUpperCase() ?? null, text: "" };
          out.push(p);
          if (!empty) open.push(p);
        }
        break;
      case "w:t":
        inText = !close && !empty;
        break;
      case "w:delText":
        inText = false;
        break;
      case "w:tab":
        // O `w:tab` com `w:val` é uma parada de tab do parágrafo (no `w:tabs`), não um caractere.
        if (!close && top && !/\bw:val\s*=/.test(attrs ?? "")) top.text += "\t";
        break;
      case "w:br":
      case "w:cr":
        if (!close && top) top.text += "\n";
        break;
    }
  }
  return out;
}

/**
 * A tela ficou igual ao disco? Sem edição da pessoa por gravar (`pending` falso), o texto de todos os parágrafos, na
 * ordem. Com ela, só os parágrafos que o gato tocou (`touched`, pelo id) e os que ele apagou (`gone`, que não podem
 * estar na tela): o resto do documento a pessoa ainda pode ter mudado.
 */
export function sameText(screen: DocxTextParagraph[], disk: DocxTextParagraph[], o: { pending: boolean; touched: Iterable<string>; gone: Iterable<string> }): boolean {
  if (!o.pending) return screen.length === disk.length && screen.every((p, i) => p.text === disk[i]!.text);
  const byId = (list: DocxTextParagraph[]) => new Map(list.filter((p) => p.id).map((p) => [p.id!, p.text]));
  const a = byId(screen);
  const b = byId(disk);
  for (const id of o.touched) {
    const k = id.toUpperCase();
    if (!a.has(k) || a.get(k) !== b.get(k)) return false;
  }
  for (const id of o.gone) if (a.has(id.toUpperCase())) return false;
  return true;
}
