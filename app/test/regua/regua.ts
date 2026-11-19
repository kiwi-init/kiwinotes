// A régua dos arquivos (spec #21156, T21236): lê a tabela tipo × item de `docs/specs/regua-dos-arquivos.md` e julga
// cada conferência contra o que a tabela diz. Um "cumpre" que quebra falha; um "falta" que passa também falha, pedindo
// a troca na tabela, para ela não mentir. As conferências estão em `conferir.ts`.

import { CODE_TYPES, MEDIA_TYPES } from "../../src/shared/file-view.ts";

/** Os 12 itens da régua, na ordem da tabela. */
export const ITENS = [
  "Abre rápido",
  "Arquivo grande",
  "Buscar dentro",
  "Busca do app",
  "Editar",
  "Gravar não estraga",
  "Histórico",
  "O gato lê",
  "O gato edita",
  "Recusa em vez de arriscar",
  "Tudo local",
  "Trackpad",
] as const;

export type Estado =
  | { kind: "cumpre" }
  /** `ref` é o spec do Kiwi ("spec #21065") ou a issue do GitHub ("issue #156") que fecha a falta. */
  | { kind: "falta"; ref: string }
  | { kind: "na"; motivo: string }
  | { kind: "fora" };

export interface Linha {
  tipo: string;
  exts: string[];
  /** Um por item, na ordem de `ITENS`. */
  estados: Estado[];
}

/** As listas que a tabela pode citar pelo nome, em vez de repetir cada extensão. */
const LISTAS: Record<string, readonly string[]> = { CODE_TYPES, MEDIA_TYPES };

/** Uma célula: `cumpre`, `falta spec #N` ou `falta issue #N` (o que fecha), `n/a: motivo` ou `abre fora`. */
export function lerEstado(celula: string): Estado {
  const c = celula.trim();
  if (c === "cumpre") return { kind: "cumpre" };
  if (c === "abre fora") return { kind: "fora" };
  const falta = /^falta\s+((?:spec|issue) #\d+)$/.exec(c);
  if (falta) return { kind: "falta", ref: falta[1]! };
  const na = /^n\/a:\s*(\S.*)$/.exec(c);
  if (na) return { kind: "na", motivo: na[1]! };
  throw new Error(`célula da régua inválida: "${c}" (use cumpre, falta spec #N, falta issue #N, n/a: motivo ou abre fora)`);
}

/** A tabela, entre `<!-- regua:inicio -->` e `<!-- regua:fim -->`. */
export function lerRegua(md: string): Linha[] {
  const ini = md.indexOf("<!-- regua:inicio -->");
  const fim = md.indexOf("<!-- regua:fim -->");
  if (ini < 0 || fim < ini) throw new Error("a régua não tem os marcadores regua:inicio e regua:fim");
  const linhas = md
    .slice(ini, fim)
    .split("\n")
    .filter((l) => l.trim().startsWith("|"))
    .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  const [cabeca, sep, ...corpo] = linhas;
  if (!cabeca || !sep || cabeca.length !== ITENS.length + 2) throw new Error(`a tabela da régua precisa de ${ITENS.length + 2} colunas`);
  return corpo.map((cel) => {
    if (cel.length !== ITENS.length + 2) throw new Error(`linha "${cel[0]}": ${cel.length} colunas, e não ${ITENS.length + 2}`);
    const exts = [...cel[1]!.matchAll(/`([^`]+)`/g)].flatMap((m) => LISTAS[m[1]!] ?? [m[1]!]);
    if (!exts.length) throw new Error(`linha "${cel[0]}": sem extensão`);
    return { tipo: cel[0]!.replace(/\*/g, ""), exts, estados: cel.slice(2).map(lerEstado) };
  });
}

/** As extensões de `tipos` que nenhuma linha da régua tem (um tipo novo sem linha quebra o teste). */
export function semLinha(regua: readonly Linha[], tipos: readonly string[]): string[] {
  const tem = new Set(regua.flatMap((l) => l.exts));
  return tipos.filter((t) => !tem.has(t));
}

/** As extensões que estão em mais de uma linha. */
export function repetidas(regua: readonly Linha[]): string[] {
  const vistas = new Set<string>();
  const rep = new Set<string>();
  for (const e of regua.flatMap((l) => l.exts)) (vistas.has(e) ? rep : vistas).add(e);
  return [...rep];
}

/**
 * O veredito de uma conferência contra a tabela: null quando bate. `erro` é o motivo da conferência que não passou.
 * - cumpre e passou, falta e não passou: bate.
 * - cumpre e não passou: quebrou.
 * - falta e passou: a tabela está velha, e o item tem de virar "cumpre".
 */
export function julgar(linha: string, item: number, estado: Estado, erro: string | null): string | null {
  const nome = `${linha} › ${item + 1}. ${ITENS[item]}`;
  if (estado.kind === "cumpre") return erro === null ? null : `${nome}: a régua diz "cumpre", e quebrou: ${erro}`;
  if (estado.kind === "falta") {
    return erro === null ? `${nome}: a régua diz "falta ${estado.ref}", e passou. Troque para "cumpre" na tabela (docs/specs/regua-dos-arquivos.md).` : null;
  }
  return null;
}
