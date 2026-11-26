// Ajustes › Geral › Idioma (spec #28171, T28190): "Idioma do app", Automático (a língua do macOS), Português ou English.
// Trocar salva no engine, que avisa todas as janelas (`app.localeChanged`), e esta também troca na hora.
import { useState } from "react";

import type { LanguageSetting } from "../../src/shared/i18n/index.ts";
import { api, has } from "../src/api.ts";
import { setAppLocale, useAppLocale, useT } from "../src/i18n.ts";
import { Row, Section, Segmented } from "../src/kit/index.tsx";

export function LanguageSection() {
  const { t } = useT();
  const now = useAppLocale();
  const [failed, setFailed] = useState(false);
  // Um engine de antes do 1.104.0 não tem o idioma: a seção não aparece.
  if (!has("app.locale")) return null;

  const change = (language: LanguageSetting) => {
    setFailed(false);
    api.settings
      .set({ language })
      // O evento chega a todas as janelas; a resposta garante esta, mesmo se ele se perder.
      .then(() => api.app.locale())
      .then(setAppLocale, () => setFailed(true));
  };

  const hint = failed
    ? t("common.saveFailed")
    : now.setting === "auto"
      ? `${t("settings.language.hint")} ${t("settings.language.autoNow", { language: t(`language.${now.locale}`) })}`
      : t("settings.language.hint");

  return (
    <Section title={t("settings.language.section")}>
      <Row label={t("settings.language.label")} hint={hint}>
        <Segmented
          label={t("settings.language.label")}
          value={now.setting}
          onChange={change}
          options={[
            { value: "auto", label: t("settings.language.auto") },
            { value: "pt", label: t("language.pt") },
            { value: "en", label: t("language.en") },
          ]}
        />
      </Row>
    </Section>
  );
}
