// Os ícones da árvore das Notas (T3370, spec #3272): um por tipo, para pasta, nota e arquivo não se confundirem.
// SVG local, 16 px, traço de 1,3 na cor do texto (`currentColor`); o CSS deixa todos no cinza fraco. Sem lib nem CDN.

import type { ReactElement } from "react";

import type { FileType } from "./tree.ts";

export type TreeIconName = "folder" | "folder-open" | "note" | "daily" | "today" | "search" | "tag" | "trash" | FileType;

const PATHS: Record<TreeIconName, ReactElement> = {
  folder: <path d="M2 4.5c0-.6.4-1 1-1h3.1l1.4 1.5H13c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z" />,
  "folder-open": (
    <>
      <path d="M2 11.5v-7c0-.6.4-1 1-1h3.1l1.4 1.5H12c.6 0 1 .4 1 1V7" />
      <path d="M2.2 12.5 4 7.7c.1-.4.5-.7 1-.7h8.6c.5 0 .8.5.7.9l-1.6 4c-.1.4-.5.6-.9.6H3c-.5 0-.9-.5-.8-1z" />
    </>
  ),
  note: (
    <>
      <path d="M4 2h5.5L12.5 5v8.5c0 .3-.2.5-.5.5H4c-.3 0-.5-.2-.5-.5v-11c0-.3.2-.5.5-.5z" />
      <path d="M9.5 2v3h3M5.8 8h4.4M5.8 10.5h4.4" />
    </>
  ),
  daily: (
    <>
      <path d="M4 2h5.5L12.5 5v8.5c0 .3-.2.5-.5.5H4c-.3 0-.5-.2-.5-.5v-11c0-.3.2-.5.5-.5z" />
      <path d="M9.5 2v3h3" />
      <circle cx="8" cy="9.5" r="1.6" />
    </>
  ),
  today: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
      <rect x="5" y="8.5" width="2.5" height="2.5" rx=".4" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="m10 10 3.5 3.5" />
    </>
  ),
  tag: (
    <>
      <path d="M2.5 3v4.1c0 .3.1.5.3.7l5.5 5.5c.4.4 1 .4 1.4 0l3.6-3.6c.4-.4.4-1 0-1.4L7.8 2.8c-.2-.2-.4-.3-.7-.3H3c-.3 0-.5.2-.5.5z" />
      <circle cx="5.3" cy="5.3" r=".9" />
    </>
  ),
  trash: (
    <>
      <path d="M3 4.5h10M6.5 4.5V3c0-.3.2-.5.5-.5h2c.3 0 .5.2.5.5v1.5" />
      <path d="M4.2 4.5 5 13c0 .3.3.5.6.5h4.8c.3 0 .6-.2.6-.5l.8-8.5" />
    </>
  ),
  image: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <circle cx="6" cy="6.5" r="1.1" />
      <path d="m2.8 11.6 3.4-3.2 2.3 2.1 1.7-1.5 3 2.7" />
    </>
  ),
  pdf: (
    <>
      <path d="M4 2h5.5L12.5 5v8.5c0 .3-.2.5-.5.5H4c-.3 0-.5-.2-.5-.5v-11c0-.3.2-.5.5-.5z" />
      <path d="M9.5 2v3h3" />
      <rect x="2" y="8" width="8" height="4" rx=".8" />
    </>
  ),
  canvas: (
    <>
      <rect x="2" y="2.5" width="5" height="4" rx="1" />
      <rect x="9" y="9.5" width="5" height="4" rx="1" />
      <path d="M7 4.5h2.5c.8 0 1.5.7 1.5 1.5v3.5" />
    </>
  ),
  audio: <path d="M2.5 8h1M5 5.5v5M7.5 3v10M10 5.5v5M12.5 7v2" />,
  video: (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="m6.8 6 3.2 2-3.2 2z" />
    </>
  ),
  other: (
    <>
      <path d="M4 2h5.5L12.5 5v8.5c0 .3-.2.5-.5.5H4c-.3 0-.5-.2-.5-.5v-11c0-.3.2-.5.5-.5z" />
      <path d="M9.5 2v3h3" />
    </>
  ),
};

/** O ícone de um item da árvore. Decorativo: o nome ao lado já diz o que é, e o tipo vai no `data-type` do item. */
export function TreeIcon({ name }: { name: TreeIconName }) {
  return (
    <svg className="kn-side-icon" data-icon={name} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

/** A seta da pasta: aponta para a direita fechada e para baixo aberta (o CSS gira). */
export function Twisty({ open }: { open?: boolean }) {
  return (
    <svg className="kn-side-twisty" data-open={open || undefined} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      {open === undefined ? null : <path d="m6 4 4 4-4 4" />}
    </svg>
  );
}
