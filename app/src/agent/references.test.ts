// As referências de uma nota (spec #11908): a seção no fim, sem repetir link.
import { describe, expect, test } from "bun:test";

import { linkKey, noteWithReferences, referenceLine } from "./references.ts";

const A = { title: "DICOMweb", url: "https://www.dicomstandard.org/using/dicomweb", summary: "O padrão do QIDO, WADO e STOW.", date: "2026-11-14" };
const B = { title: "Healthcare API [DICOM]", url: "https://cloud.google.com/healthcare-api/docs/dicom", summary: "  O dicomStore\n do Google. " };

describe("as referências da nota", () => {
  test("a linha: o título no link, a frase e a data; os colchetes do título saem", () => {
    expect(referenceLine(A)).toBe("- [DICOMweb](https://www.dicomstandard.org/using/dicomweb): O padrão do QIDO, WADO e STOW. (14/11/2026)");
    expect(referenceLine(B)).toBe("- [Healthcare API DICOM](https://cloud.google.com/healthcare-api/docs/dicom): O dicomStore do Google.");
  });

  test("sem a seção, ela entra no fim da nota; o resto não muda", () => {
    const r = noteWithReferences("# PACS\n\nA migração.\n", [A, B]);
    expect(r.content).toBe(`# PACS\n\nA migração.\n\n## Referências\n\n${referenceLine(A)}\n${referenceLine(B)}\n`);
    expect(r.added).toHaveLength(2);
    expect(r.created).toBe(true);
  });

  test("com a seção (mesmo no meio), os novos entram no fim dela, e um link que a nota já tem não se repete", () => {
    const note = `# PACS\n\n## Referências\n\n- [DICOMweb](https://www.dicomstandard.org/using/dicomweb/): já estava\n\n## Equipe\n\nAna.\n`;
    const r = noteWithReferences(note, [A, B]);
    expect(r.added).toEqual([B]);
    expect(r.content).toBe(`# PACS\n\n## Referências\n\n- [DICOMweb](https://www.dicomstandard.org/using/dicomweb/): já estava\n${referenceLine(B)}\n\n## Equipe\n\nAna.\n`);
    // Tudo já estava: a nota volta igual.
    expect(noteWithReferences(r.content, [A, B])).toMatchObject({ content: r.content, added: [] });
    // Uma seção vazia ganha a linha em branco depois do título.
    expect(noteWithReferences("# PACS\n\n## Referências\n", [A]).content).toBe(`# PACS\n\n## Referências\n\n${referenceLine(A)}\n`);
  });

  test("o mesmo link com outra forma (o #, a barra, o host maiúsculo) é o mesmo", () => {
    expect(linkKey("https://Example.com/a/#x")).toBe(linkKey("https://example.com/a"));
    expect(noteWithReferences("ver https://example.com/a.", [{ title: "A", url: "https://EXAMPLE.com/a/", summary: "" }]).added).toEqual([]);
  });
});
