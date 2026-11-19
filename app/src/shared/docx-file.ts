// Se um docx pode ser trocado pelo que as Notas gravaram (T21152, spec #21080). O docx com senha não é um zip (é um
// arquivo do Office cifrado), e um zip sem o `word/document.xml` não é um documento do Word: nesses dois casos o
// arquivo nunca é trocado, e os bytes novos só vão para o disco se forem um docx que dá para abrir de novo.

import { readZip } from "./sheet/zip.ts";

export type DocxCheck = { editable: true } | { editable: false; reason: "password" | "not-docx" };

/** O começo de um arquivo do Office no formato antigo (o "Compound File" da Microsoft): o docx cifrado, mas também o
 *  `.doc`, o `.xls` e o `.ppt` de antes de 2007. */
const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
/** O nome do fluxo que só o docx cifrado tem, em UTF-16LE no diretório do Compound File (T23170): sem ele, o arquivo
 *  é do formato antigo, não um docx com senha. */
const ENCRYPTED_PACKAGE = new Uint8Array([..."EncryptedPackage"].flatMap((c) => [c.charCodeAt(0), 0]));

function hasBytes(bytes: Uint8Array, needle: Uint8Array): boolean {
  const first = needle[0]!;
  for (let i = bytes.indexOf(first); i !== -1 && i <= bytes.length - needle.length; i = bytes.indexOf(first, i + 1)) {
    let k = 1;
    while (k < needle.length && bytes[i + k] === needle[k]) k++;
    if (k === needle.length) return true;
  }
  return false;
}

export function inspectDocx(bytes: Uint8Array): DocxCheck {
  if (CFB.every((b, i) => bytes[i] === b)) return { editable: false, reason: hasBytes(bytes, ENCRYPTED_PACKAGE) ? "password" : "not-docx" };
  try {
    const names = new Set(readZip(bytes).map((p) => p.name));
    if (names.has("[Content_Types].xml") && names.has("word/document.xml")) return { editable: true };
  } catch {}
  return { editable: false, reason: "not-docx" };
}
