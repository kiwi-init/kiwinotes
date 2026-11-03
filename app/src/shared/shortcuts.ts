// O atalho global que abre a janela Notas (T1499). Quem vê a tecla é o helper (o tap do Monitoramento de Entrada, que
// já existe para o ditado), e não o app: assim não há permissão nova a pedir. O formato é o do `config.set
// {notesShortcut}` (ADR 0001): os modificadores e uma letra, com `+`.

/** As combinações que as Configurações oferecem. Nenhuma faz nada nos apps comuns do Mac. */
export const NOTES_SHORTCUTS = [
  { value: "control+option+n", label: "⌃⌥N" },
  { value: "control+command+n", label: "⌃⌘N" },
  { value: "option+command+n", label: "⌥⌘N" },
] as const;

export type NotesShortcut = (typeof NOTES_SHORTCUTS)[number]["value"];

export const DEFAULT_NOTES_SHORTCUT: NotesShortcut = "control+option+n";

/** Uma das combinações oferecidas, ou null (desligado). Qualquer outra coisa não é um atalho. */
export function isNotesShortcut(value: unknown): value is NotesShortcut | null {
  return value === null || NOTES_SHORTCUTS.some((s) => s.value === value);
}
