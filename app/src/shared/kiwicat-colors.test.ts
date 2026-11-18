// As paletas do KiwiCat novo (spec #14963): as 5 do pacote, campo a campo. Sem a regra de contraste do spec #9349,
// que saiu (harry, #15022).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CAT_PALETTES, DEFAULT_CAT_COLOR, catColorOptions, catPalette, catSwatchCss, isCatColorChoice } from "./kiwicat-colors.ts";

const PACKAGE = join(import.meta.dir, "../../../docs/design/kiwicat-v2/agente");

interface PackagePalette {
  id: string;
  name: string;
  description: string;
  prismStops: string[];
  surfaceBg: string;
  silhouetteColor: string;
  accentColor: string;
  mistColor: string;
  eyeColor: string;
  isSelected: boolean;
}

/** O `KIWI_COLOR_PALETTES` do `ByteKiwiCat.tsx`, lido como texto (o pacote importa o React, que o app não usa aqui). */
function tsxPalettes(): PackagePalette[] {
  const src = readFileSync(join(PACKAGE, "ByteKiwiCat.tsx"), "utf8");
  const start = src.indexOf("export const KIWI_COLOR_PALETTES");
  expect(start).toBeGreaterThan(-1);
  const open = src.indexOf("[", src.indexOf("=", start));
  const close = src.indexOf("\n];", open);
  return JSON.parse(src.slice(open, close + 2)) as PackagePalette[];
}

/** As mesmas paletas no `byte-kiwi-cat.tokens.json` do pacote. */
function tokenPalettes(): PackagePalette[] {
  return (JSON.parse(readFileSync(join(PACKAGE, "byte-kiwi-cat.tokens.json"), "utf8")) as { availableCatalogs: { palettes: PackagePalette[] } }).availableCatalogs.palettes;
}

const strip = ({ isSelected: _, ...rest }: PackagePalette) => rest;
/** O único nome que o app troca (harry, #17713, spec #17709): o do pacote cresce a caixa da cor. O resto, campo a campo. */
const RENAMED: Record<string, string> = { "soul-claro": "Soul Mist" };
const asApp = (p: PackagePalette) => ({ ...strip(p), name: RENAMED[p.id] ?? p.name });

describe("as paletas do KiwiCat", () => {
  test("são as 5 do pacote, na mesma ordem e campo a campo (ids, prismStops, accentColor, eyeColor e o resto)", () => {
    const tsx = tsxPalettes();
    expect(tsx.map((p) => p.id)).toEqual(["prisma-original", "kiwi-neon", "ambar-solar", "soul-claro", "nevoa-violeta"]);
    const ours: PackagePalette[] = CAT_PALETTES.map((p) => ({ ...p, prismStops: [...p.prismStops], isSelected: false }));
    expect(ours.map(strip)).toEqual(tsx.map(asApp));
    // As duas cópias do pacote concordam entre si.
    expect(tokenPalettes()).toEqual(tsx);
  });

  test("o padrão é a paleta que o pacote marca, a prisma-original", () => {
    expect(DEFAULT_CAT_COLOR).toBe("prisma-original");
    expect(tsxPalettes().find((p) => p.isSelected)?.id).toBe(DEFAULT_CAT_COLOR);
    expect(CAT_PALETTES[0].id as string).toBe(DEFAULT_CAT_COLOR);
  });

  test("só os ids das 5 passam; a escolha antiga (agente e os 7 presets) não", () => {
    for (const p of CAT_PALETTES) expect(isCatColorChoice(p.id)).toBe(true);
    for (const old of ["agente", "azul", "violeta", "verde", "rosa", "ciano", "ambar", "coral"]) expect(isCatColorChoice(old)).toBe(false);
    for (const bad of ["#ffffff", "branco", "", null, undefined, 3, "padrao", "Prisma-Original"]) expect(isCatColorChoice(bad)).toBe(false);
  });

  test("a paleta da escolha; o que não é uma das 5 cai na prisma-original", () => {
    expect(catPalette("ambar-solar").accentColor).toBe("#FB7185");
    for (const old of ["agente", "azul", undefined, null]) expect(catPalette(old).id).toBe("prisma-original");
    expect(catPalette("kiwi-neon").prismStops).toEqual(["#A3E635", "#22D3EE", "#10B981"]);
  });

  test("as amostras: as 5, na ordem do pacote, com o nome e o gradiente", () => {
    const options = catColorOptions();
    expect(options.map((o) => o.id)).toEqual(CAT_PALETTES.map((p) => p.id));
    expect(options[0]).toEqual({ id: "prisma-original", label: "Prisma Original", hex: "#F472B6", prismStops: ["#22D3EE", "#6366F1", "#EC4899"] });
    expect(catSwatchCss(options[0]!.prismStops)).toBe("linear-gradient(135deg, #22D3EE, #6366F1, #EC4899)");
  });

  test("nenhum nome passa do tamanho dos outros (spec #17709): a caixa da cor não cresce ao trocar", () => {
    const names = CAT_PALETTES.map((p) => p.name as string);
    expect(names).toEqual(["Prisma Original", "Kiwi Elétrico", "Âmbar Noturno", "Soul Mist", "Névoa Violeta"]);
    // O maior dos 5 é o "Prisma Original" (15); nenhum passa disso, nem leva os " · " e "(Ref.)" do pacote.
    for (const n of names) {
      expect(n.length, n).toBeLessThanOrEqual(15);
      expect(n, n).not.toMatch(/[·()]/);
    }
  });

  test("a frase da cor fica numa linha só, no onboarding e em Ajustes (a mesma CatColorRow)", () => {
    const row = readFileSync(join(import.meta.dir, "../../ui/settings/CatRow.tsx"), "utf8");
    expect(row).toMatch(/<Row label=\{label\} hint=\{hint\} oneLine>\s*<div className="kn-cat-color">/);
    const css = readFileSync(join(import.meta.dir, "../../ui/src/kit/kit.css"), "utf8");
    const line = css.match(/\.kn-row-hint-line\s*\{([^}]*)\}/)?.[1] ?? "";
    for (const rule of ["white-space: nowrap", "overflow: hidden", "text-overflow: ellipsis"]) expect(line).toContain(rule);
    const onboarding = readFileSync(join(import.meta.dir, "../../ui/hub/onboarding/Onboarding.tsx"), "utf8");
    expect(onboarding).toContain("<CatColorRow ");
  });
});
