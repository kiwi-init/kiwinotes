import { describe, expect, test } from "bun:test";

import { canvasName, noteSection } from "./names.ts";

describe("o quadro branco: nome e trecho de nota (T6600)", () => {
  test("o nome é o arquivo sem a pasta e sem .canvas", () => {
    expect(canvasName("Projetos/Mudança 2026.canvas")).toBe("Mudança 2026");
    expect(canvasName("Quadro.CANVAS")).toBe("Quadro");
  });

  const body = "# Plano\n\nIntro\n\n## Etapas\n\n1. Um\n\n### Detalhe\n\nfundo\n\n## Depois\n\nfim\n";

  test("sem subpath, a nota inteira", () => {
    expect(noteSection(body, undefined)).toBe(body);
    expect(noteSection(body, "")).toBe(body);
  });

  test("#título: a seção até o próximo título do mesmo nível ou acima, com os de baixo dentro", () => {
    expect(noteSection(body, "#Etapas")).toBe("## Etapas\n\n1. Um\n\n### Detalhe\n\nfundo\n");
    expect(noteSection(body, "#detalhe")).toBe("### Detalhe\n\nfundo\n");
    expect(noteSection(body, "#Depois")).toBe("## Depois\n\nfim\n");
  });

  test("um título que não existe ou um ^bloco: a nota inteira, sem sumir nada", () => {
    expect(noteSection(body, "#Não existe")).toBe(body);
    expect(noteSection(body, "#^abc123")).toBe(body);
  });
});
