// A cor da névoa do Kiwi-cat (spec #9349). O gato é sempre preto, nos dois temas; a névoa tem a cor do agente, ou uma
// das cores prontas de Ajustes › Agente. Nada de branco e nada de cor livre: toda cor da lista aparece no fundo preto e
// no branco (contraste de pelo menos 2:1 contra os dois, conferido no `kiwicat-colors.test.ts`).
//
// Este é o lugar único das cores: a de cada agente e a lista. Um agente novo ganha a dele aqui, sem mexer na tela.

/** A cor de cada agente, pelo nome do agente. Hoje, só o Claude Code. */
export const AGENT_CAT_COLORS = {
  claude: "#ff9b5e",
} as const satisfies Record<string, string>;

export type CatAgent = keyof typeof AGENT_CAT_COLORS;

/** O agente que o Kiwi liga hoje. */
export const CURRENT_CAT_AGENT: CatAgent = "claude";

/** As cores prontas, além da do agente. */
export const CAT_COLOR_PRESETS = [
  { id: "azul", label: "Azul", hex: "#6ea8ff" },
  { id: "violeta", label: "Violeta", hex: "#a98bff" },
  { id: "verde", label: "Verde", hex: "#3cc47c" },
  { id: "rosa", label: "Rosa", hex: "#ff86bf" },
  { id: "ciano", label: "Ciano", hex: "#27bfd0" },
  { id: "ambar", label: "Âmbar", hex: "#e8a030" },
  { id: "coral", label: "Coral", hex: "#ff7a6b" },
] as const;

/** A escolha guardada: a do agente (o padrão) ou uma das prontas. */
export type CatColorChoice = "agente" | (typeof CAT_COLOR_PRESETS)[number]["id"];

export const DEFAULT_CAT_COLOR: CatColorChoice = "agente";

export interface CatColorOption {
  id: CatColorChoice;
  label: string;
  hex: string;
}

/** As amostras de Ajustes, na ordem da tela: a do agente primeiro. */
export function catColorOptions(agent: CatAgent = CURRENT_CAT_AGENT): CatColorOption[] {
  return [{ id: "agente", label: "A do agente", hex: AGENT_CAT_COLORS[agent] }, ...CAT_COLOR_PRESETS];
}

export function isCatColorChoice(value: unknown): value is CatColorChoice {
  return value === "agente" || CAT_COLOR_PRESETS.some((c) => c.id === value);
}

/** A cor que o desenho recebe (a entrada `cor` do módulo) para a escolha guardada. */
export function catColorHex(choice: CatColorChoice | undefined, agent: CatAgent = CURRENT_CAT_AGENT): string {
  return CAT_COLOR_PRESETS.find((c) => c.id === choice)?.hex ?? AGENT_CAT_COLORS[agent];
}

/** A luminância relativa do WCAG de uma cor `#rrggbb`. */
export function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** O contraste do WCAG entre duas cores `#rrggbb` (de 1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
