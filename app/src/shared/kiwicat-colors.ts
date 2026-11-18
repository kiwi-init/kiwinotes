// As paletas do KiwiCat novo (spec #14963): as 5 do pacote, `KIWI_COLOR_PALETTES` em
// `docs/design/kiwicat-v2/agente/ByteKiwiCat.tsx`, copiadas campo a campo. Nenhuma cor é inventada nem ajustada no olho,
// e não há regra de contraste (harry, #15022): a `soul-claro` fica, mesmo sumindo no tema escuro e no overlay.
//
// Os campos que o app lê: a névoa e o anel usam os `prismStops`, os detalhes do gato e a borda do balão o `accentColor`,
// e os olhos o `eyeColor`. O `surfaceBg` não é desenhado (o gato fica transparente sobre o tema, o `uiFrame: "livre"`
// do pacote), e o `mistColor` e o `silhouetteColor` não entram no desenho; ficam aqui só para a lista bater com o pacote.
//
// Este é o lugar único das paletas: a tela, o gato e o balão leem daqui.

export interface CatPalette {
  id: string;
  /** O nome do pacote, o que a tela mostra. */
  name: string;
  description: string;
  prismStops: readonly [string, string, string];
  surfaceBg: string;
  silhouetteColor: string;
  accentColor: string;
  mistColor: string;
  eyeColor: string;
}

/** As 5 paletas, na ordem do pacote. A primeira é o padrão. */
export const CAT_PALETTES = [
  {
    id: "prisma-original",
    name: "Prisma Original",
    description: "Ciano, índigo e magenta suaves na névoa atrás da silhueta escura",
    prismStops: ["#22D3EE", "#6366F1", "#EC4899"],
    surfaceBg: "#090A0E",
    silhouetteColor: "#050507",
    accentColor: "#F472B6",
    mistColor: "#D4D8E4",
    eyeColor: "#FFFFFF",
  },
  {
    id: "kiwi-neon",
    name: "Kiwi Elétrico",
    description: "Chassi obsidiana com destaque verde-lima e aura ciano-esmeralda",
    prismStops: ["#A3E635", "#22D3EE", "#10B981"],
    surfaceBg: "#080B09",
    silhouetteColor: "#050705",
    accentColor: "#A3E635",
    mistColor: "#D9F99D",
    eyeColor: "#FFFFFF",
  },
  {
    id: "ambar-solar",
    name: "Âmbar Noturno",
    description: "Calor coral e dourado para alertas de limite e foco calmo",
    prismStops: ["#FBBF24", "#F97316", "#FB7185"],
    surfaceBg: "#0C0908",
    silhouetteColor: "#070505",
    accentColor: "#FB7185",
    mistColor: "#FED7AA",
    eyeColor: "#FFFFFF",
  },
  {
    id: "soul-claro",
    name: "Soul Mist",
    description: "Fundo branco fiel ao vídeo MP4 com tinta escura e fita ciano-azul-magenta",
    prismStops: ["#22D3EE", "#3B82F6", "#EC4899"],
    surfaceBg: "#FFFFFF",
    silhouetteColor: "#050507",
    accentColor: "#EC4899",
    mistColor: "#050507",
    eyeColor: "#FFFFFF",
  },
  {
    id: "nevoa-violeta",
    name: "Névoa Violeta",
    description: "Atmosfera noturna roxo-azulada com contorno luminescente",
    prismStops: ["#38BDF8", "#A855F7", "#F472B6"],
    surfaceBg: "#090810",
    silhouetteColor: "#06050A",
    accentColor: "#C084FC",
    mistColor: "#DDD6FE",
    eyeColor: "#FFFFFF",
  },
] as const satisfies readonly CatPalette[];

/** A escolha guardada em `kiwicat.cor`: o id de uma das 5 paletas. */
export type CatColorChoice = (typeof CAT_PALETTES)[number]["id"];

export const DEFAULT_CAT_COLOR: CatColorChoice = "prisma-original";

/**
 * Só os ids das 5 paletas. Uma escolha antiga (`agente` ou um dos 7 presets do spec #9349) não passa, e o `normalize`
 * das settings a troca pelo padrão.
 */
export function isCatColorChoice(value: unknown): value is CatColorChoice {
  return CAT_PALETTES.some((p) => p.id === value);
}

/** A paleta da escolha guardada; qualquer outra coisa cai na `prisma-original`. */
export function catPalette(choice: unknown): (typeof CAT_PALETTES)[number] {
  return CAT_PALETTES.find((p) => p.id === choice) ?? CAT_PALETTES[0];
}

export interface CatColorOption {
  id: CatColorChoice;
  label: string;
  hex: string;
  prismStops: readonly [string, string, string];
}

/** As amostras de Ajustes e do onboarding, na ordem do pacote. */
export function catColorOptions(): CatColorOption[] {
  return CAT_PALETTES.map((p) => ({ id: p.id, label: p.name, hex: p.accentColor, prismStops: p.prismStops }));
}

/** A amostra de uma paleta em Ajustes e no onboarding: o gradiente dos 3 `prismStops`, na diagonal. */
export function catSwatchCss(prismStops: readonly [string, string, string]): string {
  return `linear-gradient(135deg, ${prismStops.join(", ")})`;
}
