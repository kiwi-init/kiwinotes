// Os arquivos que não são nota, atualizados pela diferença (spec #13384): num cofre com 150 mil arquivos, mudar um só
// mandava e refazia a lista inteira. A lista nova lembra de qual veio e o que mudou, para a árvore (tree.ts) refazer só
// as pastas mexidas.

import type { VaultFile } from "./types.ts";

export interface FilesDelta {
  set: VaultFile[];
  removed: string[];
}

/** De qual lista cada uma veio e os caminhos mexidos (os que entraram, mudaram ou saíram). */
const lineage = new WeakMap<readonly VaultFile[], { from: readonly VaultFile[]; touched: string[] }>();

/** A lista depois da diferença: as que saíram ou mudaram saem, e as de `set` entram no fim (a árvore ordena por pasta). */
export function applyFilesDelta(files: readonly VaultFile[], delta: FilesDelta): VaultFile[] {
  const touched = [...delta.removed, ...delta.set.map((f) => f.path)];
  const drop = new Set(touched);
  const next = files.filter((f) => !drop.has(f.path)).concat(delta.set);
  lineage.set(next, { from: files, touched });
  return next;
}

/** De qual lista `files` veio pela diferença, e o que mudou; `undefined` para uma lista que veio inteira. */
export function filesLineage(files: readonly VaultFile[]): { from: readonly VaultFile[]; touched: string[] } | undefined {
  return lineage.get(files);
}
