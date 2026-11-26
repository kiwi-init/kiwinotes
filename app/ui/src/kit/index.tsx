import "../styles/base.css";
import "./kit.css";

import { placeHoverLabel } from "./hover-label.ts";

import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

import { api, engineReady, has, reportError } from "../api.ts";
import { TopBar, useInHub } from "../topbar.tsx";
import { startAppearance } from "../styles/appearance.ts";
import { startLocale, useT } from "../i18n.ts";
import { startScrollbars } from "../scrollbar.ts";

declare global {
  interface Window {
    /** O processo principal chama ao trazer uma janela já aberta para a frente. */
    __kiwiEnter?: () => void;
    /** O hub aberto escondido para o fim da intro (T16769): o conteúdo fica transparente até o `__kiwiReveal`. */
    __kiwiHold?: () => void;
    /** O hub aparece no fim da intro: o conteúdo entra só com o fade, sem subir nem crescer (T16769). */
    __kiwiReveal?: () => void;
    /**
     * O hub está segurado para a intro (T23565). O main põe o `true` junto com o `__kiwiHold` e o `false` com o
     * `__kiwiReveal`: a marca vale mesmo se chegar antes de o React montar, quando as duas funções ainda não existem.
     */
    __kiwiHeld?: boolean;
  }
}

/** Avisa o AppEngine que a UI subiu, depois do primeiro commit do React (não espera pintura: rAF para em janela oculta). */
function Booted({ children }: { children: ReactNode }) {
  useEffect(() => engineReady(), []);
  return (
    <>
      {children}
      <UpdateReady />
    </>
  );
}

/**
 * A faixa "Nova aparência pronta" (spec #25011): o canal baixou e conferiu uma UI nova para esta janela, que espera.
 * Recarregar troca sem fechar o app; Depois esconde a faixa, e a janela sobe a nova na próxima abertura.
 */
export function UpdateReady() {
  const { t } = useT();
  const [pending, setPending] = useState<string | null>(null);
  const [later, setLater] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!has("ui.status")) return;
    let live = true;
    // A faixa é um extra: sem resposta do `ui.status`, ela só não aparece, e a janela segue.
    api.ui.status().then((s) => live && setPending(s.pending), () => {});
    const off = api.ui.onUpdateReady((s) => setPending(s.pending));
    return () => {
      live = false;
      off();
    };
  }, []);
  if (!pending || later === pending) return null;
  const reload = () => {
    setBusy(true);
    api.ui.reload().then((s) => setPending(s.pending), reportError).finally(() => setBusy(false));
  };
  return (
    <div className="kn-update-ready" role="status" data-testid="ui-update-ready">
      <span>{t("uiUpdate.ready")}</span>
      <Button variant="primary" disabled={busy} onClick={reload}>
        {t("uiUpdate.reload")}
      </Button>
      <Button onClick={() => setLater(pending)}>{t("uiUpdate.later")}</Button>
    </div>
  );
}

/** Monta a janela em #root. */
export function mount(node: ReactNode): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("no #root");
  // A Aparência antes do primeiro render: a janela já pinta no tema escolhido (T2503). Espera o engine no máximo
  // 300 ms; se ele demorar, pinta com a cópia local (ou o padrão) e troca quando a resposta chegar.
  startScrollbars();
  // A língua (spec #28171) vai junto: a primeira tela já sai nela.
  const appearance = Promise.race([Promise.all([startAppearance(), startLocale()]), new Promise<void>((r) => setTimeout(r, 300))]);
  void appearance.then(() => createRoot(root).render(<Booted>{node}</Booted>));
}

// ---------------------------------------------------------------- Window

/**
 * A casca de cada janela: barra de título arrastável (semáforos inset) e o
 * conteúdo. Entra com `window-in` no primeiro load e de novo cada vez que o
 * main chama `window.__kiwiEnter()`.
 */
export function Window({ title, end, children }: { title: string; end?: ReactNode; children: ReactNode }) {
  // O WebKit pausa animações num documento oculto (janela coberta por outra).
  // Se a entrada começasse ali, a janela ficaria parada em opacity 0. Então ela
  // só toca quando o documento está visível; se abriu oculta, toca ao aparecer.
  const [entry, setEntry] = useState(() => (document.visibilityState === "visible" ? 1 : 0));
  const ref = useRef<HTMLDivElement>(null);
  const inHub = useInHub();
  // Ao voltar para a frente, a animação toca de novo sem remontar a árvore: uma `key` nova apagava a edição em
  // andamento no Dicionário e nos Snippets, e o autosave que ainda não tinha disparado (T914).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || entry <= 1) return;
    el.dataset.entering = "false";
    void el.offsetWidth;
    el.dataset.entering = "true";
  }, [entry]);
  useEffect(() => {
    document.title = title;
    const replay = () => setEntry((n) => n + 1);
    window.__kiwiEnter = () => {
      if (document.visibilityState === "visible") replay();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") setEntry((n) => (n === 0 ? 1 : n));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      delete window.__kiwiEnter;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [title]);
  return (
    <div className="kn-window" data-entering={entry > 0} ref={ref}>
      {inHub ? (
        // No hub, o nome da seção já está na aba (T2502): o que a janela tinha no canto vai para a barra de cima.
        <TopBar end={end} />
      ) : (
        <header className="kn-titlebar electrobun-webkit-app-region-drag">
          <h1>{title}</h1>
          {end ? <div className="kn-titlebar-end electrobun-webkit-app-region-no-drag">{end}</div> : null}
        </header>
      )}
      <main className="kn-content kn-stagger">{children}</main>
    </div>
  );
}

// ---------------------------------------------------------------- layout

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="kn-section">
      <h2 className="kn-section-title">{title}</h2>
      <div className="kn-card">{children}</div>
    </section>
  );
}

/** `oneLine`: a frase fica numa linha só e corta com "…" (a linha não muda de altura quando a frase muda, spec #17709). */
export function Row({ label, hint, oneLine = false, children }: { label: string; hint?: string; oneLine?: boolean; children?: ReactNode }) {
  return (
    <div className="kn-row">
      <div className="kn-row-text">
        <div className="kn-row-label">{label}</div>
        {hint ? <div className={oneLine ? "kn-row-hint kn-row-hint-line" : "kn-row-hint"} title={oneLine ? hint : undefined}>{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="kn-empty">
      {icon}
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- controles

export function Button({
  variant = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" }) {
  return <button type="button" className="kn-button" data-variant={variant} {...props} />;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="kn-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

/**
 * Uma lista que abre (T3230): o `<select>` do sistema, com a cara flutuante dos outros controles. Para escolhas que não
 * cabem num segmentado (a lista de microfones). `onOpen` chega no foco e no clique, antes de a lista abrir.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  onOpen,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  onOpen?: () => void;
  label: string;
}) {
  return (
    <span className="kn-select">
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} onFocus={onOpen} onMouseDown={onOpen}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg className="kn-select-chevron" viewBox="0 0 12 12" aria-hidden>
        <path d="M3 4.5 6 7.5 9 4.5" />
      </svg>
    </span>
  );
}

/**
 * O nome que aparece junto do ícone no hover e no foco do teclado (T3821, spec #3816), por cima dos vizinhos (T26124). O botão leva a classe
 * `kn-expand` e um `aria-label` com o mesmo nome: este texto é só visual.
 */
export function HoverLabel({ children }: { children: ReactNode }) {
  // O nome cresce por cima dos vizinhos, para o lado com espaço (T26124): a medida sai antes de abrir.
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const label = ref.current;
    const button = label?.parentElement;
    if (!label || !button) return;
    const place = () => placeHoverLabel(button, label);
    // Já no lado certo em repouso: fechada do lado errado, a camada passa da borda de quem corta e o deixa rolar (o
    // cartão do Dicionário corria uns 50 px ao focar ou rolar até o ×, revisão #26404). Escondido (a árvore fechada, ou
    // uma aba dos Ajustes que ainda não abriu, spec #31754), assenta quando aparece: o ResizeObserver avisa quando a
    // caixa sai do zero. Só nessa passagem: a cada mudança de tamanho, o assentar cortaria a transição do hover.
    let shown = button.getClientRects().length > 0;
    if (shown) place();
    const seen =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            const now = button.getClientRects().length > 0;
            if (now && !shown) place();
            shown = now;
          });
    seen?.observe(button);
    button.addEventListener("pointerenter", place);
    button.addEventListener("focus", place);
    return () => {
      seen?.disconnect();
      button.removeEventListener("pointerenter", place);
      button.removeEventListener("focus", place);
    };
  }, []);
  return (
    <span ref={ref} className="kn-expand-label" aria-hidden="true">
      <span>{children}</span>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kn-kbd">{children}</kbd>;
}

/**
 * Controle segmentado com um só pill que desliza entre as opções (`--glide`),
 * em vez de cada opção acender sozinha.
 */
/**
 * Amostras de cor prontas (spec #9349): um grupo de rádios, sem campo de código e sem o painel de cores do macOS. As
 * setas andam entre as amostras e escolhem (o padrão dos rádios); só a marcada entra no Tab.
 */
export function Swatches<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
}: {
  value: T;
  options: { value: T; label: string; color: string }[];
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (from: number, step: number) => {
    const next = options[(from + step + options.length) % options.length]!;
    onChange(next.value);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus());
  };
  return (
    <div className="kn-swatches" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} ref={ref}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.label}
          title={o.label}
          data-value={o.value}
          disabled={disabled}
          tabIndex={o.value === value ? 0 : -1}
          style={{ "--swatch": o.color } as CSSProperties}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
            if (!step) return;
            e.preventDefault();
            move(i, step);
          }}
        />
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>('button[aria-checked="true"]');
    if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
  }, []);

  useLayoutEffect(measure, [measure, value]);
  // só anima depois da primeira medida, para o pill não deslizar ao abrir a janela
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="kn-segmented" role="radiogroup" aria-label={label} ref={ref}>
      {pill ? (
        <span
          className="kn-segmented-pill"
          aria-hidden
          style={{
            width: pill.w,
            transform: `translateX(${pill.x}px)`,
            transition: ready ? undefined : "none",
          }}
        />
      ) : null}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
