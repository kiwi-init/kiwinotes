// Os sons de início e de fim do ditado e da reunião (T5833, issue 213). Ligados por padrão.
import { useEffect, useState } from "react";

import { api, has } from "../src/api.ts";
import { Row, Switch } from "../src/kit/index.tsx";

export function CuesRow() {
  const [on, setOn] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!has("settings.get")) return;
    api.settings.get().then(
      // Um engine de antes do 1.32.0 não manda `cues`: a linha não aparece.
      (s) => setOn(typeof s.cues === "boolean" ? s.cues : null),
      () => setFailed(true),
    );
  }, []);

  if (on === null) return null;

  const change = (next: boolean) => {
    setOn(next);
    setFailed(false);
    api.settings.set({ cues: next }).then(
      (s) => setOn(s.cues),
      () => {
        setOn(!next);
        setFailed(true);
      },
    );
  };

  return (
    <Row label="Som ao começar e terminar" hint={failed ? "Não deu para salvar. Tente de novo." : "Um som curto quando o ditado ou a reunião começa e termina."}>
      <Switch label="Som ao começar e terminar" checked={on} onChange={change} />
    </Row>
  );
}
