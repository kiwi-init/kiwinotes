// As paletas no gato (spec #14963, T15034): o gato lê a paleta pelo id em `inputs.cor`, e cada lugar que monta um gato
// manda o id guardado em `kiwicat.cor`, sem converter. Um hex (o contrato de antes) cai na paleta padrão sem erro, então
// um lugar que ainda mandasse o hex deixaria o gato sempre na `prisma-original`, sem nenhum aviso: este teste pega isso.
// O overlay (`cat-overlay.ts`) tem a conferência de comportamento no `src/bun/cat-overlay.test.ts`; o gato na tela, no
// `scripts/kiwicat-hub-check.ts` e no `scripts/kiwicat-overlay-check.ts`.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CAT_PALETTES } from "../../src/shared/kiwicat-colors";
import { CAT_CONFIG } from "../kiwicat-v2/cat-config";
import { catConfigFor } from "./cat";

const app = join(import.meta.dir, "../..");
const source = (path: string) => readFileSync(join(app, path), "utf8");

describe("o gato na paleta escolhida", () => {
  test("cada id desenha a paleta dele: os prismStops, o accentColor e o eyeColor; o resto é o CAT_CONFIG", () => {
    for (const p of CAT_PALETTES) {
      const c = catConfigFor(p.id);
      expect([c.prismStops, c.accentColor, c.eyeColor]).toEqual([p.prismStops, p.accentColor, p.eyeColor]);
      expect({ ...c, prismStops: CAT_CONFIG.prismStops, accentColor: CAT_CONFIG.accentColor, eyeColor: CAT_CONFIG.eyeColor }).toEqual(CAT_CONFIG);
    }
  });

  test("um hex ou um valor estranho desenha a prisma-original, que é a do CAT_CONFIG", () => {
    for (const bad of ["#A3E635", "#F472B6", "agente", "padrao", "", undefined, null]) expect(catConfigFor(bad)).toEqual(CAT_CONFIG);
  });
});

describe("os lugares que montam um gato mandam o id", () => {
  // O componente, o arquivo e o valor guardado que ele tem de receber, sem conversão.
  const hosts = [
    { name: "o gato do hub", file: "ui/hub/KiwiCat.tsx", tag: "CatMount", expected: "settings.kiwicat.cor" },
    { name: "o gato grande do onboarding", file: "ui/hub/onboarding/Onboarding.tsx", tag: "BigCat", expected: "settings.kiwicat.cor" },
    { name: "a prévia de Ajustes", file: "ui/settings/CatRow.tsx", tag: "CatPreview", expected: "cat.cor" },
  ];
  for (const h of hosts) {
    test(`${h.name} (<${h.tag}>)`, () => {
      const uses = [...source(h.file).matchAll(new RegExp(`<${h.tag}\\b[^>]*\\bcor=\\{([^}]*)\\}`, "g"))].map((m) => m[1]!.trim());
      expect(uses.length).toBeGreaterThan(0);
      for (const cor of uses) expect(cor).toBe(h.expected);
    });
  }

  test("o overlay manda o id ao helper, nas duas vezes que lê as settings", () => {
    const uses = [...source("src/bun/cat-overlay.ts").matchAll(/overlay\.setColor\(([^)]*)\)/g)].map((m) => m[1]!.trim());
    expect(uses).toEqual(["s.kiwicat.cor", "s.kiwicat.cor"]);
  });

  test("o balão: a borda e a sombra leem o --kn-cat-accent, que o hub e o overlay põem com o accentColor da paleta", () => {
    expect(source("ui/kiwicat-v2/bubble.css")).toContain("--kn-bubble-accent: var(--kn-cat-accent, #f472b6);");
    expect(source("ui/hub/KiwiCat.tsx")).toContain('setProperty("--kn-cat-accent", catPalette(cor).accentColor)');
    expect(source("ui/catoverlay/main.ts")).toContain('setProperty("--kn-cat-accent", catPalette(colour).accentColor)');
  });

  test("a página do overlay só aceita um dos 5 ids, ao carregar e ao trocar", () => {
    const page = source("ui/catoverlay/main.ts");
    expect(page).toContain('isCatColorChoice(query.get("cor"))');
    expect(page).toContain("isCatColorChoice(input.cor)");
  });
});
