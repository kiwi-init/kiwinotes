// Os ícones dos callouts (spec #12626, ponto 3): no lugar dos glifos de texto (✎, ≡, ✦, ⚡…), 13 desenhos de linha no
// mesmo traço de `treeIcons.tsx` e `topicIcons.tsx`: SVG local, 16 px, traço de 1,3, na cor do tipo (`currentColor`).

import type { ReactElement } from "react";

const dot = (cx: number, cy: number) => <circle cx={cx} cy={cy} r=".7" fill="currentColor" stroke="none" />;
const ring = <circle cx="8" cy="8" r="5.5" />;

/** Um desenho por tipo do `CALLOUT_KINDS`, pelo id. */
export const CALLOUT_ICONS: Record<string, ReactElement> = {
  // O lápis.
  note: <path d="M3 13l.6-2.6 6.8-6.8a1.3 1.3 0 0 1 1.9 0l.1.1a1.3 1.3 0 0 1 0 1.9L5.6 12.4zM9.5 4.6l1.9 1.9" />,
  // As linhas de um resumo.
  abstract: <path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h5.5" />,
  // O "i".
  info: (
    <>
      {ring}
      <path d="M8 7.3v3.7" />
      {dot(8, 5.2)}
    </>
  ),
  // A caixa de marcar.
  todo: <rect x="3" y="3" width="10" height="10" rx="2" />,
  // A lâmpada.
  tip: <path d="M6.2 12.6h3.6M6.8 14.2h2.4M8 2.4a4 4 0 0 0-2.4 7.2c.4.3.6.7.6 1.2v.2h3.6v-.2c0-.5.2-.9.6-1.2A4 4 0 0 0 8 2.4z" />,
  // O certo no círculo.
  success: (
    <>
      {ring}
      <path d="M5.6 8.2l1.7 1.7 3.2-3.4" />
    </>
  ),
  // A pergunta no círculo.
  question: (
    <>
      {ring}
      <path d="M6.4 6.5a1.7 1.7 0 1 1 2.4 1.5c-.5.3-.8.6-.8 1.2v.2" />
      {dot(8, 11.1)}
    </>
  ),
  // O triângulo de atenção.
  warning: (
    <>
      <path d="M8 2.6l5.8 10.2H2.2z" />
      <path d="M8 6.6v3" />
      {dot(8, 11.2)}
    </>
  ),
  // O xis no círculo.
  failure: (
    <>
      {ring}
      <path d="M6 6l4 4M10 6l-4 4" />
    </>
  ),
  // O raio.
  danger: <path d="M9 2.3L4.4 9h3.3l-.7 4.7L11.6 7H8.3z" />,
  // O inseto.
  bug: <path d="M8 5.2c1.7 0 2.8 1.5 2.8 3.5S9.7 12.6 8 12.6s-2.8-1.9-2.8-3.9S6.3 5.2 8 5.2zM8 5.2v7.4M6.4 5.5L5.3 3.9M9.6 5.5l1.1-1.6M5.2 8.6H3M10.8 8.6H13M5.5 11.1l-1.6 1.3M10.5 11.1l1.6 1.3" />,
  // A folha com linhas.
  example: (
    <>
      <rect x="3" y="2.5" width="10" height="11" rx="1.5" />
      <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" />
    </>
  ),
  // As aspas.
  quote: <path d="M3.5 4.5h3.2v3.3c0 2-1 3.4-3 4M3.5 4.5v3.3h3.2M9.3 4.5h3.2v3.3c0 2-1 3.4-3 4M9.3 4.5v3.3h3.2" />,
};

export function CalloutIcon({ kind }: { kind: string }) {
  return (
    <svg className="kn-callout-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {CALLOUT_ICONS[kind] ?? CALLOUT_ICONS.note}
    </svg>
  );
}
