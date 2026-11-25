// O menu da aba Início (T15875, harry #15873, a proposta 1 do #15841): a seta da aba abre Início · Pendências · Semana,
// cada uma com o ícone, e a aba passa a mostrar o nome e o ícone da tela aberta. Sem atalho de teclado novo (#15913).
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { api } from "../src/api.ts";
import { HomeIcon } from "./icons.tsx";
import { useHome } from "./useHome.ts";
import { useT } from "../src/i18n.ts";
import type { TextKey } from "../../src/shared/i18n/index.ts";

export const INICIO_VIEWS = ["inicio", "pendencias", "semana"] as const;
export type InicioView = (typeof INICIO_VIEWS)[number];

const Svg = ({ children, className }: { children: ReactNode; className?: string }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

/** Os ícones, no traço de 1.6 px numa caixa de 16 dos ícones do app (a casa é a da aba Início). */
export const VIEW_ICON: Record<InicioView, (p: { className?: string }) => ReactNode> = {
  inicio: (p) => <span className={p.className}><HomeIcon size={16} /></span>,
  pendencias: (p) => (
    <Svg {...p}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
      <path d="m5.3 8.1 1.9 1.9 3.6-3.9" />
    </Svg>
  ),
  semana: (p) => (
    <Svg {...p}>
      <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3M5.5 9.5h1M9.5 9.5h1" />
    </Svg>
  ),
};

export const VIEW_LABEL: Record<InicioView, TextKey> = { inicio: "hub.tab.home", pendencias: "home.pending.title", semana: "home.view.week" };

/** O que vai dentro da aba: o ícone e o nome da tela aberta, e a seta do menu. */
export function InicioTabLabel({ view }: { view: InicioView }) {
  const { t } = useT();
  const Icon = VIEW_ICON[view];
  return (
    <>
      <Icon className="kn-tab-icon" />
      <span className="kn-home-v-tab-label">{t(VIEW_LABEL[view])}</span>
      <svg className="kn-home-v-chevron" width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m3 4.5 3 3 3-3" />
      </svg>
    </>
  );
}

/**
 * O menu aberto, abaixo da aba (`anchor`). As setas andam entre os itens, Enter ou o clique escolhe, Esc e o clique fora
 * fecham, e o foco volta à aba. Ao lado de Pendências, quantas estão abertas (escondido se 0).
 */
export function InicioMenu({
  view,
  anchor,
  onPick,
  onClose,
}: {
  view: InicioView;
  anchor: HTMLElement | null;
  onPick(v: InicioView): void;
  onClose(): void;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const load = useHome(api.home.pending);
  const pending = load.state === "ready" ? load.data.total.meeting + load.data.total.note : 0;
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor?.contains(t)) onClose();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, []);
  // A posição segue a aba: mede de novo quando a janela muda de tamanho com o menu aberto.
  const [rect, setRect] = useState(() => anchor?.getBoundingClientRect());
  useEffect(() => {
    const measure = () => setRect(anchor?.getBoundingClientRect());
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchor]);
  const close = () => {
    onClose();
    anchor?.focus();
  };
  const pick = (v: InicioView) => {
    onPick(v);
    anchor?.focus();
  };
  // No `body`: a barra de cima é um contexto de empilhamento abaixo do gato do canto, e o menu ficaria embaixo dele.
  return createPortal(
    <div
      className="kn-home-v-menu"
      role="menu"
      aria-label={t("home.view.menu")}
      ref={ref}
      style={rect ? { top: rect.bottom + 6, left: rect.left } : undefined}
      onKeyDown={(e) => {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const d = e.key === "ArrowDown" ? 1 : -1;
          items[(i + d + items.length) % items.length]?.focus();
        } else if (e.key === "Escape" || e.key === "Tab") {
          e.preventDefault();
          close();
        }
      }}
    >
      {INICIO_VIEWS.map((v) => {
        const Icon = VIEW_ICON[v];
        return (
          <button
            type="button"
            role="menuitemradio"
            key={v}
            data-view={v}
            aria-checked={v === view}
            tabIndex={-1}
            className="kn-home-v-item"
            onClick={() => pick(v)}
          >
            <Icon />
            <span>{t(VIEW_LABEL[v])}</span>
            {v === "pendencias" && pending ? <span className="kn-home-v-count" aria-label={t("home.pending.open", { n: pending })}>{pending}</span> : null}
            {v === view ? (
              <svg className="kn-home-v-check" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2.5 6.2 5 8.5l4.5-5" />
              </svg>
            ) : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
