// "Mostrar extensão dos arquivos" (T3370, spec #3272): a árvore das Notas mostra `.md`, `.pdf`, `.png` depois do nome.
// Desligado por padrão; o ícone de cada item já diz o tipo.
import { useEffect, useState } from "react";

import { api, has } from "../src/api.ts";
import { useT } from "../src/i18n.ts";
import { Row, Switch } from "../src/kit/index.tsx";

export function ExtensionsRow() {
  const { t } = useT();
  const [on, setOn] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!has("settings.get")) return;
    api.settings.get().then(
      // Um engine de antes do 1.19.0 não manda `showExtensions`: a linha não aparece.
      (s) => setOn(typeof s.showExtensions === "boolean" ? s.showExtensions : null),
      () => setFailed(true),
    );
  }, []);

  if (on === null) return null;

  const change = (next: boolean) => {
    setOn(next);
    setFailed(false);
    api.settings.set({ showExtensions: next }).then(
      (s) => setOn(s.showExtensions),
      () => {
        setOn(!next);
        setFailed(true);
      },
    );
  };

  return (
    <Row label={t("extensions.label")} hint={failed ? t("common.saveFailed") : t("extensions.hint")}>
      <Switch label={t("extensions.label")} checked={on} onChange={change} />
    </Row>
  );
}
