import { useEffect, useRef, useState } from "react";
import type { createKiwiCat } from "../kiwicat/cat";
import { type CatColorChoice, catColorOptions, catPalette, catSwatchCss } from "../../src/shared/kiwicat-colors";
import type { AppSettings } from "../../src/shared/ui-contract";
import { api } from "../src/api";
import previewCatUrl from "../kiwicat/assets/preview-cutout.webp";
import { CAT_POSITIONS, CAT_SIZE, type CatPosition, catPreviewRect, catSize, catSizeLabel, PREVIEW_BARS } from "../../src/shared/kiwicat-place";
import { useT } from "../src/i18n";
import { Row, Select, Swatches, Switch } from "../src/kit/index";
import type { TextKey } from "../../src/shared/i18n/index.ts";

const posKey = (id: CatPosition) => `agent.cat.pos.${id}` as TextKey;
const colorKey = (id: string) => `agent.cat.color.${id}` as TextKey;
export function CatRow() {
  const { t } = useT();
  const [show, setShow] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true, changes = 0;
    const off = api.settings.onChanged(s => { changes++; if (alive) setShow(s.kiwicat?.show ?? null); });
    void api.settings.get().then(s => { if (alive && !changes) setShow(s.kiwicat?.show ?? null); }, () => {});
    return () => { alive = false; off(); };
  }, []);
  if (show === null) return null;
  return <Row label={t("agent.cat.show")} hint={failed ? t("agent.saveFailed") : t("agent.cat.show.hint")}>
    <Switch label={t("agent.cat.show")} checked={show} onChange={next => {
      setFailed(false);
      void api.settings.set({ kiwicat: { show: next } }).then(s => setShow(s.kiwicat.show), () => setFailed(true));
    }} />
  </Row>;
}

/**
 * O gato por cima dos outros apps (spec #9810): quando o Kiwi não está na frente, o gato aparece no centro da tela
 * enquanto o agente trabalha. Separado do gato do canto.
 */
export function OverlayCatRow() {
  const { t } = useT();
  const [on, setOn] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true, changes = 0;
    const off = api.settings.onChanged(s => { changes++; if (alive) setOn(s.kiwicat?.overlay ?? null); });
    void api.settings.get().then(s => { if (alive && !changes) setOn(s.kiwicat?.overlay ?? null); }, () => {});
    return () => { alive = false; off(); };
  }, []);
  if (on === null) return null;
  const label = t("agent.cat.overlay");
  return <Row label={label} hint={failed ? t("agent.saveFailed") : t("agent.cat.overlay.hint")}>
    <Switch label={label} checked={on} onChange={next => {
      setFailed(false);
      void api.settings.set({ kiwicat: { overlay: next } }).then(s => setOn(s.kiwicat.overlay), () => setFailed(true));
    }} />
  </Row>;
}

/**
 * Onde o gato aparece por cima dos apps, e o tamanho dele (spec #12949): as seis posições, um controle de 0,6× a 1,6× e
 * uma prévia pequena da tela, com o próprio gato. Salva na hora; o gato do overlay carrega de novo no lugar novo. Com o
 * overlay desligado, a linha continua (a escolha vale quando ele ligar). `bare` (o onboarding): só a prévia, maior, e
 * os controles, sem o título e a frase da linha (o passo já diz).
 */
export function CatPlaceRow({ bare = false }: { bare?: boolean }) {
  const { t, locale } = useT();
  const [cat, setCat] = useState<AppSettings["kiwicat"] | null>(null);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  const pending = useRef(0);
  useEffect(() => {
    let alive = true, changes = 0;
    // Com uma mudança daqui a caminho, o evento dela (ou de uma anterior) não volta o controle.
    const off = api.settings.onChanged(s => { changes++; if (alive && !pending.current) setCat(s.kiwicat ?? null); });
    void api.settings.get().then(s => { if (alive && !changes) setCat(s.kiwicat ?? null); }, () => {});
    return () => { alive = false; off(); };
  }, []);
  if (!cat) return null;
  // Só a resposta da última mudança vale: com as setas no tamanho, uma resposta velha voltaria o controle para trás.
  const save = (patch: { posicao?: CatPosition; tamanho?: number }) => {
    const mine = ++seq.current;
    pending.current++;
    setFailed(false);
    setCat({ ...cat, ...patch });
    void api.settings.set({ kiwicat: patch })
      .then(s => { if (mine === seq.current) setCat(s.kiwicat); }, () => { if (mine === seq.current) { setCat(cat); setFailed(true); } })
      .finally(() => { pending.current--; });
  };
  const hint = failed ? t("agent.saveFailed")
    : cat.overlay ? t("agent.cat.place.hint")
    : t("agent.cat.place.offHint");
  const body = <div className="kn-cat-place" data-bare={bare || undefined}>
    <CatPlacePreview posicao={cat.posicao} tamanho={cat.tamanho} cor={catPalette(cat.cor).accentColor} />
    <div className="kn-cat-place-controls">
      <div className="kn-cat-place-field">
        <span className="kn-cat-place-label">{t("agent.cat.position")}</span>
        <Select<CatPosition> label={t("agent.cat.position.select")} value={cat.posicao} options={CAT_POSITIONS.map(p => ({ value: p.id, label: t(posKey(p.id)) }))}
          onChange={posicao => posicao !== cat.posicao && save({ posicao })} />
      </div>
      <label className="kn-cat-place-field">
        <span className="kn-cat-place-label">{t("agent.cat.size")}</span>
        <span className="kn-cat-size">
          <input type="range" aria-label={t("agent.cat.size.input")} min={CAT_SIZE.min} max={CAT_SIZE.max} step={CAT_SIZE.step} value={cat.tamanho}
            onChange={e => setCat({ ...cat, tamanho: catSize(Number(e.target.value)) })}
            onPointerUp={e => save({ tamanho: catSize(Number((e.target as HTMLInputElement).value)) })}
            onKeyUp={e => save({ tamanho: catSize(Number((e.target as HTMLInputElement).value)) })} />
          <span className="kn-cat-size-value">{catSizeLabel(cat.tamanho, locale)}</span>
        </span>
      </label>
      {bare && failed ? <p className="kn-row-hint" role="alert">{hint}</p> : null}
    </div>
  </div>;
  if (bare) return body;
  // O título e a frase em cima, na largura toda, e a prévia e os controles numa linha embaixo (#13334): na coluna
  // estreita do Row, o texto quebrava em seis linhas.
  return <div className="kn-row kn-row-stacked">
    <div className="kn-row-text">
      <div className="kn-row-label">{t("agent.cat.place")}</div>
      <div className="kn-row-hint">{hint}</div>
    </div>
    {body}
  </div>;
}

/**
 * A prévia pequena da tela: a barra de menus, o Dock e o gato (a mesma arte, sempre preto, com o brilho da cor dele) no
 * lugar e no tamanho escolhidos, pela conta do helper.
 */
export function CatPlacePreview({ posicao, tamanho, cor }: { posicao: CatPosition; tamanho: number; cor: string }) {
  const { t, locale } = useT();
  const r = catPreviewRect(posicao, tamanho);
  return <div className="kn-cat-screen" role="img" aria-label={t("agent.cat.preview", { where: t(posKey(posicao)).toLowerCase(), size: catSizeLabel(tamanho, locale) })}>
    <span className="kn-cat-screen-menu" style={{ height: `${PREVIEW_BARS.menu}%` }} />
    <span className="kn-cat-screen-dock" style={{ height: `${PREVIEW_BARS.dock * 0.6}%` }} />
    <img className="kn-cat-screen-cat" src={previewCatUrl} alt="" draggable={false} data-posicao={posicao}
      style={{ left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: `${r.height}%`, ["--glow" as string]: cor }} />
  </div>;
}

type Cat = Awaited<ReturnType<typeof createKiwiCat>>;

/**
 * A paleta do gato em Ajustes › Agente (spec #14963): as 5 do pacote, cada amostra com o gradiente dos `prismStops`, a
 * `prisma-original` marcada por padrão, e o gato pequeno e parado ao lado. Trocar salva na hora, e o gato do canto, o
 * do overlay e o balão seguem sem reabrir. Com o agente ou o "Mostrar o Kiwi Cat" desligado, a linha fica desabilitada,
 * sem o gato, e o módulo do gato não é carregado.
 */
/** `preview: false`: sem o gatinho da linha (o onboarding já mostra o gato grande, spec #11955). */
export function CatColorRow({ agentEnabled, preview = true }: { agentEnabled: boolean; preview?: boolean }) {
  const { t } = useT();
  const [cat, setCat] = useState<AppSettings["kiwicat"] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true, changes = 0;
    const off = api.settings.onChanged(s => { changes++; if (alive) setCat(s.kiwicat ?? null); });
    void api.settings.get().then(s => { if (alive && !changes) setCat(s.kiwicat ?? null); }, () => {});
    return () => { alive = false; off(); };
  }, []);
  if (!cat) return null;
  const on = agentEnabled && cat.show;
  const label = t("agent.cat.color");
  const current = catPalette(cat.cor);
  const hint = failed ? t("agent.saveFailed")
    : !agentEnabled ? t("agent.cat.color.needsAgent")
    : !cat.show ? t("agent.cat.color.needsCat")
    : t("agent.cat.color.hint", { name: t(colorKey(current.id)) });
  const options = catColorOptions().map(o => ({ value: o.id, label: t(colorKey(o.id)), color: catSwatchCss(o.prismStops) }));
  return <Row label={label} hint={hint} oneLine>
    <div className="kn-cat-color">
      {on && preview ? <CatPreview cor={cat.cor} /> : null}
      <Swatches<CatColorChoice> label={label} value={current.id} options={options} disabled={!on} onChange={next => {
        if (next === cat.cor) return;
        setFailed(false);
        // Na hora: a amostra e o gato do canto trocam antes de o arquivo ser salvo.
        setCat({ ...cat, cor: next });
        void api.settings.set({ kiwicat: { cor: next } }).then(s => setCat(s.kiwicat), () => { setCat(cat); setFailed(true); });
      }} />
    </div>
  </Row>;
}

const previewBackground = (): "light" | "dark" => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

/** O gato pequeno e parado da linha da cor: só existe enquanto os Ajustes estão abertos, e não anima. */
function CatPreview({ cor }: { cor: string }) {
  const root = useRef<HTMLDivElement>(null);
  const handle = useRef<Cat | undefined>(undefined);
  const corRef = useRef(cor); corRef.current = cor;
  useEffect(() => {
    if (root.current) root.current.dataset.cor = cor;
    handle.current?.update({ cor });
  }, [cor]);
  useEffect(() => {
    const el = root.current!;
    let gone = false;
    void (async () => {
      try {
        const { createKiwiCat } = await import("../kiwicat/cat");
        if (gone) return;
        const cat = await createKiwiCat(el, { mode: "runtime", width: 56, height: 56, background: previewBackground(),
          inputs: { estado: "repouso", cor: corRef.current, voz: null, parado: true } });
        if (gone) { await cat.dispose(); return; }
        handle.current = cat;
        el.dataset.ready = "true";
      } catch { el.replaceChildren(); }
    })();
    const theme = new MutationObserver(() => handle.current?.setBackground(previewBackground()));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      gone = true; theme.disconnect();
      const cat = handle.current; handle.current = undefined;
      if (cat) void cat.dispose();
    };
  }, []);
  return <div className="kn-cat-preview" aria-hidden="true" ref={root} data-cor={cor} />;
}
