// Configurações › Aparência (T2503, spec #2457 ponto 4): a mesma tela do Channels. Modo, Tamanho do texto, Fonte,
// Movimento e os 44 temas, um para o lado escuro e um para o claro. Troca na hora em todas as janelas. Desde o spec
// #31754 (T31766), em duas abas: Tema (o modo e os temas) e Texto (o tamanho, a fonte e o movimento).
import "./appearance.css";

import { useMemo, useState } from "react";

import type { Appearance, AppearanceFont, AppearanceMode, Motion, TextSize } from "../../src/shared/appearance.ts";
import { fold } from "../notes/palette.ts";
import { useT } from "../src/i18n.ts";
import { Row, Section, Segmented } from "../src/kit/index.tsx";
import { useAppearance } from "../src/styles/appearance.ts";
import { type ColorTheme, type ThemeAppearance, THEMES } from "../src/styles/themes.ts";
import type { TextKey } from "../../src/shared/i18n/index.ts";
import { NO_TEXT_ASSIST } from "../src/textAssist.ts";

const SIDES: { side: ThemeAppearance; titleKey: TextKey }[] = [
  { side: "dark", titleKey: "appearance.themes.dark" },
  { side: "light", titleKey: "appearance.themes.light" },
];

function ThemeTile({ theme, chosen, onPick }: { theme: ColorTheme; chosen: boolean; onPick: () => void }) {
  const c = theme.colors;
  return (
    <button type="button" className="kn-theme" aria-pressed={chosen} onClick={onPick} title={theme.name}>
      <span className="kn-theme-preview" style={{ background: c.bg, borderColor: c["line-2"] }} aria-hidden="true">
        <i style={{ background: c.ink, width: "62%" }} />
        <i style={{ background: c["ink-3"], width: "84%" }} />
        <i style={{ background: c["ink-3"], width: "46%" }} />
        <b style={{ background: c.accent }} />
      </span>
      <span className="kn-theme-name">{theme.name}</span>
    </button>
  );
}

/** Grava uma mudança da Aparência; se falhar, a seção mostra o erro. */
function useChange() {
  const { t: tr } = useT();
  const [a, set] = useAppearance();
  const [error, setError] = useState<string | null>(null);
  const change = (patch: Partial<Appearance>) => {
    setError(null);
    set(patch).catch(() => setError(tr("appearance.saveFailed")));
  };
  return { a, change, error };
}

/** A aba Tema (T31766): o modo e os temas. */
export function AppearanceSection() {
  const { t: tr } = useT();
  const { a, change, error } = useChange();
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = fold(query.trim());
    return q ? THEMES.filter((t) => fold(t.name).includes(q)) : THEMES;
  }, [query]);

  // Escolher um tema do outro lado com o modo fixo troca o modo junto: senão nada mudaria na tela.
  const pick = (t: ColorTheme) => {
    const patch: Partial<Appearance> = t.appearance === "dark" ? { darkTheme: t.id } : { lightTheme: t.id };
    if (a.mode !== "system" && a.mode !== t.appearance) patch.mode = t.appearance;
    change(patch);
  };

  return (
    <Section title={tr("appearance.section")}>
      <Row label={tr("appearance.mode")} hint={tr("appearance.mode.hint")}>
        <Segmented<AppearanceMode>
          label={tr("appearance.mode")}
          value={a.mode}
          onChange={(mode) => change({ mode })}
          options={[
            { value: "system", label: tr("appearance.mode.system") },
            { value: "dark", label: tr("appearance.mode.dark") },
            { value: "light", label: tr("appearance.mode.light") },
          ]}
        />
      </Row>
      <div className="kn-themes">
        <div className="kn-themes-head">
          <span className="kn-themes-title">{tr("appearance.themes")}</span>
          <input
            id="kn-theme-search"
            className="kn-themes-search"
            type="search"
            {...NO_TEXT_ASSIST}
            placeholder={tr("appearance.themes.search")}
            aria-label={tr("appearance.themes.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {error ? (
          <p className="kn-themes-error" role="alert">
            {error}
          </p>
        ) : null}
        {SIDES.map(({ side, titleKey }) => {
          const list = shown.filter((t) => t.appearance === side);
          if (!list.length) return null;
          const chosen = side === "dark" ? a.darkTheme : a.lightTheme;
          return (
            <div key={side} className="kn-themes-group">
              <div className="kn-themes-sub">
                {tr(titleKey)} {list.length}
              </div>
              <div className="kn-themes-grid">
                {list.map((t) => (
                  <ThemeTile key={t.id} theme={t} chosen={t.id === chosen} onPick={() => pick(t)} />
                ))}
              </div>
            </div>
          );
        })}
        {shown.length === 0 ? <p className="kn-themes-empty">{tr("appearance.themes.none")}</p> : null}
      </div>
    </Section>
  );
}

/** A aba Texto (T31766): o tamanho do texto, a fonte e o movimento, as mesmas linhas de antes. */
export function AppearanceTextSection() {
  const { t: tr } = useT();
  const { a, change, error } = useChange();
  return (
    <Section title={tr("settings.tab.text")}>
      <Row label={tr("appearance.textSize")}>
        <Segmented<TextSize>
          label={tr("appearance.textSize")}
          value={a.textSize}
          onChange={(textSize) => change({ textSize })}
          options={[
            { value: "small", label: tr("appearance.textSize.small") },
            { value: "default", label: tr("appearance.textSize.default") },
            { value: "large", label: tr("appearance.textSize.large") },
            { value: "larger", label: tr("appearance.textSize.larger") },
            { value: "largest", label: tr("appearance.textSize.largest") },
          ]}
        />
      </Row>
      <Row label={tr("appearance.font")}>
        <Segmented<AppearanceFont>
          label={tr("appearance.font")}
          value={a.font}
          onChange={(font) => change({ font })}
          options={[
            { value: "system", label: tr("appearance.font.system") },
            { value: "inter", label: "Inter" }, // i18n-ok: o nome da fonte
            { value: "lato", label: "Lato" }, // i18n-ok: o nome da fonte
            { value: "atkinson", label: "Atkinson" }, // i18n-ok: o nome da fonte
          ]}
        />
      </Row>
      <Row label={tr("appearance.motion")} hint={tr("appearance.motion.hint")}>
        <Segmented<Motion>
          label={tr("appearance.motion")}
          value={a.motion}
          onChange={(motion) => change({ motion })}
          options={[
            { value: "full", label: tr("appearance.motion.full") },
            { value: "reduced", label: tr("appearance.motion.reduced") },
          ]}
        />
      </Row>
      {error ? (
        <p className="kn-themes-error" role="alert">
          {error}
        </p>
      ) : null}
    </Section>
  );
}
