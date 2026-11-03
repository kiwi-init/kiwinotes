// Comparação de texto sem acento e sem maiúscula, para busca e para os gatilhos dos snippets.

/** "Ação É" → "acao e". Um caractere vira um caractere quase sempre; `foldWithMap` cobre o resto. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}+/gu, "").toLocaleLowerCase("pt-BR");
}

/**
 * Dobra caractere por caractere e guarda de onde veio cada um, para achar um trecho no
 * texto dobrado e substituir no original.
 */
export function foldWithMap(s: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) map.push(i);
    folded += f;
    i += ch.length;
  }
  map.push(s.length);
  return { folded, map };
}

/** Para comparar gatilhos: sem acento, hífen vira espaço, espaços juntos. */
export function normalizePhrase(s: string): string {
  return fold(s).replace(/[-‐–—_]+/g, " ").replace(/[^\p{L}\p{N}@.\s]/gu, "").replace(/\s+/g, " ").trim();
}
