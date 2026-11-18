// O que o cartão do arquivo sem visualizador diz (T19316, spec #19277): o tipo e a data, em palavras.

/**
 * O tipo, pela extensão: "Arquivo ZIP", ou "Arquivo sem extensão". Como na árvore (`splitExt`), o ponto do começo
 * (`.gitignore`) não é extensão, e um nome que termina em ponto também não tem.
 */
export function typeLabel(name: string): string {
  const base = name.split("/").at(-1) ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1) : "";
  return ext ? `Arquivo ${ext.toUpperCase()}` : "Arquivo sem extensão";
}

/** A data da última mudança, em português ("18 de nov. de 2026, 14:05"); "" se a data não é válida. */
export function modified(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" });
}
