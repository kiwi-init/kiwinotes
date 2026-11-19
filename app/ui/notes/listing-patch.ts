import type { ListingPatch } from "../../src/shared/ui-contract.ts";
import type { VaultListing } from "./types.ts";

/**
 * Troca um pedaço da lista pelo estado de agora que veio no `notes.changed` (spec #20118, U2, T20249): sai tudo o que
 * está em `roots` ou debaixo deles, entra o que o engine mandou. Renomear, mover, criar ou apagar uma nota ou uma pasta
 * deixa de pedir a lista inteira (eram 2,8 MB por operação num cofre de 6 mil pastas, #20154).
 *
 * É o estado, não a diferença: aplicar o mesmo pedaço duas vezes dá o mesmo, e aplicar os pedaços na ordem em que
 * chegaram, por cima de uma lista um pouco mais velha ou mais nova, acaba no estado do último.
 */
export function applyListingPatch(l: VaultListing, patch: ListingPatch): VaultListing {
  const inside = (p: string) => patch.roots.some((r) => p === r || p.startsWith(`${r}/`));
  const sameNotes = l.notes.filter((n) => !inside(n.path));
  const sameFolders = l.folders.filter((f) => !inside(f));
  const known = new Set(sameFolders);
  const folders = [...sameFolders, ...patch.folders.filter((f) => !known.has(f))].sort((a, b) => a.localeCompare(b));
  const notes = [...sameNotes, ...patch.notes].sort((a, b) => a.path.localeCompare(b.path));
  const next: VaultListing = { ...l, folders, notes };
  if (l.fileCounts) {
    const counts: Record<string, number> = {};
    for (const [f, n] of Object.entries(l.fileCounts)) if (!inside(f)) counts[f] = n;
    next.fileCounts = { ...counts, ...patch.fileCounts };
  }
  return next;
}

/**
 * A lista inteira e os pedaços que chegam enquanto ela está no ar (spec #20118, U2, T20249). O `notes.list` pode sair do
 * engine antes de um `notes.changed` que chega primeiro à janela: sem pôr esse pedaço de novo por cima, a lista voltaria
 * velha (uma nota renomeada com o nome antigo). Como o pedaço é o estado, repetir um que a lista já tinha não estraga.
 */
export class PatchedListing {
  private since: ListingPatch[] | null = null;

  /** Pede a lista inteira; os pedaços que chegarem até ela voltar vão por cima dela, na ordem em que chegaram. */
  async fetch(get: () => Promise<VaultListing | null>): Promise<VaultListing | null> {
    const since: ListingPatch[] = [];
    this.since = since;
    try {
      const fetched = await get();
      return fetched && since.reduce(applyListingPatch, fetched);
    } finally {
      if (this.since === since) this.since = null;
    }
  }

  /** Um pedaço do `notes.changed`: fica guardado para a lista no ar e vai sobre `l`. Sem lista ainda, `null`: peça uma. */
  apply(l: VaultListing | null, patch: ListingPatch): VaultListing | null {
    this.since?.push(patch);
    return l && applyListingPatch(l, patch);
  }
}
