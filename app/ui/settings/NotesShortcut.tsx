// O atalho global que abre a janela Notas (T1499). Quem vê a tecla é o helper; aqui só se escolhe a combinação.
import { useEffect, useState } from "react";

import { NOTES_SHORTCUTS, type NotesShortcut } from "../../src/shared/shortcuts.ts";
import { api, has } from "../src/api.ts";
import { Row, Segmented } from "../src/kit/index.tsx";

type Choice = NotesShortcut | "off";

export const SHORTCUT_OPTIONS: { value: Choice; label: string }[] = [
  ...NOTES_SHORTCUTS.map((s) => ({ value: s.value as Choice, label: s.label })),
  { value: "off", label: "Desligado" },
];

export function NotesShortcutRow() {
  const [value, setValue] = useState<Choice | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!has("settings.get")) return;
    api.settings.get().then(
      (s) => setValue(s.notesShortcut ?? "off"),
      () => setFailed(true),
    );
  }, []);

  // Um engine antigo, sem `settings.*`: a linha não aparece.
  if (!has("settings.set") || (value === null && !failed)) return null;

  const change = (next: Choice) => {
    const before = value;
    setValue(next);
    setFailed(false);
    api.settings.set({ notesShortcut: next === "off" ? null : next }).then(
      (s) => setValue(s.notesShortcut ?? "off"),
      () => {
        setValue(before);
        setFailed(true);
      },
    );
  };

  return (
    <Row
      label="Abrir as notas"
      hint={failed ? "Não deu para salvar o atalho. Tente de novo." : "De qualquer app, abre as Notas do Kiwi."}
    >
      <Segmented label="Atalho das notas" value={value ?? "off"} onChange={change} options={SHORTCUT_OPTIONS} />
    </Row>
  );
}
