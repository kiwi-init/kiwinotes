import { describe, expect, test } from "bun:test";

import { embedLine, insertionAt, pastedName, sortFiles } from "./attachments.ts";

describe("os anexos no editor (T2594)", () => {
  test("uma linha que é só o embed de um anexo vira o anexo; o resto fica texto", () => {
    expect(embedLine("![[foto.png]]")).toEqual({ target: "foto.png", width: null });
    expect(embedLine("  ![[Anexos/planta baixa.PDF]]  ")).toEqual({ target: "Anexos/planta baixa.PDF", width: null });
    expect(embedLine("![[foto.png|300]]")).toEqual({ target: "foto.png", width: 300 });
    expect(embedLine("Veja ![[foto.png]] aqui")).toBeNull();
    expect(embedLine("![[Outra nota]]")).toBeNull();
    expect(embedLine("[[foto.png]]")).toBeNull();
    expect(embedLine("![[script.js]]")).toBeNull();
  });

  test("um print colado ganha nome com a hora; um arquivo de verdade fica com o nome dele", () => {
    const now = new Date(2026, 10, 4, 14, 32, 7);
    expect(pastedName("image.png", "image/png", now)).toBe("Colado 2026-11-04 14.32.07.png");
    expect(pastedName("", "image/jpeg", now)).toBe("Colado 2026-11-04 14.32.07.jpg");
    expect(pastedName("Planta da sala.pdf", "application/pdf", now)).toBe("Planta da sala.pdf");
  });

  test("só imagem e PDF de até 25 MB; o resto volta com o motivo", () => {
    const r = sortFiles([
      { name: "a.png", type: "image/png", size: 10 },
      { name: "b.txt", type: "text/plain", size: 10 },
      { name: "c.pdf", type: "application/pdf", size: 30 * 1024 * 1024 },
      { name: "image", type: "image/png", size: 10 },
    ]);
    expect(r.ok).toEqual([0, 3]);
    expect(r.refused).toEqual([
      { name: "b.txt", why: "só imagem ou PDF" },
      { name: "c.pdf", why: "maior que 25 MB" },
    ]);
  });

  test("o embed fica numa linha só dele", () => {
    const e = "![[a.png]]";
    // Numa linha vazia: entra como está.
    expect(insertionAt("um\n\ndois", 3, e)).toEqual({ insert: e, anchor: 3 + e.length });
    // No meio de um texto: quebra antes e depois.
    expect(insertionAt("um dois", 3, e)).toEqual({ insert: `\n${e}\n`, anchor: 3 + 1 + e.length });
    // No fim de uma linha: só a quebra de antes.
    expect(insertionAt("um", 2, e)).toEqual({ insert: `\n${e}`, anchor: 2 + 1 + e.length });
    // No começo do documento.
    expect(insertionAt("", 0, e)).toEqual({ insert: e, anchor: e.length });
  });
});
