import "../styles/base.css";
import "./kit.css";

import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    /** O processo principal chama ao trazer uma janela já aberta para a frente. */
    __kiwiEnter?: () => void;
  }
}

/** Monta a janela em #root. */
export function mount(node: ReactNode): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("no #root");
  createRoot(root).render(node);
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
      <header className="kn-titlebar electrobun-webkit-app-region-drag">
        <h1>{title}</h1>
        {end ? <div className="kn-titlebar-end electrobun-webkit-app-region-no-drag">{end}</div> : null}
      </header>
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

export function Row({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="kn-row">
      <div className="kn-row-text">
        <div className="kn-row-label">{label}</div>
        {hint ? <div className="kn-row-hint">{hint}</div> : null}
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

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="kn-switch"
      onClick={() => onChange(!checked)}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kn-kbd">{children}</kbd>;
}

/**
 * Controle segmentado com um só pill que desliza entre as opções (`--glide`),
 * em vez de cada opção acender sozinha.
 */
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
