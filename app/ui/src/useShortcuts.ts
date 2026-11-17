// Os atalhos do engine (T5349), sempre os de agora: outra janela pode mudar. Usado pelas Configurações e pelas Notas
// (a paleta, a nota nova e a do dia valem o que a pessoa escolheu).
import { useEffect, useState } from "react";

import type { Shortcuts } from "../../src/shared/shortcuts.ts";
import { api, has } from "./api.ts";

/** Null antes de ler, ou num engine de antes do T5349. */
export function useShortcuts(): Shortcuts | null {
  const [shortcuts, setShortcuts] = useState<Shortcuts | null>(null);
  useEffect(() => {
    if (!has("settings.get")) return;
    api.settings.get().then((s) => s.shortcuts && setShortcuts(s.shortcuts), () => {});
    return api.settings.onChanged((s) => s.shortcuts && setShortcuts(s.shortcuts));
  }, []);
  return shortcuts;
}
