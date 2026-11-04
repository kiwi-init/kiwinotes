// Configurações › Aparência (T2503, spec #2457 ponto 4): a mesma tela do Channels. Modo, Tamanho do texto, Fonte,
// Movimento e os 44 temas, um para o lado escuro e um para o claro. Troca na hora em todas as janelas.
import "./appearance.css";

import { useMemo, useState } from "react";

import type { Appearance, AppearanceFont, AppearanceMode, Motion, TextSize } from "../../src/shared/appearance.ts";
import { fold } from "../notes/palette.ts";
import { Row, Section, Segmented } from "../src/kit/index.tsx";
import { useAppearance } from "../src/styles/appearance.ts";
import { type ColorTheme, type ThemeAppearance, THEMES } from "../src/styles/themes.ts";
import { NO_TEXT_ASSIST } from "../src/textAssist.ts";

const SIDES: { side: ThemeAppearance; title: string }[] = [
  { side: "dark", title: "Escuros" },
  { side: "light", title: "Claros" },
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

export function AppearanceSection() {
  const [a, set] = useAppearance();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const change = (patch: Partial<Appearance>) => {
    setError(null);
    set(patch).catch(() => setError("Não deu para guardar a Aparência. Tente de novo."));
  };

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
    <Section title="Aparência">
      <Row label="Modo" hint="Sistema segue o claro e o escuro do Mac.">
        <Segmented<AppearanceMode>
          label="Modo"
          value={a.mode}
          onChange={(mode) => change({ mode })}
          options={[
            { value: "system", label: "Sistema" },
            { value: "dark", label: "Escuro" },
            { value: "light", label: "Claro" },
          ]}
        />
      </Row>
      <Row label="Tamanho do texto">
        <Segmented<TextSize>
          label="Tamanho do texto"
          value={a.textSize}
          onChange={(textSize) => change({ textSize })}
          options={[
            { value: "small", label: "Pequeno" },
            { value: "default", label: "Padrão" },
            { value: "large", label: "Grande" },
            { value: "larger", label: "Maior" },
            { value: "largest", label: "Máximo" },
          ]}
        />
      </Row>
      <Row label="Fonte">
        <Segmented<AppearanceFont>
          label="Fonte"
          value={a.font}
          onChange={(font) => change({ font })}
          options={[
            { value: "system", label: "Sistema" },
            { value: "inter", label: "Inter" },
            { value: "lato", label: "Lato" },
            { value: "atkinson", label: "Atkinson" },
          ]}
        />
      </Row>
      <Row label="Movimento" hint="O Reduzir movimento do macOS também corta as animações.">
        <Segmented<Motion>
          label="Movimento"
          value={a.motion}
          onChange={(motion) => change({ motion })}
          options={[
            { value: "full", label: "Completo" },
            { value: "reduced", label: "Reduzido" },
          ]}
        />
      </Row>
      <div className="kn-themes">
        <div className="kn-themes-head">
          <span className="kn-themes-title">Temas</span>
          <input
            id="kn-theme-search"
            className="kn-themes-search"
            type="search"
            {...NO_TEXT_ASSIST}
            placeholder="Buscar temas"
            aria-label="Buscar temas"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {error ? (
          <p className="kn-themes-error" role="alert">
            {error}
          </p>
        ) : null}
        {SIDES.map(({ side, title }) => {
          const list = shown.filter((t) => t.appearance === side);
          if (!list.length) return null;
          const chosen = side === "dark" ? a.darkTheme : a.lightTheme;
          return (
            <div key={side} className="kn-themes-group">
              <div className="kn-themes-sub">
                {title} · {list.length}
              </div>
              <div className="kn-themes-grid">
                {list.map((t) => (
                  <ThemeTile key={t.id} theme={t} chosen={t.id === chosen} onPick={() => pick(t)} />
                ))}
              </div>
            </div>
          );
        })}
        {shown.length === 0 ? <p className="kn-themes-empty">Nenhum tema com esse nome.</p> : null}
      </div>
    </Section>
  );
}
