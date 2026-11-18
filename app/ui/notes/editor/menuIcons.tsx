// Os ícones do menu do botão direito do editor (spec #17703): um desenho pequeno à esquerda de cada opção de Parágrafo
// e Inserir, para a pessoa ver o que ela faz sem ler. No mesmo traço de `treeIcons.tsx` e `calloutIcons.tsx`: SVG
// local, 16 px, traço de 1,3 na cor do texto (`currentColor`), então seguem o tema claro e o escuro. Sem lib nem CDN.

import type { ReactElement } from "react";

export type MenuIconName =
  | "bullet" | "numbered" | "task" | "quote" | "check"
  | "link" | "note-link" | "table" | "code" | "divider" | "callout" | "footnote";

const dot = (cx: number, cy: number) => <circle cx={cx} cy={cy} r=".9" fill="currentColor" stroke="none" />;
/** O número pequeno, no traço (o `text` mudaria de fonte e de peso com o tema). */
const one = (y: number) => <path d={`M3 ${y - 1.4}l1-.6v3.4`} />;

const PATHS: Record<MenuIconName, ReactElement> = {
  // Lista: três pontos e as linhas.
  bullet: (
    <>
      {dot(3.5, 4)}{dot(3.5, 8)}{dot(3.5, 12)}
      <path d="M6.5 4h7M6.5 8h7M6.5 12h7" />
    </>
  ),
  // Lista numerada: 1, 2 e as linhas.
  numbered: (
    <>
      {one(4.4)}
      <path d="M2.8 10.4c.2-.5.6-.8 1.1-.8s.9.3.9.8c0 .8-2 1.6-2 2.6h2" />
      <path d="M7 4h6.5M7 11.5h6.5" />
    </>
  ),
  // Lista de tarefas: a caixa vazia e a linha.
  task: (
    <>
      <rect x="2.5" y="3" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9.5" width="4.5" height="4.5" rx="1" />
      <path d="M9.5 5.2h4M9.5 11.7h4" />
    </>
  ),
  // Citação: a barra da esquerda e o texto recuado.
  quote: <path d="M3 3v10M6 4.5h7M6 8h7M6 11.5h4.5" />,
  // Marcar tarefa: a caixa com o certo.
  check: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M5.2 8.2l1.9 1.9 3.8-4" />
    </>
  ),
  // Link: dois elos.
  link: <path d="M7 9a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.8.8M9 7a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.8-.8" />,
  // Link para nota: a folha com o elo.
  "note-link": (
    <>
      <path d="M8.5 14H4c-.3 0-.5-.2-.5-.5v-11c0-.3.2-.5.5-.5h5.5L12.5 5v3" />
      <path d="M9.5 2v3h3" />
      <path d="M10.2 12.6a1.4 1.4 0 0 0 2 0l1-1a1.4 1.4 0 0 0-2-2l-.3.3M11.3 11.4a1.4 1.4 0 0 0-2 0l-1 1a1.4 1.4 0 0 0 2 2l.3-.3" />
    </>
  ),
  // Tabela: a grade.
  table: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M2.5 9.8h11M6.5 6.5V13" />
    </>
  ),
  // Bloco de código: os sinais < >.
  code: <path d="M6 4.5L2.5 8 6 11.5M10 4.5L13.5 8 10 11.5M9 3.5l-2 9" />,
  // Separador: a linha do meio, com o texto em cima e embaixo, apagado.
  divider: (
    <>
      <path d="M2.5 8h11" />
      <path d="M4.5 4.5h7M4.5 11.5h7" opacity=".45" />
    </>
  ),
  // Callout: a caixa com a marca à esquerda.
  callout: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M5.5 6v4M8 6.5h3.5M8 9.5h2.5" />
    </>
  ),
  // Nota de rodapé: o texto e o número pequeno em cima.
  footnote: (
    <>
      <path d="M2.5 8h7M2.5 12h7" />
      <path d="M11.5 3.6l1-.6v4" />
    </>
  ),
};

/** Os nomes, para o teste conferir que cada um desenha. */
export const MENU_ICON_NAMES = Object.keys(PATHS) as MenuIconName[];

export function MenuIcon({ name }: { name: MenuIconName }) {
  return (
    <svg className="kn-menu-icon" data-icon={name} viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
