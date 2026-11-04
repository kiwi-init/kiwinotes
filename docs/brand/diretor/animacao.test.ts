import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { aplicar, escreverItem, lerItem, mesmaCurva, pontos, regras, tempo } from "./animacao.ts";

const SVG = readFileSync(path.join(import.meta.dir, "../kiwi-cat-familia/kiwi-cat-1-aura-intro.svg"), "utf8");

describe("ler o animation: (T3065)", () => {
  test("um item no formato do arquivo", () => {
    expect(lerItem("earPopL 1.3s cubic-bezier(.34,1.56,.64,1) 2.0s both")).toMatchObject({
      nome: "earPopL",
      duracao: 1.3,
      atraso: 2,
      curva: "cubic-bezier(.34,1.56,.64,1)",
    });
    expect(lerItem("blink 4.6s ease-in-out 9s infinite")).toMatchObject({ nome: "blink", duracao: 4.6, atraso: 9, curva: "ease-in-out" });
    // Sem atraso nem curva escritos: o padrão do CSS.
    expect(lerItem("fadeIn 900ms")).toMatchObject({ nome: "fadeIn", duracao: 0.9, atraso: 0, curva: "ease" });
  });

  test("as regras do Kiwi-cat Aura, sem as da @media e sem os @keyframes", () => {
    const rs = regras(SVG);
    const nomes = rs.flatMap((r) => r.itens.map((i) => `${r.seletor} ${i.nome}`));
    expect(nomes).toContain("#ear-left-pop earPopL");
    expect(nomes).toContain("#eye-left,#eye-right blink");
    expect(nomes).toContain(".eye-halo haloFlash");
    expect(nomes).toContain("#intro-circle circleOut");
    // O "reduzir movimento" (animation: none) fica de fora.
    expect(rs.some((r) => r.itens.some((i) => i.nome === "none"))).toBe(false);
    expect(nomes.length).toBe(19);
  });

  test("o texto da regra está onde ela diz", () => {
    for (const r of regras(SVG)) expect(SVG.slice(r.inicio, r.fim)).toBe(r.itens.map((i) => i.partes.join(" ")).join(", "));
  });
});

describe("escrever (T3065)", () => {
  test("só os pedaços que mudaram", () => {
    const item = lerItem("earPopL 1.3s cubic-bezier(.34,1.56,.64,1) 2.0s both");
    expect(escreverItem(item, { atraso: 2.3 })).toBe("earPopL 1.3s cubic-bezier(.34,1.56,.64,1) 2.3s both");
    expect(escreverItem(item, { duracao: 0.9, curva: "cubic-bezier(.2,1.8,.4,1)" })).toBe("earPopL .9s cubic-bezier(.2,1.8,.4,1) 2.0s both");
    // O mesmo valor não reescreve (o 2.0s fica 2.0s).
    expect(escreverItem(item, { atraso: 2, curva: "cubic-bezier(.34, 1.56, .64, 1)" })).toBe("earPopL 1.3s cubic-bezier(.34,1.56,.64,1) 2.0s both");
  });

  test("atraso e curva que não estavam escritos entram no lugar de costume", () => {
    const item = lerItem("circleIn .9s both");
    expect(escreverItem(item, { atraso: 0.4 })).toBe("circleIn .9s .4s both");
    expect(escreverItem(item, { curva: "ease-out" })).toBe("circleIn .9s ease-out both");
    expect(escreverItem(lerItem("circleIn .9s cubic-bezier(.2,.8,.2,1) both"), { atraso: 0.4 })).toBe("circleIn .9s cubic-bezier(.2,.8,.2,1) .4s both");
  });

  test("tempo e curva no estilo do arquivo", () => {
    expect(tempo(0.9)).toBe(".9s");
    expect(tempo(2.30000001)).toBe("2.3s");
    expect(pontos("ease")).toEqual([0.25, 0.1, 0.25, 1]);
    expect(pontos("steps(4)")).toBeNull();
    expect(mesmaCurva("ease", "cubic-bezier(.25,.1,.25,1)")).toBe(true);
  });
});

describe("aplicar no SVG (T3065)", () => {
  test("a mudança de exemplo: a orelha esquerda entra 0,3 s depois", () => {
    const r = aplicar(SVG, [{ seletor: "#ear-left-pop", animacao: "earPopL", atraso: 2.3, de: { duracao: 1.3, atraso: 2, curva: "cubic-bezier(.34,1.56,.64,1)" } }]);
    expect(r.recusadas).toEqual([]);
    expect(r.svg).toContain("#ear-left-pop { animation: earPopL 1.3s cubic-bezier(.34,1.56,.64,1) 2.3s both; }");
    // Nada mais muda: só aqueles 4 caracteres.
    expect(r.svg.length).toBe(SVG.length);
    expect([...r.svg].filter((c, i) => c !== SVG[i]).length).toBe(1);
  });

  test("a regra com duas animações muda só a pedida", () => {
    const r = aplicar(SVG, [{ seletor: "#aura-orbit", animacao: "breathe", duracao: 5 }]);
    expect(r.svg).toContain("animation: settle 2.2s cubic-bezier(.2,.7,.2,1) 3.7s both, breathe 5s ease-in-out 7.5s infinite;");
  });

  test("o seletor com vírgula casa como o CSSOM escreve", () => {
    const r = aplicar(SVG, [{ seletor: "#eye-left, #eye-right", animacao: "blink", atraso: 8 }]);
    expect(r.aplicadas.length).toBe(1);
    expect(r.svg).toContain("animation: blink 4.6s ease-in-out 8s infinite;");
  });

  test("recusa, sem mexer, o que não existe e o que mudou desde a marcação", () => {
    const r = aplicar(SVG, [
      { seletor: "#orelha", animacao: "earPopL", atraso: 1 },
      { seletor: "#ear-left-pop", animacao: "earPopL", atraso: 3, de: { duracao: 1.3, atraso: 1.5, curva: "ease" } },
    ]);
    expect(r.svg).toBe(SVG);
    expect(r.recusadas.map((x) => x.motivo)).toEqual([
      "não achei a animação earPopL em #orelha",
      "o arquivo mudou desde a marcação (era 1.3s ease 1.5s, agora 1.3s cubic-bezier(.34,1.56,.64,1) 2s)",
    ]);
    // Com --forcar, entra.
    expect(aplicar(SVG, r.recusadas.slice(1).map((x) => x.mudanca), true).aplicadas.length).toBe(1);
  });
});
