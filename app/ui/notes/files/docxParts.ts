// As partes do docx que o motor só reescreveu (T21152, spec #21080). Ao gravar, o motor serializa de novo tudo o que
// leu: tira o `<?xml …?>`, muda a ordem dos atributos (e a da lista do `mc:Ignorable`), fecha `<a></a>` como `<a/>`,
// tira o `xml:space="preserve"` que não preserva nada e dá um `w14:paraId` a cada parágrafo. O conteúdo é o mesmo, mas os
// bytes mudam, e o arquivo sairia diferente do original em partes que a pessoa nem tocou (estilos, numeração, rels).
// Aqui, cada parte cuja forma canônica é igual à do arquivo aberto volta com os bytes de lá.

import { partBytes, partText, readZip, writeZip } from "../../../src/shared/sheet/zip.ts";

const TAG = /<([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Atributos que o motor cria sozinho ao ler (o id de cada parágrafo): não contam na comparação. */
const GENERATED = new Set(["w14:paraId", "w14:textId"]);

/** O XML numa forma que não depende da serialização: sem a declaração, atributos em ordem, elemento vazio fechado. */
export function canonicalXml(xml: string): string {
  return xml
    .replace(/^﻿?\s*<\?xml[^?]*\?>\s*/, "")
    .replace(TAG, (_, name: string, attrs: string, empty: string) => {
      const list = [...attrs.matchAll(ATTR)]
        .filter((a) => !GENERATED.has(a[1]!))
        .map((a) => {
          let value = (a[2] ?? a[3] ?? "").replace(/'/g, "&apos;").replace(/"/g, "&quot;");
          if (a[1] === "mc:Ignorable") value = value.split(/\s+/).filter(Boolean).sort().join(" ");
          return `${a[1]}="${value}"`;
        });
      list.sort();
      return `<${name}${list.map((a) => ` ${a}`).join("")}${empty}>`;
    })
    .replace(/<([A-Za-z_][\w.:-]*)((?:\s[^>]*)?)><\/\1>/g, "<$1$2/>")
    .replace(/<(w:t|w:delText|w:instrText|w:delInstrText) xml:space="preserve">([^<\s](?:[^<]*[^<\s])?)<\/\1>/g, "<$1>$2</$1>")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x?[0-9A-Fa-f]+;/g, (e) => String.fromCodePoint(e[2] === "x" ? parseInt(e.slice(3, -1), 16) : parseInt(e.slice(2, -1), 10)));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** O docx gravado com as partes que só mudaram de forma voltando aos bytes de `original`. */
export function keepUntouchedParts(saved: Uint8Array, original: Uint8Array): Uint8Array {
  try {
    const before = new Map(readZip(original).map((p) => [p.name, p]));
    const parts = readZip(saved);
    const kept = new Map<string, Uint8Array>();
    for (const part of parts) {
      const old = before.get(part.name);
      if (!old || !/\.(xml|rels)$/i.test(part.name)) continue;
      const a = partBytes(original, old);
      const b = partBytes(saved, part);
      if (sameBytes(a, b)) continue;
      if (canonicalXml(partText(saved, part)) === canonicalXml(partText(original, old))) kept.set(part.name, a);
    }
    return kept.size ? writeZip(saved, parts, kept) : saved;
  } catch {
    return saved;
  }
}
