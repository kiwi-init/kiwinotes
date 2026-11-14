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

  // Spec #12750: a seção que já existe, em qualquer nível, e um título dentro de código que não conta.
  const sections = (c: string) => [...c.matchAll(/^#{1,6}[ \t]+referências[ \t]*$/gim)].length;

  test("a seção em H3 (ou em outro nível, com outra caixa): o link novo entra nela, sem criar uma 2ª", () => {
    const note = "# PACS\n\n### Referências\n\n- velho\n\n### Equipe\n\nAna.\n";
    const r = noteWithReferences(note, [A]);
    expect(r.content).toBe(`# PACS\n\n### Referências\n\n- velho\n${referenceLine(A)}\n\n### Equipe\n\nAna.\n`);
    expect(r.created).toBe(false);
    // Um H4 depois dela fica dentro da seção; o próximo título do mesmo nível (ou maior) a fecha.
    const deep = noteWithReferences("# PACS\n\n## referências \n\n#### Livros\n\n- velho\n\n## Equipe\n", [A]).content;
    expect(deep).toBe(`# PACS\n\n## referências \n\n#### Livros\n\n- velho\n${referenceLine(A)}\n\n## Equipe\n`);
    // Uma seção vazia em H3 ganha a linha em branco depois do título.
    expect(noteWithReferences("# PACS\n\n### Referências\n", [A]).content).toBe(`# PACS\n\n### Referências\n\n${referenceLine(A)}\n`);
    for (const c of [r.content, deep]) expect(sections(c)).toBe(1);
  });

  test("um ## Referências dentro de um bloco de código não é a seção: ela vai no fim, e o código não muda", () => {
    for (const fence of ["```", "~~~"]) {
      const code = `${fence}md\n## Referências\n- [x](https://exemplo.com/x)\n${fence}`;
      const r = noteWithReferences(`# PACS\n\n${code}\n`, [A]);
      expect(r.content).toBe(`# PACS\n\n${code}\n\n## Referências\n\n${referenceLine(A)}\n`);
      expect(r.created).toBe(true);
      expect(r.content).toContain(code);
    }
  });

  test("as duas coisas juntas: o título do código fica, e o link vai para a seção H3 de verdade", () => {
    const code = "```md\n## Referências\n```";
    const r = noteWithReferences(`# PACS\n\n${code}\n\n### Referências\n\n- velho\n`, [A]);
    expect(r.content).toBe(`# PACS\n\n${code}\n\n### Referências\n\n- velho\n${referenceLine(A)}\n`);
    expect(r.created).toBe(false);
    // Fora do código, só uma seção.
    expect(sections(r.content.replace(code, ""))).toBe(1);
  });

  test("um link com parênteses (a Wikipédia) vira um link válido e não se repete (revisão do T11986)", () => {
    const item = { title: "Função (matemática)", url: "https://pt.wikipedia.org/wiki/Fun%C3%A7%C3%A3o_(matem%C3%A1tica)", summary: "" };
    const line = referenceLine(item);
    expect(line).toBe("- [Função (matemática)](https://pt.wikipedia.org/wiki/Fun%C3%A7%C3%A3o_%28matem%C3%A1tica%29)");
    const once = noteWithReferences("# Nota\n", [item]);
    expect(noteWithReferences(once.content, [item]).added).toEqual([]);
    // O link cru, com os parênteses, solto no texto ou num link do Markdown, também conta.
    expect(noteWithReferences("ver https://pt.wikipedia.org/wiki/Fun%C3%A7%C3%A3o_(matem%C3%A1tica).", [item]).added).toEqual([]);
    expect(noteWithReferences("[f](https://pt.wikipedia.org/wiki/Fun%C3%A7%C3%A3o_(matem%C3%A1tica))", [item]).added).toEqual([]);
  });

  test("o mesmo link com outra forma (o #, a barra, o host maiúsculo) é o mesmo", () => {
    expect(linkKey("https://Example.com/a/#x")).toBe(linkKey("https://example.com/a"));
    expect(noteWithReferences("ver https://example.com/a.", [{ title: "A", url: "https://EXAMPLE.com/a/", summary: "" }]).added).toEqual([]);
  });
});
