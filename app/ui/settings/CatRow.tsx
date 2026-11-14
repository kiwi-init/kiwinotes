import { useEffect, useRef, useState } from "react";
import type { createKiwiCat } from "../kiwicat/cat";
import { type CatColorChoice, catColorHex, catColorOptions } from "../../src/shared/kiwicat-colors";
import type { AppSettings } from "../../src/shared/ui-contract";
import { api } from "../src/api";
import { CAT_POSITIONS, CAT_SIZE, type CatPosition, catPreviewRect, catSize, catSizeLabel, PREVIEW_BARS } from "../../src/shared/kiwicat-place";
import { Row, Select, Swatches, Switch } from "../src/kit/index";
export function CatRow() {
  const [show, setShow] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true, changes = 0;
    const off = api.settings.onChanged(s => { changes++; if (alive) setShow(s.kiwicat?.show ?? null); });
    void api.settings.get().then(s => { if (alive && !changes) setShow(s.kiwicat?.show ?? null); }, () => {});
    return () => { alive = false; off(); };
  }, []);
  if (show === null) return null;
  return <Row label="Mostrar o Kiwi Cat" hint={failed ? "Não deu para salvar. Tente de novo." : "O gato mostra o que o agente está fazendo no canto da janela."}>
    <Switch label="Mostrar o Kiwi Cat" checked={show} onChange={next => {
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
  const [on, setOn] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true, changes = 0;
    const off = api.settings.onChanged(s => { changes++; if (alive) setOn(s.kiwicat?.overlay ?? null); });
    void api.settings.get().then(s => { if (alive && !changes) setOn(s.kiwicat?.overlay ?? null); }, () => {});
    return () => { alive = false; off(); };
  }, []);
  if (on === null) return null;
  const label = "Mostrar o Kiwi Cat por cima dos outros apps";
  return <Row label={label} hint={failed ? "Não deu para salvar. Tente de novo." : "Quando o Kiwi não está na frente, o gato aparece na tela enquanto o agente trabalha, no lugar escolhido abaixo. Ele não pega o clique nem o foco."}>
    <Switch label={label} checked={on} onChange={next => {
      setFailed(false);
      void api.settings.set({ kiwicat: { overlay: next } }).then(s => setOn(s.kiwicat.overlay), () => setFailed(true));
    }} />
  </Row>;
}

/**
 * Onde o gato aparece por cima dos apps, e o tamanho dele (spec #12949): as seis posições, um controle de 0,6× a 1,6× e
 * uma prévia pequena da tela. Salva na hora; o gato do overlay carrega de novo no lugar novo. Com o overlay desligado, a
 * linha continua (a escolha vale quando ele ligar).
 */
export function CatPlaceRow() {
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
  const hint = failed ? "Não deu para salvar. Tente de novo."
    : cat.overlay ? "Onde o gato aparece por cima dos outros apps, e o tamanho dele. Ele fica longe do Dock e da barra de menus."
    : "Vale quando o Kiwi Cat por cima dos outros apps estiver ligado.";
  return <Row label="Posição e tamanho do Kiwi Cat" hint={hint}>
    <div className="kn-cat-place">
      <CatPlacePreview posicao={cat.posicao} tamanho={cat.tamanho} />
      <div className="kn-cat-place-controls">
        <Select<CatPosition> label="Posição do Kiwi Cat" value={cat.posicao} options={CAT_POSITIONS.map(p => ({ value: p.id, label: p.label }))}
          onChange={posicao => posicao !== cat.posicao && save({ posicao })} />
        <label className="kn-cat-size">
          <input type="range" aria-label="Tamanho do Kiwi Cat" min={CAT_SIZE.min} max={CAT_SIZE.max} step={CAT_SIZE.step} value={cat.tamanho}
            onChange={e => setCat({ ...cat, tamanho: catSize(Number(e.target.value)) })}
            onPointerUp={e => save({ tamanho: catSize(Number((e.target as HTMLInputElement).value)) })}
            onKeyUp={e => save({ tamanho: catSize(Number((e.target as HTMLInputElement).value)) })} />
          <span className="kn-cat-size-value">{catSizeLabel(cat.tamanho)}</span>
        </label>
      </div>
    </div>
  </Row>;
}

/** A prévia pequena da tela: a barra de menus, o Dock e o gato no lugar e no tamanho escolhidos (a conta do helper). */
export function CatPlacePreview({ posicao, tamanho }: { posicao: CatPosition; tamanho: number }) {
  const r = catPreviewRect(posicao, tamanho);
  return <div className="kn-cat-screen" role="img" aria-label={`Prévia: o Kiwi Cat em ${CAT_POSITIONS.find(p => p.id === posicao)?.label.toLowerCase()}, ${catSizeLabel(tamanho)}`}>
    <span className="kn-cat-screen-menu" style={{ height: `${PREVIEW_BARS.menu}%` }} />
    <span className="kn-cat-screen-dock" style={{ height: `${PREVIEW_BARS.dock * 0.6}%` }} />
    <span className="kn-cat-screen-cat" data-posicao={posicao} style={{ left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: `${r.height}%` }} />
  </div>;
}

type Cat = Awaited<ReturnType<typeof createKiwiCat>>;

/**
 * A cor da névoa do gato (spec #9349): só amostras prontas, com a do agente marcada por padrão, e uma amostra pequena e
 * parada do gato ao lado. Com o agente ou o "Mostrar o Kiwi Cat" desligado, a linha fica desabilitada, sem amostra, e o
 * módulo do gato não é carregado.
 */
/** `preview: false`: sem o gatinho da linha (o onboarding já mostra o gato grande na cor, spec #11955). */
export function CatColorRow({ agentEnabled, preview = true }: { agentEnabled: boolean; preview?: boolean }) {
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
  const label = "Cor do Kiwi Cat";
  const hint = failed ? "Não deu para salvar. Tente de novo."
    : !agentEnabled ? "Ligue o agente para escolher a cor do gato."
    : !cat.show ? "Mostre o Kiwi Cat para escolher a cor dele."
    : "A cor da névoa em volta do gato. O gato continua preto.";
  const options = catColorOptions().map(o => ({ value: o.id, label: o.label, color: o.hex }));
  return <Row label={label} hint={hint}>
    <div className="kn-cat-color">
      {on && preview ? <CatPreview cor={catColorHex(cat.cor)} /> : null}
      <Swatches<CatColorChoice> label={label} value={cat.cor} options={options} disabled={!on} onChange={next => {
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
        const cat = await createKiwiCat(el, { mode: "runtime", width: 48, height: 60, cutout: true, background: previewBackground(),
          inputs: { estado: "repouso", cor: corRef.current, voz: null, parado: true } });
        if (gone) { await cat.dispose(); return; }
        handle.current = cat;
        cat.update({ cor: corRef.current });
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
