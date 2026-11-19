// Se um docx pode ser trocado pelo que as Notas gravaram (T21152, spec #21080). O docx com senha não é um zip (é um
// arquivo do Office cifrado), e um zip sem o `word/document.xml` não é um documento do Word: nesses dois casos o
// arquivo nunca é trocado, e os bytes novos só vão para o disco se forem um docx que dá para abrir de novo.

import { readZip } from "./sheet/zip.ts";

export type DocxCheck = { editable: true } | { editable: false; reason: "password" | "not-docx" };

/** O começo de um arquivo do Office cifrado (o "Compound File" da Microsoft). */
const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function inspectDocx(bytes: Uint8Array): DocxCheck {
  if (CFB.every((b, i) => bytes[i] === b)) return { editable: false, reason: "password" };
  try {
    const names = new Set(readZip(bytes).map((p) => p.name));
    if (names.has("[Content_Types].xml") && names.has("word/document.xml")) return { editable: true };
  } catch {}
  return { editable: false, reason: "not-docx" };
}
