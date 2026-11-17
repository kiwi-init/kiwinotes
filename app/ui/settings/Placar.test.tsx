// O placar num dia sem pedido (revisão do T14671, #14679): só a lista, sem os cartões e a barra em zero.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { AgentPlacarView } from "../../src/shared/ui-contract.ts";
import { Placar } from "./Placar.tsx";

const zero = { pedido: 0, achar: 0, ler: 0, bagagem: 0, fixo: 0 };
const ontem = { request: "r1", at: "2026-11-15T12:00:00.000Z", question: "o que tem sobre março?", tokens: 6900, idas: 5, partes: { ...zero, pedido: 900, fixo: 6000 } };

test("num dia sem pedido, só a lista; com pedido, os cartões e a barra", () => {
  const vazio: AgentPlacarView = { pedidos: 0, idas: 0, tokens: 0, partes: zero, comFaro: 0, dePrimeira: 0, ultimos: [ontem] };
  const html = renderToStaticMarkup(<Placar v={vazio} now={Date.parse("2026-11-16T12:00:00.000Z")} />);
  expect(html).not.toContain("kn-placar-cards");
  expect(html).not.toContain("kn-placar-barra");
  expect(html).not.toContain("Achar e ler");
  expect(html).toContain("o que tem sobre março?");
  const cheio = renderToStaticMarkup(<Placar v={{ ...vazio, pedidos: 1, idas: 5, tokens: 6900, partes: ontem.partes }} now={Date.parse("2026-11-16T12:00:00.000Z")} />);
  expect(cheio).toContain("kn-placar-cards");
  expect(cheio).toContain("kn-placar-barra");
});
