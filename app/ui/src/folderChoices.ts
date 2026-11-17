// As pastas de um seletor de pasta (spec #12918): o `<select>` do macOS monta um menu com todas as opções ao abrir, e
// com milhares de pastas ele trava para abrir. A lista fica curta: as fixas primeiro (a escolhida e a padrão), depois
// as pastas do cofre em ordem; acima do limite, só as de cima (até dois níveis, ou só o primeiro). A escolhida está
// sempre lá, mesmo funda.

/** Quantas pastas do cofre um seletor mostra, no máximo. */
export const FOLDER_CHOICES_MAX = 300;

const depth = (f: string) => f.split("/").length;

/** As opções do seletor: `fixed` (a escolhida, a padrão) e as pastas do cofre, sem ocultas e sem repetir. */
export function folderChoices(fixed: readonly (string | null | undefined)[], folders: readonly string[], max = FOLDER_CHOICES_MAX): string[] {
  const visible = folders.filter((f) => f && !f.split("/").some((s) => s.startsWith(".")));
  let pool = visible;
  if (pool.length > max) pool = pool.filter((f) => depth(f) <= 2);
  if (pool.length > max) pool = pool.filter((f) => depth(f) === 1);
  return [...new Set([...fixed.filter((f): f is string => !!f), ...pool.slice(0, max)])];
}
